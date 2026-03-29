import React, { useEffect, useRef } from 'react';

function hash01(a, b) {
  const t = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return t - Math.floor(t);
}

/**
 * Soft irregular triangulation (jittered grid) — reads like a Voronoi / mesh field.
 * Drawn once per resize; very low contrast for dark UI backgrounds.
 */
export default function TriangulationField() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let time = 0;

    const draw = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w < 2 || h < 2) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      time += 0.002; // Very slow drift for the nodes
      
      const cell = w < 640 ? 64 : 52;
      const cols = Math.ceil(w / cell) + 2;
      const rows = Math.ceil(h / cell) + 2;
      const ox = -cell * 0.35;
      const oy = -cell * 0.35;
      const jitter = cell * 0.45;

      const pts = [];
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
          const rawJx = (hash01(i, j) - 0.5) * jitter;
          const rawJy = (hash01(i + 17, j + 41) - 0.5) * jitter;
          
          // Add a gentle orbit around their anchor point
          const angle = time + hash01(i + 5, j + 3) * Math.PI * 2;
          const radius = hash01(i + 9, j + 7) * cell * 0.15;
          const driftX = Math.cos(angle) * radius;
          const driftY = Math.sin(angle) * radius;

          pts.push({
            x: ox + j * cell + rawJx + driftX,
            y: oy + i * cell + rawJy + driftY,
          });
        }
      }

      const idx = (i, j) => i * cols + j;
      const edges = new Map();

      const addEdge = (ia, ib) => {
        if (ia === ib) return;
        const a = Math.min(ia, ib);
        const b = Math.max(ia, ib);
        edges.set(`${a},${b}`, [a, b]);
      };

      const tri = (ia, ib, ic, fillRgba) => {
        const pa = pts[ia];
        const pb = pts[ib];
        const pc = pts[ic];
        if (!pa || !pb || !pc) return;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.lineTo(pc.x, pc.y);
        ctx.closePath();
        if (fillRgba) {
          ctx.fillStyle = fillRgba;
          ctx.fill();
        }
        addEdge(ia, ib);
        addEdge(ib, ic);
        addEdge(ic, ia);
      };

      ctx.clearRect(0, 0, w, h);

      for (let i = 0; i < rows - 1; i++) {
        for (let j = 0; j < cols - 1; j++) {
          const a = idx(i, j);
          const b = idx(i, j + 1);
          const c = idx(i + 1, j);
          const d = idx(i + 1, j + 1);
          
          // Randomly decide which diagonal to use for this cell
          const flip = hash01(i + 3, j + 9) < 0.5;
          
          // Only fill ~35% of the triangles, keeping it sparse
          const fillA = hash01(i, j) < 0.35 ? 'rgba(255,255,255,0.015)' : null;
          // Very rare cyan fills (5%)
          const fillB = hash01(i + 1, j + 1) < 0.05 ? 'rgba(34,211,238,0.015)' : 
                       (hash01(i + 1, j + 1) < 0.35 ? 'rgba(255,255,255,0.012)' : null);

          if (flip) {
            tri(a, b, d, fillA);
            tri(a, c, d, fillB);
          } else {
            tri(a, b, c, fillA);
            tri(b, c, d, fillB);
          }
        }
      }

      // Draw faint structural lines (slate)
      ctx.strokeStyle = 'rgba(148,163,184,0.06)';
      ctx.lineWidth = 0.6;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (const [, [ia, ib]] of edges) {
        const pa = pts[ia];
        const pb = pts[ib];
        if (!pa || !pb) continue;
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
      }
      ctx.stroke();

      // Highlight a small percentage of random edges in cyan
      ctx.strokeStyle = 'rgba(34,211,238,0.09)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (const [, [ia, ib]] of edges) {
        if (hash01(ia, ib) > 0.85) { // 15% chance
          const pa = pts[ia];
          const pb = pts[ib];
          if (!pa || !pb) continue;
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
        }
      }
      ctx.stroke();
    };

    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    };

    // Draw loop (now it actually animates instead of just re-drawing on resize)
    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    loop();
    const ro = new ResizeObserver(schedule);
    ro.observe(wrap);
    window.addEventListener('orientationchange', schedule);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('orientationchange', schedule);
    };
  }, []);

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden">
      <canvas ref={canvasRef} className="block h-full w-full" aria-hidden />
    </div>
  );
}
