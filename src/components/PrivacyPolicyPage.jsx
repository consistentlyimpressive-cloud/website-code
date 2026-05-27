import React, { useEffect } from 'react';
import { ChevronLeft } from 'lucide-react';

const PrivacyPolicyPage = ({ setCurrentPage }) => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="min-h-screen pt-28 pb-20 px-4 sm:px-6 lg:px-8 max-w-3xl mx-auto font-sans text-zinc-300">
      <button onClick={() => setCurrentPage('home')} className="flex items-center gap-2 text-zinc-500 hover:text-cyan-400 font-sans text-[10px] uppercase tracking-widest mb-8 transition-colors">
        <ChevronLeft size={14} /> Back to Home
      </button>

      <h1 className="text-3xl md:text-5xl font-black italic uppercase tracking-tight text-white mb-2">Privacy Policy</h1>
      <p className="text-zinc-500 font-sans text-xs uppercase tracking-widest mb-10">Last Updated: April 5, 2026</p>

      <div className="space-y-10">
        <section>
          <h2 className="text-lg font-black uppercase tracking-widest text-white mb-4">1. Introduction</h2>
          <p className="leading-relaxed text-sm">
            At mogcheck ("we," "our," or "us"), we value your privacy. This Privacy Policy explains how we collect, use, and protect your information when you use our aesthetic analysis tool. By using mogcheck, you agree to the practices described in this policy.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-black uppercase tracking-widest text-white mb-4">2. Relationship with Paddle</h2>
          <p className="leading-relaxed text-sm mb-4">
            mogcheck uses Paddle.com Market Limited as our Merchant of Record. Paddle is the data controller for your payment information (e.g., credit card details, billing address).
          </p>
          <ul className="list-disc pl-5 space-y-3 text-sm">
            <li>When you make a purchase, you provide your payment data directly to Paddle.</li>
            <li>We do not see or store your full credit card number.</li>
            <li>You can view Paddle's privacy practices at <a href="https://paddle.com/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 transition-colors">paddle.com/legal/privacy</a>.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-black uppercase tracking-widest text-white mb-4">3. Data We Collect</h2>
          <p className="leading-relaxed text-sm mb-4">
            We only collect data that is strictly necessary to provide the analysis service:
          </p>
          <ul className="list-disc pl-5 space-y-3 text-sm">
            <li><strong className="text-zinc-100">Account Information:</strong> Email address (provided via Paddle) to deliver your reports and manage your $15/month or $10/year subscription.</li>
            <li><strong className="text-zinc-100">Analysis Images:</strong> The photos you upload for analysis.</li>
            <li><strong className="text-zinc-100">Technical Data:</strong> IP address and browser type (collected for security and fraud prevention).</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-black uppercase tracking-widest text-white mb-4">4. How We Process Facial Data (Biometric Disclaimer)</h2>
          <p className="leading-relaxed text-sm mb-4">
            mogcheck uses Artificial Intelligence to perform Facial Landmark Detection.
          </p>
          <ul className="list-disc pl-5 space-y-3 text-sm">
            <li><strong className="text-zinc-100">Nature of Processing:</strong> We extract mathematical coordinates (ratios and distances) to provide symmetry and proportion scores.</li>
            <li><strong className="text-zinc-100">No Identification:</strong> We do not use your data for "Facial Recognition." We do not compare your photo against a database to identify who you are.</li>
            <li><strong className="text-zinc-100">Secure Storage:</strong> Your images are stored securely in your account profile. They are only deleted when you explicitly delete them from your dashboard or when you delete your account entirely. We do not maintain a public gallery or database of user faces.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-black uppercase tracking-widest text-white mb-4">5. Legal Basis for Processing (GDPR/PDPA)</h2>
          <p className="leading-relaxed text-sm mb-4">
            We process your data based on the following:
          </p>
          <ul className="list-disc pl-5 space-y-3 text-sm">
            <li><strong className="text-zinc-100">Contractual Necessity:</strong> To provide the $8 report or $20 subscription service you purchased.</li>
            <li><strong className="text-zinc-100">Explicit Consent:</strong> By uploading a photo, you provide express consent for the AI to analyze your facial geometry for aesthetic purposes. You may withdraw consent by stopping the use of the service.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-black uppercase tracking-widest text-white mb-4">6. Third-Party Service Providers</h2>
          <p className="leading-relaxed text-sm mb-4">
            To generate high-quality reports, we may use secure third-party AI processors (e.g., Google Gemini API, OpenAI API).
          </p>
          <ul className="list-disc pl-5 space-y-3 text-sm">
            <li>These providers are bound by Data Processing Agreements (DPAs) that prohibit them from using your images to train their own models or for any purpose other than generating your specific report.</li>
            <li>Data is encrypted in transit using industry-standard TLS.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-black uppercase tracking-widest text-white mb-4">7. Data Retention</h2>
          <ul className="list-disc pl-5 space-y-3 text-sm">
            <li><strong className="text-zinc-100">Images:</strong> Stored securely in your account until you explicitly delete them or delete your account.</li>
            <li><strong className="text-zinc-100">Reports:</strong> Stored in your dashboard for as long as your account is active so you can view your results.</li>
            <li><strong className="text-zinc-100">Subscription Records:</strong> Retained for the duration of your subscription and as required by tax law (handled primarily by Paddle).</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-black uppercase tracking-widest text-white mb-4">8. Your Rights</h2>
          <p className="leading-relaxed text-sm mb-4">
            Depending on your location (including the United States, EU, or UK), you have the right to:
          </p>
          <ul className="list-disc pl-5 space-y-3 text-sm mb-4">
            <li><strong className="text-zinc-100">Access:</strong> Request a copy of the data we hold about you.</li>
            <li><strong className="text-zinc-100">Deletion:</strong> Request that we delete your account and associated reports.</li>
            <li><strong className="text-zinc-100">Correction:</strong> Update your email or account details.</li>
          </ul>
          <p className="leading-relaxed text-sm">
            To exercise these rights, email us at <a href="mailto:support@mogcheck.net" className="text-cyan-400 hover:text-cyan-300 transition-colors">support@mogcheck.net</a>.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-black uppercase tracking-widest text-white mb-4">9. Security</h2>
          <p className="leading-relaxed text-sm">
            We implement strict technical and organizational measures to protect your data. This includes end-to-end encryption for uploads and secure cloud storage for your account data.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-black uppercase tracking-widest text-white mb-4">10. Changes to This Policy</h2>
          <p className="leading-relaxed text-sm">
            We may update this policy to reflect changes in AI regulations or our service. We will notify you of any significant changes via the email address associated with your account.
          </p>
        </section>
      </div>
    </div>
  );
};

export default PrivacyPolicyPage;
