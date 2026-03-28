const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, 'src', 'App.jsx');
let content = fs.readFileSync(appPath, 'utf8');

// 1. Move sideMetricData out to global scope
const sideMetricDataStr = `  const sideMetricData = [\n    { label: 'Gonial Angle', score: 96, max: 100 },\n    { label: 'Nasofrontal Angle', score: 82, max: 100 },\n    { label: 'Nasofacial Angle', score: 78, max: 100 },\n    { label: 'Nasolabial Angle', score: 88, max: 100 },\n    { label: 'Mentolabial Angle', score: 70, max: 100 },\n    { label: 'Facial Convexity', score: 92, max: 100 },\n    { label: 'Subnasale-Pogonion', score: 85, max: 100 },\n    { label: 'Mandibular Plane', score: 94, max: 100 },\n    { label: 'Maxillary Projection', score: 86, max: 100 },\n    { label: 'Chin Projection', score: 96, max: 100 }\n  ];`;
content = content.replace(sideMetricDataStr, "");

const globalSideMetricData = `
const sideMetricDataGlobal = [
  { label: 'Gonial Angle', score: 96, max: 100 },
  { label: 'Nasofrontal Angle', score: 82, max: 100 },
  { label: 'Nasofacial Angle', score: 78, max: 100 },
  { label: 'Nasolabial Angle', score: 88, max: 100 },
  { label: 'Mentolabial Angle', score: 70, max: 100 },
  { label: 'Facial Convexity', score: 92, max: 100 },
  { label: 'Subnasale-Pogonion', score: 85, max: 100 },
  { label: 'Mandibular Plane', score: 94, max: 100 },
  { label: 'Maxillary Projection', score: 86, max: 100 },
  { label: 'Chin Projection', score: 96, max: 100 }
];
`;
content = content.replace('// --- Dashboard Detailed Page ---', globalSideMetricData + '\n// --- Dashboard Detailed Page ---');
// For any fallback just prepend to DashboardPage definition
content = content.replace('const DashboardPage = () => {', globalSideMetricData + '\nconst DashboardPage = ({ dashboardData }) => {');

// 2. Adjust DashboardPage implementation
content = content.replace("const metricData = activeProfileView === 'front' ? frontMetricData : sideMetricData;", "const metricData = activeProfileView === 'front' ? frontMetricData : sideMetricDataGlobal;");
// Make the dashboard active profile side so it shows the analyzed profile
content = content.replace("const [activeProfileView, setActiveProfileView] = useState('front');", "const [activeProfileView, setActiveProfileView] = useState('side');");

// 3. Pass data to DashboardOverview
content = content.replace('const DashboardOverview = () => {', 'const DashboardOverview = ({ dashboardData }) => {');
content = content.replace('<DashboardOverview />', '<DashboardOverview dashboardData={dashboardData} />');

// 4. Update the Hardcoded Features in DashboardOverview
const bestFeaturesRegex = /<div className="flex flex-col gap-4 z-10 w-full relative">([\s\S]*?)<\/div>/g;
content = content.replace(bestFeaturesRegex, (match, inner, offset) => {
  if (match.includes("Infraorbital Support")) {
    // Primary Flaws
    return `<div className="flex flex-col gap-4 z-10 w-full relative">
              {dashboardData?.primaryFlaws?.map((flaw, idx) => (
                 <FeatureCard key={idx} type="flaw" title={flaw.title} description={flaw.description} />
              )) || <p className="text-zinc-500 italic">No flaws detected or backend disconnected.</p>}
            </div>`;
  } else if (match.includes("Hair Density")) {
    // Best Features
    return `<div className="flex flex-col gap-4 z-10 w-full relative">
              {dashboardData?.bestFeatures?.map((feature, idx) => (
                 <FeatureCard key={idx} type="best" title={feature.title} description={feature.description} />
              )) || <p className="text-zinc-500 italic">No features detected or backend disconnected.</p>}
            </div>`;
  }
  return match;
});

