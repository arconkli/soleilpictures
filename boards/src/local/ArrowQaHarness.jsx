import { useEffect } from 'react';
import {
  arrowColor, arrowStrokeWidth, arrowHeadSize, arrowHeadPolygon, arrowHeadStyle,
} from '../lib/arrowGeometry.js';
import { seedCrowded, builtArrows, makeArrowTestBridge } from '../lib/arrowQa.js';

// Dev-only visual + logic harness for ?arrowqa=1. Renders the deterministic
// crowded layout with the REAL arrow geometry (same computeArrowAttachments +
// buildArrowPath the editor uses) so smart-blend routing — standoff gaps, gentle
// curves, fan-out spacing, clean elbows around a wall — can be screenshotted
// without a backend. Also installs window.__soleilArrowTest so the Playwright
// spec can drive the pure assertions. Dropped from production by main.jsx's
// import.meta.env.DEV guard.
export function ArrowQaHarness() {
  useEffect(() => {
    window.__soleilArrowTest = makeArrowTestBridge();
    const root = document.getElementById('root');
    if (root) root.setAttribute('data-arrowqa-ready', '1');
  }, []);

  const { cards, arrows } = seedCrowded();
  const geom = builtArrows(cards, arrows);
  const SCALE = 0.6;
  const WORLD = { w: 1200, h: 1260 };

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'auto', background: 'var(--canvas-bg, #f6f6f4)' }}>
      <div data-arrowqa-stage style={{
        position: 'relative', width: WORLD.w * SCALE, height: WORLD.h * SCALE, margin: 24,
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, width: WORLD.w, height: WORLD.h, transform: `scale(${SCALE})`, transformOrigin: 'top left' }}>
          {/* Cards */}
          {cards.map(c => (
            <div key={c.id} data-card-id={c.id} style={{
              position: 'absolute', left: c.x, top: c.y, width: c.w, height: c.h,
              background: 'var(--bg-2, #fff)', border: '1px solid var(--line-1, #d9d9d6)',
              borderRadius: 10, boxShadow: '0 1px 2px rgba(0,0,0,.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              font: '600 13px/1 system-ui', color: 'var(--ink-2, #555)',
            }}>{c.id}</div>
          ))}
          {/* Arrows — identical render path to CanvasSurface's arrows-layer */}
          <svg width={WORLD.w} height={WORLD.h} style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible', pointerEvents: 'none' }}>
            {geom.map((g, i) => {
              if (!g) return null;
              const a = arrows[i];
              const stroke = arrowColor(a.color);
              const sw = arrowStrokeWidth(a.thickness);
              const hd = arrowHeadSize(a.thickness);
              const headStyle = arrowHeadStyle(a);
              const fwd = headStyle !== 'none' ? arrowHeadPolygon(g.att.to.point, g.built.toTangentIn, hd) : null;
              const rev = headStyle === 'double' ? arrowHeadPolygon(g.att.from.point, g.built.fromTangentIn, hd) : null;
              return (
                <g key={i} data-arrow-idx={i}>
                  <path data-arrow-line d={g.built.path} fill="none" stroke={stroke} strokeWidth={sw}
                        strokeLinecap="round" strokeLinejoin="round" />
                  {fwd && <polygon points={fwd} fill={stroke} />}
                  {rev && <polygon points={rev} fill={stroke} />}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}
