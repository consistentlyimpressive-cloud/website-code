require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const admin = require('firebase-admin');

// Initialize Firebase Admin
// Important: In a real environment, you need to provide service account credentials.
// For example: admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
// Using applicationDefault() expects the GOOGLE_APPLICATION_CREDENTIALS environment variable.
admin.initializeApp({
  credential: admin.credential.applicationDefault()
});

const db = admin.firestore();
const app = express();

// Middleware to capture raw body for signature verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

const webhookSecret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET || 'YOUR_NEW_LIVE_WEBHOOK_SECRET';

app.post('/api/webhooks/lemonsqueezy', async (req, res) => {
  const signature = req.get('X-Signature');
  
  if (!signature) {
    console.error("No signature provided");
    return res.status(400).send('No signature');
  }

  // Verify signature
  const hmac = crypto.createHmac('sha256', webhookSecret);
  const digest = Buffer.from(hmac.update(req.rawBody).digest('hex'), 'utf8');
  const signatureBuffer = Buffer.from(signature, 'utf8');

  try {
    if (!crypto.timingSafeEqual(digest, signatureBuffer)) {
      console.error("Invalid signature");
      return res.status(401).send('Invalid signature');
    }
  } catch (err) {
    console.error("Signature verification failed:", err);
    return res.status(401).send('Signature validation error');
  }

  const event = req.body;
  const eventName = event.meta.event_name;
  const customData = event.meta.custom_data || {};
  const userId = customData.user_id;

  console.log(`Received event: ${eventName} for user: ${userId}`);

  if (!userId) {
    console.error("No user_id found in custom_data");
    return res.status(400).send('No user_id in custom_data');
  }

  const userRef = db.collection('users').doc(userId);

  try {
    if (eventName === 'order_created') {
      const isSubscription = event.data.attributes.first_subscription_item !== null;
      if (!isSubscription) {
        // Single Scan purchase
        await userRef.set({
          singleScans: admin.firestore.FieldValue.increment(1)
        }, { merge: true });
        console.log(`Incremented single scans for user ${userId}`);
      }
    } else if (eventName === 'subscription_created' || eventName === 'subscription_updated') {
      // Ascend Pro subscription active
      await userRef.set({
        pro: true
      }, { merge: true });
      console.log(`Set pro to true for user ${userId}`);
    } else if (eventName === 'subscription_cancelled' || eventName === 'subscription_expired') {
      // Ascend Pro subscription expired/cancelled
      await userRef.set({
        pro: false
      }, { merge: true });
      console.log(`Set pro to false for user ${userId}`);
    }
    
    res.status(200).send('Webhook received and processed');
  } catch (err) {
    console.error('Error updating firestore:', err);
    res.status(500).send('Internal Server Error');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend Server is running on port ${PORT}`);
});
