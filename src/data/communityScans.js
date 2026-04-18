/**
 * Community Scans — Pro dashboard → Community Scans grid
 *
 * Assets live in public/community/ and public/community-scans/
 */

const user1 = {
  frontImage: '/community/user1-front.png',
  sideImage: '/community/user1-side.png',
  finalRating: 65,
  sideRating: 71,
  sex: 'Male',
  categories: {
    Bone: 74,
    Harmony: 74,
    Symmetry: 74,
    Dimorphism: 74,
    Skin: 74
  },
  sideCategories: {
    Bone: 71,
    Harmony: 71,
    Symmetry: 71,
    Dimorphism: 71,
    Skin: 71
  },
  biometrics: [
    { label: 'Bigonial Width Index (0.793)', score: 40, max: 100 },
    { label: 'Lower Third Length (0.52)', score: 40, max: 100 },
    { label: 'Upper Third Length (0.366)', score: 45, max: 100 },
    { label: 'fWHR (1.463)', score: 30, max: 100 },
    { label: 'Middle Third Length (0.556)', score: 30, max: 100 },
    { label: 'Midface Ratio', score: 30, max: 100 },
    { label: 'IPD Index', score: 50, max: 100 },
    { label: 'Canthal Tilt Degrees (0.79°)', score: 40, max: 100 },
    { label: 'Eye Height Index (0.056)', score: 45, max: 100 },
    { label: 'Brow Compactness Index', score: 50, max: 100 },
    { label: 'Mouth Width Index (0.354)', score: 45, max: 100 },
    { label: 'Nose Width Index (0.224)', score: 55, max: 100 },
    { label: 'Philtrum Height Index (0.127)', score: 40, max: 100 },
    { label: 'Total Lip Height Index (0.153)', score: 70, max: 100 }
  ],
  sideBiometrics: [
    { label: 'Maxillary Projection (Slightly Recessed)', score: 65, max: 100 },
    { label: 'Orbital Vector (Negative)', score: 50, max: 100 },
    { label: 'Gonial Angle (Obtuse°)', score: 60, max: 100 },
    { label: 'Facial Convexity (Convex°)', score: 65, max: 100 },
    { label: 'Total Facial Convexity (Convex°)', score: 60, max: 100 },
    { label: 'Nasal Projection Shape (Prominent, Slightly Convex Dorsum)', score: 70, max: 100 },
    { label: 'Chin Projection (Recessed)', score: 55, max: 100 },
    { label: 'Mandibular Plane (Steep°)', score: 55, max: 100 },
    { label: 'Lip Projection (Protrusive Relative to Chin)', score: 65, max: 100 },
    { label: 'Overall Profile Harmony (Imbalanced Due to Weak Lower Third)', score: 60, max: 100 },
    { label: 'Nasolabial Angle (Acute°)', score: 60, max: 100 },
    { label: 'Brow Ridge (Moderate)', score: 75, max: 100 }
  ],
  technicalSummary: 'Solid lower third presence and good facial symmetry frontally, but a low facial width-to-height ratio (fWHR) results in a narrower face. The side profile reveals a prominent nasal projection and moderate brow ridge, but overall profile harmony is compromised by a recessed chin and steep mandibular plane.',
  bestFeatures: [
    { title: 'Lip Volume', desc: 'Full and well-proportioned lips, especially the lower lip.' }
  ],
  primaryFlaws: [
    { title: 'fWHR', desc: 'Extremely low (1.463), resulting in a narrow, vertically dominant face.' }
  ],
  sideBestFeatures: [
    { title: 'Nose Projection', desc: 'Prominent nasal bridge with adequate forward growth.' }
  ],
  sidePrimaryFlaws: [
    { title: 'Chin Projection', desc: 'Recessed, failing to balance the prominent nose and midface.' }
  ],
  protocols: [
    {
      id: 1,
      name: 'Beard Trim & Shape',
      description: 'Sharpening the beard line can help visually widen the jawline to offset the low fWHR.',
      impact: 'High Impact',
      research: 'Clinical Grooming Studies'
    }
  ],
};

