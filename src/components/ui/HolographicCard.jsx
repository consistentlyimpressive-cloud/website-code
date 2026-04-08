import { useState, useRef } from 'react';

const CARD_RADIUS = '0.75rem';

const HolographicCard = ({ celeb, onClick, compact = false }) => {
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
      shadowHov: 'shadow-black/60',
      badge: 'text-green-300 border-green-500/30'
    };
  } else if (num >= 80) {
    // 80–89 Just green
    rColors = {
      text: 'from-green-400 via-green-500 to-green-600',
      dropConfig: 'drop-shadow-[0_0_15px_rgba(34,197,94,0.6)]',
      border: 'border-green-500/60',
      shadowHov: 'shadow-black/60',
      badge: 'text-green-400 border-green-500/30'
    };
  } else if (num >= 70) {
    // 70–79 mostly green but some orange tint
    rColors = {
      text: 'from-orange-400 via-lime-500 to-green-500',
      dropConfig: 'drop-shadow-[0_0_15px_rgba(132,204,22,0.5)]',
      border: 'border-lime-500/60',
      shadowHov: 'shadow-black/60',
      badge: 'text-lime-400 border-lime-500/30'
    };
  } else if (num >= 60) {
    // 60–69 in between orange and green
    rColors = {
      text: 'from-orange-500 via-yellow-500 to-lime-500',
      dropConfig: 'drop-shadow-[0_0_15px_rgba(234,179,8,0.5)]',
      border: 'border-yellow-500/60',
      shadowHov: 'shadow-black/60',
      badge: 'text-yellow-400 border-yellow-500/30'
    };
  } else {
    // below 60 -> orange
    rColors = {
      text: 'from-orange-500 via-orange-600 to-orange-700',
      dropConfig: 'drop-shadow-[0_0_15px_rgba(249,115,22,0.5)]',
      border: 'border-orange-600/60',
      shadowHov: 'shadow-black/60',
      badge: 'text-orange-500 border-orange-600/30'
    };
  }

  const wrapCls = compact ? 'w-full max-w-[11rem] sm:max-w-[12.5rem] mx-auto' : 'w-full max-w-md mx-auto';
  const cardAspect = compact ? 'aspect-[3/4] max-h-[min(52vh,320px)]' : 'aspect-[3/4]';
  const titlePad = compact ? 'px-2 pb-2 pt-16' : 'px-4 pb-3 pt-28';
  const nameSz = compact ? 'text-xs' : 'text-base';
  const ratingSz = compact ? 'text-sm' : 'text-lg';

  return (
    <div 
      className={`${wrapCls} group cursor-pointer`}
      style={{ perspective: '1000px' }}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={onClick}
    >
      <div 
        ref={cardRef}
        className={`relative ${cardAspect} rounded-xl border ${rColors.border} bg-[#0c0d0e]/80 backdrop-blur-xl overflow-hidden transition-all duration-300 ease-out transform-gpu shadow-2xl isolate ${isHovering ? rColors.shadowHov : 'shadow-black/50'}`}
        style={{
          transform: isHovering ? `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg) scale3d(1.05, 1.05, 1.05)` : 'rotateX(0) rotateY(0) scale3d(1, 1, 1)',
          clipPath: `inset(0 round ${CARD_RADIUS})`,
        }}
      >
        <div
          className="absolute inset-0 pointer-events-none overflow-hidden rounded-[inherit]"
          style={{ borderRadius: 'inherit', clipPath: `inset(0 round ${CARD_RADIUS})` }}
        >
          <img
            src={celeb.imgSrc}
            referrerPolicy="no-referrer"
            className={`w-full h-full object-cover rounded-[inherit] transition-all duration-700 transform-gpu [backface-visibility:hidden] ${isHovering ? 'scale-[1.15] brightness-110 opacity-100' : 'scale-105 brightness-95 opacity-100'}`}
            style={{ borderRadius: 'inherit', clipPath: `inset(0 round ${CARD_RADIUS})` }}
            alt={celeb.name}
          />
          <div className="absolute inset-0 rounded-[inherit] bg-gradient-to-t from-[#0c0d0e]/30 via-transparent to-transparent" style={{ borderRadius: 'inherit' }} />
        </div>
        
        {/* SEE WHY Overlay */}
        <div className={`absolute inset-0 z-20 flex flex-col items-center justify-center rounded-[inherit] bg-black/40 backdrop-blur-[2px] transition-all duration-300 pointer-events-none ${isHovering ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`} style={{ borderRadius: 'inherit' }}>
          <div className={`flex items-center gap-2 bg-white/10 border border-white/20 rounded-full shadow-[0_0_30px_rgba(255,255,255,0.2)] backdrop-blur-md ${compact ? 'px-3 py-2' : 'px-6 py-3'}`}>
            <span className={`text-white font-black italic tracking-widest uppercase ${compact ? 'text-[10px]' : 'text-sm'}`}>See Why</span>
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </div>
        
        <div className={`absolute inset-0 ${titlePad} z-30 rounded-[inherit] transform-gpu transition-transform duration-500 bg-gradient-to-t from-[#0c0d0e]/50 via-transparent to-transparent flex flex-col justify-end`} style={{ borderRadius: 'inherit' }}>
          <div className="flex justify-between items-end mb-1">
            <h3 className={`${nameSz} font-black italic tracking-tighter text-white uppercase leading-none flex flex-wrap items-baseline gap-x-1 gap-y-0.5`}>
              <span className="truncate max-w-[80%]">{celeb.name}</span>
              <span className={`${ratingSz} font-black select-none text-transparent bg-clip-text bg-gradient-to-br ${rColors.text} ${rColors.dropConfig} transition-all duration-300`}>
                {celeb.rating}
              </span>
              {celeb.flags && celeb.flags.length > 0 && (
                <div className="flex items-center gap-0.5 ml-0.5 translate-y-[1px]">
                  {celeb.flags.map((code) => (
                    <img key={code} src={`https://flagcdn.com/w20/${code}.png`} alt={`${code} flag`} className="w-3.5 h-[10px] object-cover rounded-[1px] opacity-90 shadow-sm border border-white/10" />
                  ))}
                </div>
              )}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-black/60 border backdrop-blur-md ${rColors.badge}`}>
              {celeb.tier}
            </span>
          </div>
        </div>

        {/* Glare effect */}
        <div 
          className="absolute inset-0 pointer-events-none z-40 transition-opacity duration-300 rounded-[inherit]"
          style={{
            opacity: isHovering ? 0.4 : 0,
            background: `radial-gradient(circle at ${rotation.y * 5 + 50}% ${rotation.x * -5 + 50}%, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0) 60%)`,
            mixBlendMode: 'overlay',
            borderRadius: 'inherit',
          }}
        />
      </div>
    </div>
  );
};

export default HolographicCard;
