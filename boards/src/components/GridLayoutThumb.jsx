import { computeCellRects, readingOrder } from '../lib/gridLayout.js';
import './gridLayoutThumb.css';

// A layout, drawn the way the card actually draws it.
//
// Pure SVG — no images, no network, no measurement — so a panel of thirty
// renders in one frame, works offline, and works under ?local=1. It renders from
// the SAME computeCellRects the card uses, so the preview and the grid you get
// after clicking are the same tiling by construction rather than by a designer
// keeping two things in sync.
//
// `labels` draws the cell hints INSIDE the boxes, which is what the real card
// does (.gridc-hint: centred, uppercase, tracked, ink-3 at .75) — so a preview
// answers "what goes in each box" by looking like the thing you are about to
// place, rather than by a numbered legend beside it.
//
// The coordinate space is 280 wide rather than the old 56 for one reason: text.
// A hint is ~11px in a ~360px-wide card, and at 56 units wide there is no font
// size that renders a word legibly.
//
// `size` is the layout's REAL card size, and passing it is what makes a preview
// truthful. A template's proportions ARE the template — a contact sheet's frames
// are 3:2 because that is a 35mm negative, and a posting grid is 3:4 because that
// is what a profile crops to. Drawn into a fixed landscape box they all come out
// as squares, which is the same picture for two different products. Only the
// WIDTH is normalized (always 280): every thumb then shares one scale factor when
// CSS sets `width: 100%`, so stroke weights and label sizes stay consistent
// across the grid instead of a portrait layout drawing itself in heavier ink.
//
// With no `size` the old 280×220 box is used exactly, so the bare presets and the
// save dialog render byte-identically to before.
//
// `numbered` and `highlight` are the save dialog's, where the diagram has to
// answer "which box is field 2". Numbering follows READING ORDER — how hints are
// indexed and how a person counts boxes, not the depth-first order the tree
// stores them in.

const VB_W = 280;                   // coordinate-space width, always
const OUT_W = 56;                   // intrinsic width, always
const FALLBACK_RATIO = 220 / 280;   // the box used before layouts carried a size
const INSET = 4;                    // hairline gap so boxes read as separate
const FONT = 11;                    // matches .gridc-hint's 11px in a ~360px card
const CHAR = 0.66;                  // uppercase + .06em tracking, measured against the render

// SVG text does not wrap, so a label has to be laid out here. Up to two lines,
// then an ellipsis — the same shape the real hint takes when a box is too small
// for it, and better than a word running out past the cell edge.
function fitLabel(text, boxW, font) {
  const max = Math.max(1, Math.floor((boxW - font * 0.4) / (font * CHAR)));
  const words = String(text).trim().split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= max) { cur = next; continue; }
    if (cur) lines.push(cur);
    cur = w;
    if (lines.length === 2) break;
  }
  if (cur && lines.length < 2) lines.push(cur);
  // A single word longer than the box still has to stop somewhere.
  return lines.slice(0, 2).map((l) => (l.length > max ? `${l.slice(0, Math.max(1, max - 1))}…` : l));
}

// The coordinate space a layout is drawn in. Clamped so an extreme layout can't
// draw a tile ten screens tall; nothing in the catalogue is near either end, but
// a community template is a tree a stranger authored and this is the boundary it
// renders at.
function viewBoxFor(size) {
  const ratio = size?.w > 0 && size?.h > 0
    ? Math.min(2.2, Math.max(0.4, size.h / size.w))
    : FALLBACK_RATIO;
  return {
    VB: { w: VB_W, h: Math.round(VB_W * ratio) },
    SIZE: { w: OUT_W, h: Math.round(OUT_W * ratio) },
  };
}

// Shrink to fit a short box rather than overflowing it — a 9-cell grid has a
// third the height of a 3-cell one for the same label.
const fontFor = (cellH) => Math.min(FONT, Math.max(6, Math.max(0, cellH - INSET * 2) * 0.34));

// The size the SMALLEST label on this layout will be drawn at, in VIEWBOX UNITS.
//
// Exported because the store has to decide which templates need a bigger tile,
// and only this module can answer "how small will the smallest label get" — it
// owns the formula. Cell count is a bad proxy and measurably so: the vertical
// storyboard has EIGHT cells and its smallest label lands at 4.9px on a shelf
// where a nine-cell mood board lands at 9px, because a caption band under a 9:16
// panel is thin and the card it sits on is wide. Counting boxes would have given
// that one a small tile and a nine-cell one a large tile, backwards.
export function minHintFontFor(tree, size, labels) {
  if (!tree || !labels?.length) return FONT;
  const { VB } = viewBoxFor(size);
  const rects = computeCellRects(tree, { x: 0, y: 0, w: VB.w, h: VB.h });
  const order = new Map(readingOrder(rects).map((id, i) => [id, i]));
  let min = FONT;
  for (const r of rects) {
    const i = order.get(r.id);
    // Unlabelled cells cannot be illegible — a contact sheet's 36 blank frames
    // must not drag this down.
    if (i == null || !labels[i]) continue;
    min = Math.min(min, fontFor(r.h));
  }
  return min;
}

export function GridLayoutThumb({ tree, title, size = null, labels = null, numbered = false, highlight = -1 }) {
  const { VB, SIZE } = viewBoxFor(size);
  const rects = tree ? computeCellRects(tree, { x: 0, y: 0, w: VB.w, h: VB.h }) : [];
  // Map cell id → its position in reading order, so a rect can find its number
  // or its label. This is the one place index-keyed hints meet the drawn cells.
  const order = (labels || numbered || highlight >= 0)
    ? new Map(readingOrder(rects).map((id, i) => [id, i]))
    : null;

  return (
    <svg
      className={`tplt-thumb${numbered ? ' is-numbered' : ''}${labels ? ' is-labelled' : ''}`}
      viewBox={`0 0 ${VB.w} ${VB.h}`}
      width={SIZE.w}
      height={SIZE.h}
      role="img"
      aria-label={[
        title ? `${title} layout` : 'Layout preview',
        `${rects.length} ${rects.length === 1 ? 'box' : 'boxes'}`,
        // role="img" hides the SVG's contents from assistive tech, so the cell
        // labels have to be in the accessible name or they are invisible to it.
        labels?.length ? `labelled ${labels.filter(Boolean).join(', ')}` : null,
      ].filter(Boolean).join(' — ')}
    >
      {rects.map((r) => {
        const i = order ? order.get(r.id) : -1;
        const on = i >= 0 && i === highlight;
        const w = Math.max(0, r.w - INSET * 2);
        const h = Math.max(0, r.h - INSET * 2);
        const font = fontFor(r.h);
        const label = labels && i >= 0 ? labels[i] : null;
        const lines = label ? fitLabel(label, w, font) : [];
        return (
          <g key={r.id}>
            <rect
              className={on ? 'is-highlight' : undefined}
              x={r.x + INSET} y={r.y + INSET} width={w} height={h} rx="4"
            />
            {numbered && i >= 0 && (
              <text
                className={on ? 'is-highlight' : undefined}
                x={r.x + r.w / 2} y={r.y + r.h / 2}
                textAnchor="middle" dominantBaseline="central"
              >
                {i + 1}
              </text>
            )}
            {lines.map((line, li) => (
              <text
                key={li}
                className="tplt-cell-hint"
                x={r.x + r.w / 2}
                // Centre the block, then step each line down from it.
                y={r.y + r.h / 2 + (li - (lines.length - 1) / 2) * font * 1.25}
                fontSize={font}
                textAnchor="middle" dominantBaseline="central"
              >
                {line}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