const user2 = {
  frontImage: '/community/user2-front.png',
  sideImage: '/community/user2-side.png',
  finalRating: 58,
  sideRating: 68,
  sex: 'Male',
  categories: {
    Bone: 71,
    Harmony: 71,
    Symmetry: 71,
    Dimorphism: 71,
    Skin: 71
  },
  sideCategories: {
    Bone: 68,
    Harmony: 68,
    Symmetry: 68,
    Dimorphism: 68,
    Skin: 68
  },
  biometrics: [
    { label: 'Bigonial Width Index (0.77)', score: 75, max: 100 },
    { label: 'Upper Third Length (0.424)', score: 75, max: 100 },
    { label: 'Middle Third Length (0.49)', score: 80, max: 100 },
    { label: 'Lower Third Length (0.466)', score: 70, max: 100 },
    { label: 'fWHR', score: 72, max: 100 },
    { label: 'Midface Ratio', score: 85, max: 100 },
    { label: 'IPD Index', score: 75, max: 100 },
    { label: 'Eye Height Index (0.059)', score: 85, max: 100 },
    { label: 'Brow Compactness Index', score: 80, max: 100 },
    { label: 'Canthal Tilt Degrees (4.76°)', score: 80, max: 100 },
    { label: 'Mouth Width Index (0.412)', score: 80, max: 100 },
    { label: 'Nose Width Index (0.292)', score: 70, max: 100 },
    { label: 'Philtrum Height Index (0.092)', score: 75, max: 100 },
    { label: 'Total Lip Height Index (0.211)', score: 85, max: 100 }
  ],
  sideBiometrics: [
    { label: 'Maxillary Projection (Moderate to Strong)', score: 80, max: 100 },
    { label: 'Orbital Vector (Neutral to Slightly Positive)', score: 75, max: 100 },
    { label: 'Gonial Angle (Unsure°)', score: 50, max: 100 },
    { label: 'Facial Convexity (Convex°)', score: 75, max: 100 },
    { label: 'Total Facial Convexity (Convex°)', score: 70, max: 100 },
    { label: 'Nasal Projection Shape (Moderate Projection, Straight Dorsum)', score: 80, max: 100 },
    { label: 'Overall Profile Harmony (Harmonious with Ethnic Characteristics)', score: 78, max: 100 },
    { label: 'Chin Projection (Slightly Recessed)', score: 65, max: 100 },
    { label: 'Mandibular Plane (Steep°)', score: 60, max: 100 },
    { label: 'Nasolabial Angle (Acute°)', score: 70, max: 100 },
    { label: 'Lip Projection (Full, Prominent)', score: 85, max: 100 }
  ],
  technicalSummary: 'The subject presents a harmonious facial structure consistent with African descent, characterized by a compact midface (0.908 ratio), excellent eye compactness, and full, prominent lips. Frontally, the bizygomatic width provides good cheekbone definition. Laterally, the maxillary projection is moderate to strong, offering solid midfacial support and a neutral-to-positive orbital vector. Chin is slightly recessed relative to the lower lip, increasing facial convexity.',
  bestFeatures: [
    { title: 'Eye Compactness', desc: 'Minimal upper eyelid exposure and good brow-to-eye distance.' }
  ],
  primaryFlaws: [
    { title: 'Skin Quality', desc: 'Visible acne scarring and post-inflammatory hyperpigmentation.' }
  ],
  sideBestFeatures: [
    { title: 'Maxillary Projection', desc: 'Moderate to strong support for the midface and subnasal area.' }
  ],
  sidePrimaryFlaws: [
    { title: 'Chin Projection', desc: 'Slightly recessed relative to the lower lip, increasing facial convexity.' }
  ],
  protocols: [
    {
      id: 1,
      name: 'Hyper-pigmentation Skincare',
      description: 'Introduce a chemical exfoliant (AHA/BHA) or Vitamin C serum to address post-inflammatory marks.',
      impact: 'High Impact',
      research: 'Dermatological Protocols'
    }
  ],
};

