// Dev-only board-thumbnail QA harness (?thumbqa=1). Renders a set of fixture
// boards through the REAL renderThumbnailBlob pipeline and lays the results
// out at the two sizes that matter — the board-grid tile cover and the OG
// link-preview card — so the thumbnail look can be screenshotted and
// iterated on visually with zero backend. Blob sizes are reported per
// fixture (encoded-webp KB is a shipping constraint, not a nicety).
//
// Statically dropped from production builds by the import.meta.env.DEV
// guard at the main.jsx call site.

import { useEffect, useState } from 'react';
import { renderThumbnailBlob, RENDER_VERSION } from '../lib/renderThumbnail.js';

// ── Fixture helpers ──────────────────────────────────────────────────────

let _id = 0;
const id = (p = 'c') => `${p}${++_id}`;

// Tiny SVG data-URL "photos" — gradient fills so cover-cropping and corner
// rounding are visible without any network or R2 dependency.
function svgPhoto(c1, c2, w = 640, h = 480, label = '') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="${w * 0.7}" cy="${h * 0.3}" r="${h * 0.18}" fill="rgba(255,255,255,.25)"/>
    ${label ? `<text x="24" y="${h - 28}" font-family="sans-serif" font-size="28" fill="rgba(255,255,255,.85)">${label}</text>` : ''}
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const LOREM = 'Production notes for the spring campaign shoot. Golden-hour exteriors on day one, studio coverage day two. Talent call 6:30am — confirm with agency. Backup date pending weather hold.';

