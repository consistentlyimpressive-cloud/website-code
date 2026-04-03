import { useState, useRef } from 'react';

const HolographicCard = ({ celeb, onClick }) => {
  const [rotation, setRotation] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);
  const cardRef = useRef(null);

  const handleMouseMove = (e) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Max rotation 15 degrees
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const rotateX = ((y - centerY) / centerY) * -15;
    const rotateY = ((x - centerX) / centerX) * 15;
    
    setRotation({ x: rotateX, y: rotateY });
  };

  const handleMouseEnter = () => setIsHovering(true);
  const handleMouseLeave = () => {
    setIsHovering(false);
    setRotation({ x: 0, y: 0 });
  };
  const num = parseFloat(celeb.rating);
  let rColors = {};
  if (num >= 90) {
    // 90+ (0–100 scale) Very glowy green
    rColors = {
      text: 'from-green-200 via-green-400 to-green-500',
      dropConfig: 'drop-shadow-[0_0_20px_rgba(74,222,128,1)] drop-shadow-[0_0_40px_rgba(74,222,128,0.8)]',
      border: 'border-green-400/80',
      shadowHov: 'shadow-[0_0_60px_rgba(74,222,128,0.6)]',
      badge: 'text-green-300 border-green-500/30'
    };
  } else if (num >= 80) {
    // 80–89 Just green
    rColors = {
      text: 'from-green-400 via-green-500 to-green-600',
      dropConfig: 'drop-shadow-[0_0_15px_rgba(34,197,94,0.6)]',
      border: 'border-green-500/60',
      shadowHov: 'shadow-[0_0_40px_rgba(34,197,94,0.4)]',
      badge: 'text-green-400 border-green-500/30'
    };
  } else if (num >= 70) {
    // 70–79 mostly green but some orange tint
    rColors = {
      text: 'from-orange-400 via-lime-500 to-green-500',
      dropConfig: 'drop-shadow-[0_0_15px_rgba(132,204,22,0.5)]',
      border: 'border-lime-500/60',
      shadowHov: 'shadow-[0_0_40px_rgba(132,204,22,0.3)]',
      badge: 'text-lime-400 border-lime-500/30'
    };
  } else if (num >= 60) {
    // 60–69 in between orange and green
    rColors = {
      text: 'from-orange-500 via-yellow-500 to-lime-500',
      dropConfig: 'drop-shadow-[0_0_15px_rgba(234,179,8,0.5)]',
      border: 'border-yellow-500/60',
      shadowHov: 'shadow-[0_0_40px_rgba(234,179,8,0.3)]',
      badge: 'text-yellow-400 border-yellow-500/30'
    };
  } else {
    // below 60 -> orange
    rColors = {
      text: 'from-orange-500 via-orange-600 to-orange-700',
      dropConfig: 'drop-shadow-[0_0_15px_rgba(249,115,22,0.5)]',
      border: 'border-orange-600/60',
      shadowHov: 'shadow-[0_0_40px_rgba(249,115,22,0.3)]',
      badge: 'text-orange-500 border-orange-600/30'
    };
  }

  return (
    <div 
      className="w-full max-w-md mx-auto group cursor-pointer"
      style={{ perspective: '1000px' }}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={onClick}
    >
      <div 
        ref={cardRef}
        className={`relative aspect-[3/4] rounded-2xl border ${rColors.border} bg-[#0c0d0e]/80 backdrop-blur-xl overflow-hidden transition-all duration-300 ease-out transform-gpu shadow-2xl ${isHovering ? rColors.shadowHov : 'shadow-black/50'}`}
        style={{
          transform: isHovering ? `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg) scale3d(1.05, 1.05, 1.05)` : 'rotateX(0) rotateY(0) scale3d(1, 1, 1)'
        }}
      >
        <div className="absolute inset-0 pointer-events-none">
          <img src={celeb.imgSrc} referrerPolicy="no-referrer" className={`w-full h-full object-cover transition-all duration-700 transform-gpu ${isHovering ? 'scale-[1.15] brightness-110 opacity-100' : 'scale-105 brightness-95 opacity-100'}`} alt={celeb.name} />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0c0d0e]/30 via-transparent to-transparent" />
        </div>
        
        {/* SEE WHY Overlay */}
        <div className={`absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/40 backdrop-blur-[2px] transition-all duration-300 pointer-events-none ${isHovering ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>
          <div className="flex items-center gap-2 bg-white/10 border border-white/20 px-6 py-3 rounded-full shadow-[0_0_30px_rgba(255,255,255,0.2)] backdrop-blur-md">
            <span className="text-white font-black italic tracking-widest text-sm uppercase">See Why</span>
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </div>
        
        {/* Card Info */}
        <div className="absolute bottom-0 left-0 w-full px-6 pb-3 pt-28 z-30 transform-gpu transition-transform duration-500 bg-gradient-to-t from-[#0c0d0e]/50 via-transparent to-transparent">
          <div className="flex justify-between items-end mb-1.5">
            <h3 className="text-lg font-black italic tracking-tighter text-white uppercase leading-none flex flex-wrap items-baseline gap-x-2 gap-y-1">
              {celeb.name}
              <span className={`text-xl font-black select-none text-transparent bg-clip-text bg-gradient-to-br ${rColors.text} ${rColors.dropConfig} transition-all duration-300`}>
                {celeb.rating}
              </span>
              {celeb.flags && celeb.flags.length > 0 && (
                <div className="flex items-center gap-1 ml-1 translate-y-[1px]">
                  {celeb.flags.map((code) => (
                    <img key={code} src={`https://flagcdn.com/w20/${code}.png`} alt={`${code} flag`} className="w-5 h-[14px] object-cover rounded-[2px] opacity-90 shadow-sm border border-white/10" />
                  ))}
                </div>
              )}
            </h3>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-black/60 border backdrop-blur-md ${rColors.badge}`}>
              {celeb.tier}
            </span>
          </div>
        </div>

        {/* Glare effect */}
        <div 
          className="absolute inset-0 pointer-events-none z-40 transition-opacity duration-300 rounded-2xl"
          style={{
            opacity: isHovering ? 0.4 : 0,
            background: `radial-gradient(circle at ${rotation.y * 5 + 50}% ${rotation.x * -5 + 50}%, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0) 60%)`,
            mixBlendMode: 'overlay'
          }}
        />
      </div>
    </div>
  );
};

export default HolographicCard;