const user3 = {
  frontImage: '/community/user3-front.png',
  sideImage: '/community/user3-side.png',
  finalRating: 46,
  sideRating: 43,
  sex: 'Male',
  categories: {
    Bone: 46,
    Harmony: 46,
    Symmetry: 46,
    Dimorphism: 46,
    Skin: 46
  },
  sideCategories: {
    Bone: 43,
    Harmony: 43,
    Symmetry: 43,
    Dimorphism: 43,
    Skin: 43
  },
  biometrics: [
    { label: 'Bigonial Width Index (0.815)', score: 80, max: 100 },
    { label: 'Upper Third Length (0.333)', score: 75, max: 100 },
    { label: 'Middle Third Length (0.522)', score: 85, max: 100 },
    { label: 'Lower Third Length (0.49)', score: 75, max: 100 },
    { label: 'fWHR (1.588)', score: 65, max: 100 },
    { label: 'Midface Ratio', score: 85, max: 100 },
    { label: 'IPD Index', score: 75, max: 100 },
    { label: 'Eye Height Index (0.064)', score: 85, max: 100 },
    { label: 'Brow Compactness Index', score: 80, max: 100 },
    { label: 'Canthal Tilt Degrees (-0.48°)', score: 75, max: 100 },
    { label: 'Mouth Width Index (0.437)', score: 75, max: 100 },
    { label: 'Nose Width Index (0.287)', score: 70, max: 100 },
    { label: 'Philtrum Height Index (0.108)', score: 75, max: 100 },
    { label: 'Total Lip Height Index (0.204)', score: 80, max: 100 }
  ],
  sideBiometrics: [
    { label: 'Maxillary Projection (Moderate)', score: 75, max: 100 },
    { label: 'Orbital Vector (Neutral)', score: 70, max: 100 },
    { label: 'Gonial Angle (Unsure°)', score: 50, max: 100 },
    { label: 'Facial Convexity (Convex°)', score: 70, max: 100 },
    { label: 'Total Facial Convexity (Convex°)', score: 65, max: 100 },
    { label: 'Nasal Projection Shape (Moderate Projection, Straight Dorsum)', score: 75, max: 100 },
    { label: 'Overall Profile Harmony (Harmonious within Ethnic Norms)', score: 72, max: 100 },
    { label: 'Chin Projection (Slightly Recessed)', score: 65, max: 100 },
    { label: 'Mandibular Plane (Steep°)', score: 60, max: 100 },
    { label: 'Nasolabial Angle (Acute°)', score: 60, max: 100 },
    { label: 'Lip Projection (Prominent)', score: 80, max: 100 },
    { label: 'Brow Ridge (Moderate)', score: 70, max: 100 }
  ],
  technicalSummary: 'The subject presents a harmonious structural foundation with a highly compact midface (Midface Ratio: 0.88) and strong bigonial width (0.815), contributing to a masculine frontal appearance. The fWHR (1.588) is slightly below the ideal masculine threshold, giving the face a slightly more vertical orientation, though this is counterbalanced by the compact midface. Visually overriding the metadata, the canthal tilt is neutral-to-positive, supported by excellent eye compactness and minimal upper eyelid exposure. Laterally, the profile is convex, which is harmonious and expected within African descent norms. The maxilla offers moderate projection, adequately supporting the prominent lips and midface. The primary lateral structural limitation is a slightly recessed chin and a steep mandibular plane, which slightly disrupts the lower-third forward growth.',
  bestFeatures: [
    { title: 'Eye Compactness', desc: 'Minimal upper eyelid exposure and an excellent eye height index (0.064) create a piercing gaze.' }
  ],
  primaryFlaws: [
    { title: 'fWHR', desc: 'A slightly lower facial width-to-height ratio (1.588) than the ideal masculine standard (1.74+).' }
  ],
  sideBestFeatures: [
    { title: 'Maxillary Projection', desc: 'Moderate projection providing adequate skeletal support to the midface and subnasal region.' }
  ],
  sidePrimaryFlaws: [
    { title: 'Chin Projection', desc: 'Slightly recessed chin contributing to an overly convex profile.' }
  ],
  protocols: [
    {
      id: 1,
      name: 'Beard Growth for Chin Projection',
      description: 'Grow and shape a goatee or full beard to visually extend the chin and balance the convex profile.',
      impact: 'High Impact',
      research: 'Clinical Grooming Studies'
    }
  ],
};