function fixtures() {
  const out = [];

  // 1 — Hero moodboard: photos + notes + palette + arrows. The "money shot".
  {
    const i1 = id('img'), i2 = id('img'), i3 = id('img'), n1 = id('n'), n2 = id('n'), p1 = id('p');
    out.push({
      name: 'Moodboard (hero)',
      bgColor: null,
      cards: [
        { id: i1, kind: 'image', x: 40, y: 40, w: 360, h: 270, z: 1, src: svgPhoto('#b75c2a', '#2a1c12', 640, 480, 'amber'), title: 'Golden hour ref' },
        { id: i2, kind: 'image', x: 430, y: 40, w: 240, h: 320, z: 2, src: svgPhoto('#28425e', '#0e1722', 480, 640), caption: 'wardrobe' },
        { id: i3, kind: 'image', x: 40, y: 340, w: 240, h: 180, z: 3, src: svgPhoto('#54683a', '#161c10', 640, 480) },
        { id: n1, kind: 'note', x: 700, y: 60, w: 260, h: 180, z: 4, body: LOREM },
        { id: n2, kind: 'note', x: 720, y: 280, w: 220, h: 120, z: 5, bgColor: '#fde68a', body: 'Confirm permits for the pier location before Friday!' },
        { id: p1, kind: 'palette', x: 310, y: 380, w: 330, h: 130, z: 6, title: 'Campaign palette', swatches: [{ hex: '#b75c2a' }, { hex: '#28425e' }, { hex: '#54683a' }, { hex: '#f5f5f7' }] },
      ],
      arrows: [
        { from: n2, to: i1, color: 'orange' },
        { from: n1, to: i2, color: 'ink', dashed: true },
      ],
      strokes: [],
      boards: {},
    });
  }

  // 2 — Notes spectrum: default, painted (light + dark), transparent,
  // custom font/size, overflow text (ellipsis check).
  out.push({
    name: 'Notes spectrum',
    bgColor: null,
    cards: [
      { id: id('n'), kind: 'note', x: 0, y: 0, w: 240, h: 150, z: 1, body: 'Default note — dark surface, light ink, 15px body.' },
      { id: id('n'), kind: 'note', x: 270, y: 0, w: 240, h: 150, z: 2, bgColor: '#fde68a', body: 'Painted light note — ink should flip dark for contrast.' },
      { id: id('n'), kind: 'note', x: 540, y: 0, w: 240, h: 150, z: 3, bgColor: '#7c3aed', body: 'Painted dark note — ink stays light.' },
      { id: id('n'), kind: 'note', x: 0, y: 180, w: 240, h: 150, z: 4, bgColor: 'transparent', body: 'Transparent note — text floats on the canvas grid.' },
      { id: id('n'), kind: 'note', x: 270, y: 180, w: 240, h: 150, z: 5, fontSize: 22, fontFamily: 'display', body: 'BIG DISPLAY TYPE' },
      { id: id('n'), kind: 'note', x: 540, y: 180, w: 240, h: 150, z: 6, body: (LOREM + ' ').repeat(4) },
    ],
    arrows: [], strokes: [], boards: {},
  });

  // 3 — Brand-guidelines style (mimics the real "Clusters Logo" board that
  // motivated this rework): small labeled tiles + freehand + arrows.
  {
    const tiles = [];
    const tones = [['#f59e0b', '#7c2d12'], ['#404046', '#18181c'], ['#e5e5ea', '#9a9aa2'], ['#1c1c20', '#0a0a0c']];
    for (let r = 0; r < 2; r++) {
      for (let col = 0; col < 4; col++) {
        tiles.push({
          id: id('t'), kind: 'image', x: col * 150, y: 120 + r * 160, w: 130, h: 130, z: 10 + r * 4 + col,
          src: svgPhoto(tones[col][0], tones[col][1], 320, 320), title: r === 0 ? 'DO' : 'DO NOT',
        });
      }
    }
    const hd = id('n');
    out.push({
      name: 'Brand guidelines',
      bgColor: null,
      cards: [
        { id: hd, kind: 'note', x: 150, y: 0, w: 320, h: 70, z: 1, fontSize: 24, fontFamily: 'display', body: 'APPROVED LOGOS' },
        ...tiles,
        { id: id('n'), kind: 'note', x: 660, y: 140, w: 230, h: 130, z: 30, bgColor: '#34d399', body: 'Font: Brandon. Thumbtack orange is #FFA500 — never tint it.' },
      ],
      arrows: [{ from: hd, to: tiles[0].id, color: 'ink' }],
      strokes: [
        { points: [[640, 300], [700, 290], [760, 310], [820, 295]], color: '#ffa500', width: 3 },
      ],
      boards: {},
    });
  }

  // 4 — Shapes + freehand: every primitive, dash variants, fills, a label.
  out.push({
    name: 'Shapes & draw',
    bgColor: null,
    cards: [
      { id: id('s'), kind: 'shape', shape: 'rect', x: 0, y: 0, w: 140, h: 100, z: 1, stroke: '#f5f5f6', strokeWidth: 2 },
      { id: id('s'), kind: 'shape', shape: 'ellipse', x: 170, y: 0, w: 140, h: 100, z: 2, stroke: '#3b82f6', fill: 'rgba(59,130,246,.15)', strokeWidth: 2 },
      { id: id('s'), kind: 'shape', shape: 'diamond', x: 340, y: 0, w: 120, h: 100, z: 3, stroke: '#f59e0b', strokeWidth: 2, dash: 'dashed' },
      { id: id('s'), kind: 'shape', shape: 'triangle', x: 490, y: 0, w: 120, h: 100, z: 4, stroke: '#10b981', fill: '#10b98122', strokeWidth: 2 },
      { id: id('s'), kind: 'shape', shape: 'hexagon', x: 0, y: 130, w: 130, h: 110, z: 5, stroke: '#a855f7', strokeWidth: 3 },
      { id: id('s'), kind: 'shape', shape: 'star', x: 160, y: 130, w: 130, h: 110, z: 6, stroke: '#ffa500', fill: '#ffa50026', strokeWidth: 2, label: 'hero' },
      { id: id('s'), kind: 'shape', shape: 'line', x: 320, y: 140, w: 130, h: 90, z: 7, stroke: '#888890', strokeWidth: 2 },
      { id: id('s'), kind: 'shape', shape: 'arrow', x: 480, y: 140, w: 140, h: 90, z: 8, stroke: '#ef4444', strokeWidth: 2, dash: 'dotted' },
    ],
    arrows: [],
    strokes: [
      { points: [[660, 20], [700, 60], [680, 120], [730, 160], [700, 210]], color: '#f5f5f6', width: 3 },
      { points: [[760, 30], [820, 80], [790, 150]], color: '#ffa500', width: 6 },
    ],
    boards: {},
  });

  // 5 — Links, docs, schedule, board + boardlink cards.
  {
    const b1 = id('b'), bl = id('bl');
    out.push({
      name: 'Links & structure',
      bgColor: null,
      cards: [
        { id: id('l'), kind: 'link', x: 0, y: 0, w: 250, h: 170, z: 1, title: 'Lighting reference — overhead softbox setups', source: 'https://www.studiolighting.example/articles/softbox', description: 'A practical guide to one-light portrait setups with oversized modifiers.' },
        { id: id('l'), kind: 'link', x: 280, y: 0, w: 250, h: 190, z: 2, title: 'Location scouting gallery', source: 'unsplash.com', image: svgPhoto('#2a5e54', '#101c1a', 640, 360) },
        { id: id('l'), kind: 'link', x: 560, y: 0, w: 250, h: 150, z: 3, title: '', source: 'youtube.com/watch?v=x', embed: { provider: 'youtube', embedUrl: 'https://www.youtube.com/embed/x' } },
        { id: id('d'), kind: 'doc', x: 0, y: 210, w: 250, h: 190, z: 4, title: 'Shot list', lines: [{ t: 'Day one', h: 1 }, { t: 'EXT pier — wide establish' }, { t: 'EXT pier — talent walk', bullet: true }, { t: 'LOGISTICS', h: 3 }, { t: 'Generator + HMI rental' }] },
        { id: id('sc'), kind: 'schedule', x: 280, y: 220, w: 250, h: 170, z: 5, title: 'Shoot day', rows: [{ day: 'MON', what: 'Talent call', loc: 'Stage 2' }, { day: 'MON', what: 'Golden hour exteriors', loc: 'Pier' }, { day: 'TUE', what: 'Studio coverage' }] },
        { id: b1, kind: 'board', x: 560, y: 180, w: 220, h: 160, z: 6 },
        { id: id('blc'), kind: 'boardlink', x: 560, y: 360, w: 220, h: 110, z: 7, target: bl, note: 'Casting options live here' },
      ],
      arrows: [], strokes: [],
      boards: {
        [b1]: { name: 'Wardrobe pulls', bg_color: '#1d2433', card_count: 12 },
        [bl]: { name: 'Casting / Talent' },
      },
    });
  }

  // 6 — Single small note: the max-zoom clamp (should read as a note ON a
  // canvas, not a wall of text filling the frame).
  out.push({
    name: 'Single note (zoom clamp)',
    bgColor: null,
    cards: [{ id: id('n'), kind: 'note', x: 0, y: 0, w: 220, h: 140, z: 1, body: 'One lonely note.' }],
    arrows: [], strokes: [], boards: {},
  });

  // 7 — Sprawl: content much wider than 16:9 (letterbox top/bottom).
  {
    const cards = [];
    for (let i = 0; i < 8; i++) {
      cards.push({
        id: id('n'), kind: 'note', x: i * 360, y: (i % 2) * 90, w: 240, h: 140, z: i + 1,
        bgColor: i % 3 === 1 ? '#fde68a' : undefined, body: `Phase ${i + 1} — milestone notes and owner assignments.`,
      });
    }
    out.push({ name: 'Sprawling board', bgColor: null, cards, arrows: [{ from: cards[0].id, to: cards[3].id, color: 'blue' }], strokes: [], boards: {} });
  }

  // 8 — Custom board background color.
  out.push({
    name: 'Custom bg_color',
    bgColor: '#1d2433',
    cards: [
      { id: id('n'), kind: 'note', x: 0, y: 0, w: 250, h: 150, z: 1, body: 'This board has a custom background color set.' },
      { id: id('i'), kind: 'image', x: 290, y: 0, w: 260, h: 180, z: 2, src: svgPhoto('#3e5c8a', '#141c2c', 640, 480) },
    ],
    arrows: [], strokes: [], boards: {},
  });

  return out;
}