// 5. Update ScanningView entirely using regex to replace from "const ScanningView" to right before "const UploadPhotoPage"
const scanningViewRegex = /const ScanningView = \(\{[\s\S]*?\};/m;
const newScanningView = `
const ScanningView = ({ sideImageSrc, sideMetricData, onComplete }) => {
  const [statusText, setStatusText] = useState('Connecting to Backend Bridge...');
  const [videoUrl, setVideoUrl] = useState(null);

  useEffect(() => {
    let active = true;

    const startScan = async () => {
      try {
        setStatusText("Uploading image to secure AI server...");
        
        const response = await fetch(sideImageSrc);
        const blob = await response.blob();
        
        const formData = new FormData();
        formData.append('image', blob, 'upload.jpg');
        formData.append('stats', JSON.stringify(sideMetricData));

        setStatusText("Extracting Biometrics...");
        
        const apiRes = await fetch("http://localhost:3001/api/analyze", {
          method: "POST",
          body: formData
        });
        
        if (!active) return;
        const data = await apiRes.json();
        
        if (data.success) {
           setStatusText("Analysis Complete! Transitioning...");
           setVideoUrl(data.videoUrl);
           setTimeout(() => {
              if (active) onComplete(data);
           }, 5000);
        } else {
           setStatusText("Analysis Failed.");
        }
      } catch (err) {
        console.error("API failed", err);
        setStatusText("Connection Failed.");
      }
    };

    startScan();

    return () => { active = false; };
  }, [sideImageSrc, sideMetricData, onComplete]);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center animate-[fadeIn_0.5s_ease-out]">
      <style>{\`@keyframes scan { 0% { transform: translateY(-100px); } 100% { transform: translateY(600px); } }\`}</style>
      <div className="text-center mb-10 mt-10">
        <h2 className="text-3xl md:text-5xl font-black italic uppercase tracking-tighter text-cyan-400 mb-2 drop-shadow-[0_0_15px_rgba(34,211,238,0.5)] animate-pulse">Consulting AI</h2>
        <p className="font-mono text-zinc-400 text-sm uppercase tracking-[0.3em]">{statusText}</p>
      </div>

      <div className="relative aspect-[3/4] w-full max-w-md mx-auto bg-zinc-900 border border-cyan-500/50 rounded-3xl overflow-hidden shadow-[0_0_60px_rgba(34,211,238,0.2)] scale-[1.02] transform-gpu">
        {videoUrl ? (
           <video src={videoUrl} autoPlay loop muted playsInline className="absolute inset-0 w-full h-full object-cover z-20" />
        ) : (
           <>
             <img src={sideImageSrc} alt="Scan target" className="absolute inset-0 w-full h-full object-cover filter contrast-125 brightness-90 saturate-50 grayscale-[20%]" />
             <div className="absolute inset-0 bg-blue-900/30 mix-blend-overlay" />
             <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-cyan-400/20 to-transparent z-10" style={{ animation: 'scan 2s linear infinite' }} />
           </>
        )}
        <div className="absolute top-6 left-6 w-8 h-8 border-t-2 border-l-2 border-cyan-500/80 z-30" />
        <div className="absolute top-6 right-6 w-8 h-8 border-t-2 border-r-2 border-cyan-500/80 z-30" />
        <div className="absolute bottom-6 left-6 w-8 h-8 border-b-2 border-l-2 border-cyan-500/80 z-30" />
        <div className="absolute bottom-6 right-6 w-8 h-8 border-b-2 border-r-2 border-cyan-500/80 z-30" />
      </div>
    </div>
  );
};
`;
content = content.replace(scanningViewRegex, newScanningView);

// 6. Update UploadPhotoPage
content = content.replace('const UploadPhotoPage = ({ setCurrentPage }) => {', 'const UploadPhotoPage = ({ setCurrentPage, setDashboardData }) => {');
const scanningReturnRegex = /if \(isScanning\) \{[\s\S]*?\}/;
const newScanningReturn = `if (isScanning) {
    return (
      <div className="flex-grow flex flex-col items-center pt-24 pb-24 px-6 lg:px-12 relative overflow-hidden bg-[#0c0d0e]">
        <ScanningView 
           sideImageSrc={sideImage} 
           sideMetricData={sideMetricDataGlobal} 
           onComplete={(data) => {
              setDashboardData(data);
              setCurrentPage('dashboard');
           }} 
        />
      </div>
    );
  }`;
content = content.replace(scanningReturnRegex, newScanningReturn);

// 7. Update App Component
content = content.replace("const App = () => {\n  const [currentPage, setCurrentPage] = useState('home');", "const App = () => {\n  const [currentPage, setCurrentPage] = useState('home');\n  const [dashboardData, setDashboardData] = useState(null);");
content = content.replace('<UploadPhotoPage setCurrentPage={setCurrentPage} />', '<UploadPhotoPage setCurrentPage={setCurrentPage} setDashboardData={setDashboardData} />');
content = content.replace('{currentPage === \'dashboard\' && <DashboardPage />}', '{currentPage === \'dashboard\' && <DashboardPage dashboardData={dashboardData} />}');

fs.writeFileSync(appPath, content, 'utf8');
console.log('App.jsx updated perfectly.');