/** East Asian male — average tier; strong write-up on skin / midface / profile */
const asianMale = {
  frontImage: '/community-scans/asian-front.png',
  sideImage: '/community-scans/asian-side.png',
  finalRating: 47,
  sideRating: 56,
  sex: 'Male',
  categories: {
    Harmony: 52,
    Symmetry: 58,
    Dimorphism: 55,
    Skin: 45,
    Bone: 54,
  },
  sideCategories: {
    Harmony: 55,
    Symmetry: 58,
    Dimorphism: 55,
    Skin: 45,
    Bone: 52,
  },
  biometrics: [
    { label: 'Bigonial Width Ratio', score: 77, max: 100 },
    { label: 'IPD Ratio', score: 42, max: 100 },
    { label: 'Mouth Width Ratio', score: 31, max: 100 },
    { label: 'Nose Width Ratio', score: 23, max: 100 },
    { label: 'Upper Third', score: 42, max: 100 },
    { label: 'Middle Third', score: 48, max: 100 },
    { label: 'Lower Third', score: 47, max: 100 },
    { label: 'Eye Height Ratio', score: 6, max: 100 },
    { label: 'Brow Compactness', score: 14, max: 100 },
    { label: 'Philtrum Height', score: 11, max: 100 },
    { label: 'Total Lip Height', score: 14, max: 100 },
    { label: 'fWHR', score: 78, max: 100 },
    { label: 'Midface Ratio', score: 44, max: 100 },
    { label: 'Canthal Tilt', score: 52, max: 100 },
  ],
  sideBiometrics: [
    { label: 'Maxillary Projection', score: 65, max: 100 },
    { label: 'Chin Projection', score: 60, max: 100 },
    { label: 'Nasolabial Angle', score: 55, max: 100 },
    { label: 'Orbital Vector', score: 65, max: 100 },
    { label: 'Gonial Angle', score: 60, max: 100 },
    { label: 'Facial Convexity', score: 65, max: 100 },
    { label: 'Total Facial Convexity', score: 65, max: 100 },
    { label: 'Mandibular Plane', score: 55, max: 100 },
    { label: 'Nasal Projection Shape', score: 75, max: 100 },
    { label: 'Lip Projection', score: 60, max: 100 },
    { label: 'Brow Ridge', score: 70, max: 100 },
    { label: 'Overall Profile Harmony', score: 62, max: 100 },
    { label: 'Facial Fat', score: 60, max: 100 },
    { label: 'Eye Depth', score: 65, max: 100 },
    { label: 'Ear Shape', score: 70, max: 100 },
    { label: 'Skin Quality', score: 45, max: 100 },
  ],
  technicalSummary:
    'The subject presents a dual-profile with an East Asian phenotype. Frontally, the geometric biometrics indicate a solid fWHR (1.714), which provides good facial width, but this is counterbalanced by an elongated midface ratio (1.048) and visible skin texture issues (acne, scarring). Visually, the canthal tilt is neutral, overriding the metadata\'s anomalous reading. Laterally, the profile is convex with a steep mandibular plane and an obtuse gonial angle, indicating a vertical growth pattern. The maxilla and chin are slightly recessed, contributing to an acute nasolabial angle and protrusive lips. However, the nasal projection is moderate with a straight dorsum, providing a stabilizing anchor to the side profile. Infraorbital support is neutral to slightly negative, correlating with the mild undereye puffiness seen frontally.',
  bestFeatures: [
    'Solid fWHR (1.714)',
    'Low upper eyelid exposure (hooded/monolid)',
    'Neutral canthal tilt',
    'Proportional upper third length',
    'Moderate lip thickness',
    'Straight nasal dorsum',
    'Moderate brow ridge',
    'Acceptable nasal projection',
    'Normal ear shape',
    'Adequate cranial vault',
  ],
  primaryFlaws: [
    'Elongated midface (1.048)',
    'Active acne and textural scarring',
    'Mild undereye puffiness/darkness',
    'Slight ocular asymmetry',
    'Lack of sharp jawline definition',
    'Steep mandibular plane',
    'Slightly recessed chin',
    'Slightly recessed maxilla',
    'Acute nasolabial angle',
    'Protrusive lips relative to aesthetic line',
  ],
  sideBestFeatures: [
    'Straight nasal dorsum',
    'Moderate brow ridge',
    'Acceptable nasal projection',
    'Normal ear shape',
    'Adequate cranial vault',
  ],
  sidePrimaryFlaws: [
    'Steep mandibular plane',
    'Slightly recessed chin',
    'Slightly recessed maxilla',
    'Acute nasolabial angle',
    'Protrusive lips relative to aesthetic line',
  ],
};