// ── Harness component ────────────────────────────────────────────────────

export function ThumbQaHarness() {
  const [results, setResults] = useState(null);

  useEffect(() => {
    let revoked = false;
    const urls = [];
    (async () => {
      const out = [];
      for (const f of fixtures()) {
        const t0 = performance.now();
        let url = null, kb = 0, err = null;
        try {
          const blob = await renderThumbnailBlob({
            cards: f.cards, strokes: f.strokes, arrows: f.arrows,
            boards: f.boards, bgColor: f.bgColor,
          });
          if (blob) {
            url = URL.createObjectURL(blob);
            urls.push(url);
            kb = Math.round(blob.size / 1024);
          } else err = 'null blob';
        } catch (e) { err = e?.message || String(e); }
        out.push({ name: f.name, url, kb, ms: Math.round(performance.now() - t0), err });
      }
      if (!revoked) {
        setResults(out);
        window.__soleilThumbTest = { ready: true, version: RENDER_VERSION, results: out };
      }
    })();
    return () => { revoked = true; urls.forEach(u => { try { URL.revokeObjectURL(u); } catch (_) {} }); };
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: '#111114', color: '#d0d0d4', padding: 28, fontFamily: 'aileron, system-ui, sans-serif' }}>
      <h1 style={{ color: '#f5f5f7', fontSize: 18, margin: '0 0 4px' }}>Thumbnail QA — RENDER_VERSION {RENDER_VERSION}</h1>
      <p style={{ fontSize: 12, color: '#888890', margin: '0 0 24px' }}>
        Each fixture rendered by renderThumbnailBlob. Left: OG-preview size. Right: grid-tile cover crop.
      </p>
      {!results && <div style={{ fontSize: 13 }}>rendering…</div>}
      {results && results.map(r => (
        <div key={r.name} style={{ marginBottom: 36 }} data-fixture={r.name}>
          <div style={{ fontSize: 13, color: '#f5f5f7', marginBottom: 8 }}>
            {r.name}
            <span style={{ color: '#5a5a60', marginLeft: 10, fontSize: 11 }}>
              {r.err ? `ERROR: ${r.err}` : `${r.kb} KB · ${r.ms} ms`}
            </span>
          </div>
          {r.url && (
            <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
              {/* OG link-preview framing */}
              <div style={{ width: 560, borderRadius: 12, overflow: 'hidden', border: '1px solid #2c2c32', background: '#0a0a0c' }}>
                <img src={r.url} alt="" style={{ width: '100%', display: 'block' }} />
                <div style={{ padding: '10px 14px' }}>
                  <div style={{ fontSize: 13, color: '#f5f5f7', fontWeight: 600 }}>{r.name} — Soleil Clusters</div>
                  <div style={{ fontSize: 11, color: '#888890' }}>clusters.soleilpictures.com</div>
                </div>
              </div>
              {/* Grid-tile cover crop (16:9-ish cover, like .bc-thumb--cover) */}
              <div style={{ width: 300 }}>
                <div style={{ width: 300, height: 170, overflow: 'hidden', borderRadius: '10px 10px 0 0', position: 'relative' }}>
                  <img src={r.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </div>
                <div style={{ background: '#16161a', borderRadius: '0 0 10px 10px', padding: '8px 12px', fontSize: 12, color: '#f5f5f7' }}>
                  {r.name}
                  <div style={{ fontSize: 10.5, color: '#5a5a60' }}>tile cover crop</div>
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
