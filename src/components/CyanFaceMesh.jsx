import React, { useRef, useEffect } from 'react';

/**
 * Hero: `/hero-face-animation.mp4` (H.264) first, then `.mov` (HEVC).
 * Chrome on Windows often **cannot decode HEVC inside `.mov`**, so the clip looked
 * “missing”. MP4 fixes that.
 *
 * Current export is **yuv420p only** (no alpha track). For real transparency in all
 * browsers, export **VP9 + alpha WebM** and list it before MP4.
 */
const HERO_MP4 = '/hero-face-animation.mp4';
const HERO_MOV = '/hero-face-animation.mov';

const CyanFaceMesh = ({ mode = 'hero' }) => {
  const videoRef = useRef(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const tryPlay = () => {
      v.play().catch(() => {});
    };
    tryPlay();
    v.addEventListener('canplay', tryPlay);
    return () => v.removeEventListener('canplay', tryPlay);
  }, []);

  if (mode !== 'hero') {
    return null;
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-visible pointer-events-none opacity-90 transform-gpu">
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none rounded-[50%] w-[min(142vw,820px)] h-[min(78vh,660px)] scale-110 blur-[52px] bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.12)_0%,rgba(255,255,255,0.03)_42%,transparent_70%)]"
        aria-hidden
      />

      {/* No canvas / no blend — let the browser show native alpha (Safari + HEVC MOV). */}
      <div className="relative flex min-h-[min(42vh,380px)] w-full max-w-[min(98%,1020px)] items-center justify-center [filter:drop-shadow(0_0_36px_rgba(255,255,255,0.2))_drop-shadow(0_0_72px_rgba(255,255,255,0.08))]">
        <video
          ref={videoRef}
          className="mx-auto block h-auto max-h-[min(72vh,640px)] w-full max-w-[min(98%,1020px)] object-contain"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          aria-hidden
        >
          {/* VP9+alpha WebM first when you have one (true transparency everywhere): */}
          {/* <source src="/hero-face-animation.webm" type="video/webm; codecs=vp09.00.41.08.00.01.01.01.00" /> */}
          <source src={HERO_MP4} type="video/mp4" />
          <source src={HERO_MOV} type="video/quicktime" />
        </video>
      </div>
    </div>
  );
};

export default CyanFaceMesh;