/** Black male — elite tier; high fWHR, compact midface, hunter-eye phenotype */
const blackMale = {
  frontImage: '/community-scans/black-front.png',
  sideImage: '/community-scans/black-side.png',
  finalRating: 68,
  sideRating: 87,
  sex: 'Male',
  categories: {
    Harmony: 92,
    Symmetry: 90,
    Dimorphism: 95,
    Skin: 88,
    Bone: 95,
  },
  sideCategories: {
    Harmony: 90,
    Symmetry: 90,
    Dimorphism: 94,
    Skin: 88,
    Bone: 93,
  },
  biometrics: [
    { label: 'Bigonial Width Ratio', score: 84, max: 100 },
    { label: 'IPD Ratio', score: 43, max: 100 },
    { label: 'Mouth Width Ratio', score: 42, max: 100 },
    { label: 'Nose Width Ratio', score: 92, max: 100 },
    { label: 'Upper Third', score: 42, max: 100 },
    { label: 'Middle Third', score: 45, max: 100 },
    { label: 'Lower Third', score: 51, max: 100 },
    { label: 'Eye Height Ratio', score: 91, max: 100 },
    { label: 'Brow Compactness', score: 94, max: 100 },
    { label: 'Philtrum Height', score: 89, max: 100 },
    { label: 'Total Lip Height', score: 93, max: 100 },
    { label: 'fWHR', score: 96, max: 100 },
    { label: 'Midface Ratio', score: 94, max: 100 },
    { label: 'Canthal Tilt', score: 90, max: 100 },
  ],
  sideBiometrics: [
    { label: 'Maxillary / Cheekbone Projection', score: 94, max: 100 },
    { label: 'Nose Projection', score: 88, max: 100 },
    { label: 'Facial Fat', score: 96, max: 100 },
    { label: 'Eye Depth', score: 92, max: 100 },
    { label: 'Ear Shape', score: 85, max: 100 },
    { label: 'Skin Quality', score: 88, max: 100 },
    { label: 'Gonial Angle', score: 93, max: 100 },
    { label: 'Chin Projection', score: 92, max: 100 },
    { label: 'Overall Profile Harmony', score: 91, max: 100 },
  ],
  technicalSummary:
    'The subject exhibits an elite structural base characterized by a highly dimorphic fWHR (1.89) and a compact midface ratio (0.941). Frontal biometrics reveal exceptional bigonial width (0.837) paired with extremely low facial fat, creating prominent cheek hollows (ogee curve). The eye area shows elite compactness, strong brow definition, and harmonious nose–philtrum–lip proportions, with visually confirmed positive canthal tilt and deep-set orbits. Extrapolated lateral biometrics indicate strong maxillary projection, a well-defined gonial angle, and optimal forward chin growth, supported by the robust frontal lower-third length (0.513).',
  bestFeatures: [
    'High fWHR (1.89)',
    'Compact Midface Ratio (0.941)',
    'Deep-set, compact eye area (Hunter eyes)',
    'Prominent bigonial width (0.837)',
    'Extremely low buccal fat (Hollow cheeks)',
    'Strong maxillary projection',
    'Well-defined gonial angle',
    'Forward chin projection',
    'Straight nasal dorsum',
    'Deep orbital vectors',
  ],
  primaryFlaws: [
    'Slightly dominant lower third length',
    'Minor nasal tip asymmetry',
    'Hairline slightly obscured/messy framing',
    'Cupid\'s bow lacks sharp definition',
    'Minor skin texture variations',
    'Nose projection slightly dominant',
    'Chin shape slightly blunt',
    'Brow ridge heavily dominant',
    'Ear projection slightly flat against head',
    'Submental area could be marginally tighter',
  ],
  sideBestFeatures: [
    'Strong maxillary projection',
    'Well-defined gonial angle',
    'Forward chin projection',
    'Straight nasal dorsum',
    'Deep orbital vectors',
  ],
  sidePrimaryFlaws: [
    'Nose projection slightly dominant',
    'Chin shape slightly blunt',
    'Brow ridge heavily dominant',
    'Ear projection slightly flat against head',
    'Submental area could be marginally tighter',
  ],
};

