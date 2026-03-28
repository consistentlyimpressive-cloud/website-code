import React, { useMemo, useState, useEffect } from 'react';
import faceMeshData from './dense-mesh.json';

/** Longer loop = fewer full SVG remounts (cheaper). Must exceed max edge delay + line duration. */
const LOOP_MS = 18000;

const CyanFaceMesh = ({ mode = 'hero' }) => {
  const [loopKey, setLoopKey] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setLoopKey((prev) => prev + 1);
    }, LOOP_MS);
    return () => clearInterval(interval);
  }, []);

  const { points, edges } = useMemo(() => {
    const rawPts = faceMeshData.pts;
    const rawEdges = faceMeshData.edges;

    const cx = 200;
    const cy = 250;
    const scale = 23; // Adjusted to make the face bigger

    const mappedPts = rawPts.map((p, index) => {
      return {
        id: index,
        x: cx + (p.x * scale),
        y: cy - (p.y * scale),
      };
    });

    const maxY = Math.max(...mappedPts.map((p) => p.y));
    const minY = Math.min(...mappedPts.map((p) => p.y));
    const heightRange = maxY - minY;

    const pointsWithDelay = mappedPts.map((p) => {
      const normalizedY = (maxY - p.y) / heightRange;
      return {
        ...p,
        delay: normalizedY * 5,
      };
    });

    const edgeObjs = rawEdges.map((edgeIndices, i) => {
      const p1 = pointsWithDelay[edgeIndices[0]];
      const p2 = pointsWithDelay[edgeIndices[1]];
      const length = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const delay = Math.max(p1.delay, p2.delay) + 0.15;

      return {
        key: `e-${i}`,
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
        length,
        delay,
      };
    });

    return { points: pointsWithDelay, edges: edgeObjs };
  }, []);

  const shell =
    mode === 'hero'
      ? 'absolute inset-0 flex items-center justify-center overflow-visible pointer-events-none opacity-[0.55] transform-gpu'
      : 'relative w-full max-w-[240px] sm:max-w-[280px] md:max-w-[320px] mx-auto flex items-center justify-center overflow-visible pointer-events-none opacity-[0.63] z-10 transform-gpu [contain:paint]';

  return (
    <div className={shell}>
      <style>{`
        @keyframes pointAppear {
          0% { opacity: 0; transform: scale(0); fill: #fff; }
          35% { opacity: 1; transform: scale(1.35); fill: #fff; }
          100% { opacity: 0.92; transform: scale(1); fill: #ffffff; }
        }
        @keyframes lineDraw {
          0% { opacity: 0; stroke-dashoffset: var(--len); }
          45% { opacity: 0.75; stroke-dashoffset: 0; }
          100% { opacity: 0.42; stroke-dashoffset: 0; }
        }
      `}</style>

      {/* Soft radial wash — feathered to avoid a visible rectangular edge */}
      <div
        className={
          mode === 'hero'
            ? 'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none rounded-[50%] w-[min(135vw,780px)] h-[min(75vh,630px)] scale-110 blur-[44px] bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.1)_0%,rgba(255,255,255,0.03)_45%,transparent_68%)]'
            : 'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none bg-white/5 blur-[50px] w-[200px] h-[240px] sm:w-[240px] sm:h-[280px]'
        }
      />

      <svg
        key={loopKey}
        viewBox="0 0 400 500"
        preserveAspectRatio="xMidYMid meet"
        className={
          mode === 'hero'
            ? 'block h-full w-auto max-h-full max-w-[min(98%,1020px)] object-contain overflow-visible [filter:drop-shadow(0_0_28px_rgba(255,255,255,0.14))]'
            : 'w-full h-auto max-h-[340px] sm:max-h-[380px] drop-shadow-[0_0_14px_rgba(255,255,255,0.28)]'
        }
      >
        <g stroke="rgba(255,255,255,0.88)" strokeWidth="0.55">
          {edges.map((e) => (
            <line
              key={e.key}
              x1={e.x1}
              y1={e.y1}
              x2={e.x2}
              y2={e.y2}
              style={{
                '--len': e.length,
                strokeDasharray: e.length,
                strokeDashoffset: e.length,
                animation: `lineDraw 2.8s ease-out forwards`,
                animationDelay: `${e.delay}s`,
                opacity: 0,
              }}
            />
          ))}
        </g>

        <g>
          {points.map((p) => (
            <circle
              key={p.id}
              cx={p.x}
              cy={p.y}
              r="1.4"
              fill="#ffffff"
              style={{
                transformBox: 'fill-box',
                transformOrigin: 'center',
                animation: `pointAppear 0.9s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards`,
                animationDelay: `${p.delay}s`,
                opacity: 0,
              }}
            />
          ))}
        </g>
      </svg>
    </div>
  );
};

export default CyanFaceMesh;