/** White male — high tier; Chico-style archetype; includes sample protocols */
const whiteMale = {
  frontImage: '/community-scans/white-front.png',
  sideImage: '/community-scans/white-side.png',
  finalRating: 63,
  sideRating: 81,
  sex: 'Male',
  categories: {
    Harmony: 83,
    Symmetry: 82,
    Dimorphism: 86,
    Skin: 85,
    Bone: 84,
  },
  sideCategories: {
    Harmony: 82,
    Symmetry: 82,
    Dimorphism: 84,
    Skin: 85,
    Bone: 81,
  },
  biometrics: [
    { label: 'Bigonial Width Ratio', score: 85, max: 100 },
    { label: 'IPD Ratio', score: 82, max: 100 },
    { label: 'Mouth Width Ratio', score: 80, max: 100 },
    { label: 'Nose Width Ratio', score: 82, max: 100 },
    { label: 'Upper Third', score: 80, max: 100 },
    { label: 'Middle Third', score: 85, max: 100 },
    { label: 'Lower Third', score: 82, max: 100 },
    { label: 'Eye Height Ratio', score: 80, max: 100 },
    { label: 'Brow Compactness', score: 84, max: 100 },
    { label: 'Philtrum Height', score: 82, max: 100 },
    { label: 'Total Lip Height', score: 84, max: 100 },
    { label: 'fWHR', score: 90, max: 100 },
    { label: 'Midface Ratio', score: 88, max: 100 },
    { label: 'Canthal Tilt', score: 82, max: 100 },
  ],
  sideBiometrics: [
    { label: 'Maxillary Projection', score: 85, max: 100 },
    { label: 'Chin Projection', score: 75, max: 100 },
    { label: 'Nasolabial Angle', score: 80, max: 100 },
    { label: 'Orbital Vector', score: 82, max: 100 },
    { label: 'Gonial Angle', score: 70, max: 100 },
    { label: 'Facial Convexity', score: 80, max: 100 },
    { label: 'Total Facial Convexity', score: 78, max: 100 },
    { label: 'Mandibular Plane', score: 75, max: 100 },
    { label: 'Nasal Projection Shape', score: 88, max: 100 },
    { label: 'Lip Projection', score: 82, max: 100 },
    { label: 'Brow Ridge', score: 85, max: 100 },
    { label: 'Overall Profile Harmony', score: 82, max: 100 },
    { label: 'Maxillary / Cheekbone Projection', score: 85, max: 100 },
    { label: 'Nose Projection', score: 88, max: 100 },
    { label: 'Facial Fat', score: 82, max: 100 },
    { label: 'Eye Depth', score: 84, max: 100 },
    { label: 'Ear Shape', score: 80, max: 100 },
    { label: 'Skin Quality', score: 85, max: 100 },
  ],
  technicalSummary:
    'The subject presents a highly dimorphic and harmonious facial structure, characterized by an elite facial width-to-height ratio (fWHR 1.777) and a perfectly compact midface (0.995). Frontally, the bigonial width is exceptionally strong, providing a masculine, squared lower third that anchors the face. The eye area features a neutral to slightly positive canthal tilt with deep-set eyes, supported by a prominent brow ridge. Laterally, the profile is clean and balanced, driven by strong maxillary projection and a straight nasal dorsum. The primary structural weakness is a slightly weak chin projection and a slightly steep mandibular plane, though the strong midface and cheekbones compensate well, maintaining overall profile harmony.',
  bestFeatures: [
    'Elite fWHR (1.777)',
    'Compact Midface Ratio (0.995)',
    'Strong Bigonial Width (0.815)',
    'Full, balanced lip shape',
    'Thick, low-set eyebrows',
    'Strong maxillary projection (Lateral)',
    'Straight nasal dorsum (Lateral)',
    'Prominent brow ridge (Lateral)',
    'Neutral/positive orbital vector (Lateral)',
    'Good nasolabial angle (95-100 degrees)',
  ],
  primaryFlaws: [
    'Slight upper eyelid exposure (UEE)',
    'Nasal tip is slightly rounded frontally',
    'Minor lower third soft-tissue asymmetry',
    'Philtrum is slightly flat frontally',
    'Eyebrow tails thin out slightly',
    'Slightly weak chin projection (Lateral)',
    'Mandibular plane is slightly steep (Lateral)',
    'Gonial angle lacks sharp definition laterally',
    'Slight facial convexity (Lateral)',
    'Lower lip slightly protrudes past upper lip laterally',
  ],
  sideBestFeatures: [
    'Strong maxillary projection',
    'Straight nasal dorsum',
    'Prominent brow ridge',
    'Neutral/positive orbital vector',
    'Good nasolabial angle',
  ],
  sidePrimaryFlaws: [
    'Slightly weak chin projection',
    'Mandibular plane is slightly steep',
    'Gonial angle lacks sharp definition laterally',
    'Slight facial convexity',
    'Lower lip slightly protrudes past upper lip laterally',
  ],
  protocols: [
    {
      id: 101,
      name: 'Sliding Genioplasty (conservative)',
      description: 'Advancement of the chin bone to balance weak lateral projection vs. brow/maxilla.',
      impact: 'Highest Impact',
      steps: ['Consult maxillofacial surgeon', 'Imaging & cephalometric planning', 'Post-op soft diet protocol'],
      duration: 'Surgical',
    },
    {
      id: 102,
      name: 'Masseter Hypertrophy (Mastic Gum)',
      description: 'Chewing hard gum to define gonial angle and add lateral jaw width.',
      impact: 'High Impact',
      steps: ['Gradual load progression', 'Monitor TMJ comfort', 'Track facial symmetry weekly'],
      duration: '3–6 Months',
    },
    {
      id: 103,
      name: 'Tretinoin / Retin-A Routine',
      description: 'Low-percentage retinoid for collagen and skin maintenance.',
      impact: 'High Impact',
      steps: ['Start 2x/week', 'Moisture barrier support', 'SPF daily'],
      duration: 'Ongoing',
    },
  ],
};

export const COMMUNITY_SCANS = [
  {
    id: 'user3',
    displayName: 'VoidWalker_992',
    tier: 'B-Tier',
    dashboardData: user3,
  },
  {
    id: 'user1',
    displayName: 'Zero_Dawn',
    tier: 'C-Tier',
    dashboardData: user1,
  },
  {
    id: 'user2',
    displayName: 'NovaStar',
    tier: 'D-Tier',
    dashboardData: user2,
  },
  {
    id: 'community-black-male',
    displayName: 'xVoidReaper',
    tier: 'C-Tier',
    dashboardData: blackMale,
  },
  {
    id: 'community-asian-male',
    displayName: 'ShadowFangs_8147',
    tier: 'C-Tier',
    dashboardData: asianMale,
  },
  {
    id: 'community-white-male',
    displayName: 'PixelMyth_5691',
    tier: 'C-Tier',
    dashboardData: whiteMale,
  },
];
