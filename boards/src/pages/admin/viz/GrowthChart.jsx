// GrowthChart — one chart of the long-run band, drawn from lib/growthChart.js.
//
// The geometry module decides where everything goes, in the pixels the chart is
// shown at; this only paints it. Marks go in the SVG. Text goes over it as HTML
// (scale labels, dates, marker glyphs, the empty message), so it is set in the
// dashboard's own faces and never inherits a stroke.
//
// Colour follows the measure's family (viz/palette.js): blue for arriving, green
// for coming back, rose for making things, and the neutral mark for a magnitude
// with no family. Inside the well every one of those resolves to its dark step,
// in both themes. The two greys of the weekly-active stack are the palette's
// `other` (new that week) and, for the hollow week so far, the neutral mark.
//
// Pointing is the band's business, not the chart's: a move over the plot reports
// the week under the pointer, and a glyph reports the marker it stands for, so
// every chart and the list beside them light up together.

import { useId } from 'react';
import { VAR } from './palette.js';
import { glyphFor } from './markerGlyphs.js';
import { PLOT_H, weekAt } from '../../../lib/growthChart.js';

export function familyColor(family) {
  if (family === 'ink') return VAR.ink;
  return VAR.cat[family] ?? VAR.other;
}

function barPaint(b, color) {
  const tone = b.tone === 'fresh' ? VAR.other : color;
  if (!b.part) return { fill: tone };
  // The week so far: an outline, dashed, in the bar's colour. The new-that-week
  // grey is too dark to read as an outline, so it outlines in the neutral mark.
  return {
    fill: 'none',
    stroke: b.tone === 'fresh' ? VAR.ink : tone,
    strokeWidth: 1.25,
    strokeDasharray: '3 2',
  };
}

function dotPaint(d, color) {
  switch (d.kind) {
    case 'partial':
    case 'filling':
      return { fill: VAR.well, stroke: color, strokeWidth: 1.5 };
    case 'small':
    case 'lone':
      return { fill: color };
    case 'last':
      return { fill: color, stroke: VAR.well, strokeWidth: 2 };
    default:
      return { fill: color, stroke: VAR.well, strokeWidth: 1.5 };
  }
}

const markerTitle = (m) => `${String(m.day || '').slice(5)} · ${m.label}${m.migration ? ` (${m.migration})` : ''}`;

/**
 * @param {object}   geo       chartGeometry() output
 * @param {object}   measure   its GROWTH_MEASURES entry
 * @param {string}   label     the accessible name: what the chart is, and what it reads
 * @param {function} onWeek    (index | null, pointerType) => void, as the pointer moves over the plot
 * @param {function} onMarker  (id | null) => void, as the pointer enters and leaves a glyph
 */
export function GrowthChart({ geo, measure, label, onWeek, onMarker }) {
  const uid = useId();
  const color = familyColor(measure.family);
  const fillId = `${uid}-fill`;

  const point = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    onWeek?.(weekAt(geo, e.clientX - box.left), e.pointerType);
  };

  return (
    <div className="adm-gb-chart" style={{ height: geo.height }}>
      {geo.hatch.map((h, k) => (
        <div
          key={k}
          className="adm-gb-hatch"
          style={{ left: h.x, top: geo.y0, width: h.w, height: PLOT_H }}
          aria-hidden="true"
        />
      ))}
      <svg
        className="adm-gb-svg"
        width={geo.width}
        height={geo.height}
        viewBox={`0 0 ${geo.width} ${geo.height}`}
        role="img"
        aria-label={label}
        onPointerMove={point}
        onPointerDown={point}
      >
        {geo.area && (
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.26" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          </defs>
        )}
        {geo.hoverBand && (
          <rect className="adm-gb-hover" x={geo.hoverBand.x} y={geo.y0} width={geo.hoverBand.w} height={PLOT_H} />
        )}
        {geo.weekLines.map((x) => <line key={x} className="adm-gb-wk" x1={x} x2={x} y1={geo.y0} y2={geo.yb} />)}
        {geo.grid.map((g) => (
          <line key={g.y} className={g.base ? 'adm-gb-gl0' : 'adm-gb-gl'} x1={geo.x0} x2={geo.x1} y1={g.y} y2={g.y} />
        ))}
        {geo.marks.map((m, k) => (
          <line
            key={`${m.id}-${k}`}
            className={`adm-gb-mk${m.tick ? ' is-tick' : ''}${m.on ? ' is-on' : ''}`}
            data-kind={m.kind}
            x1={m.x}
            x2={m.x}
            y1={m.y1}
            y2={m.y2}
          />
        ))}
        {geo.pdiv != null && <line className="adm-gb-pdiv" x1={geo.pdiv} x2={geo.pdiv} y1={geo.y0} y2={geo.yb} />}
        {geo.area && <path className="adm-gb-area" d={geo.area} fill={`url(#${fillId})`} />}
        {geo.bars.map((b, k) => (
          <path key={k} className={`adm-gb-bar is-${b.tone}${b.part ? ' is-part' : ''}`} d={b.d} {...barPaint(b, color)} />
        ))}
        {geo.lines.map((l, k) => (
          <path key={k} className={`adm-gb-line${l.thin ? ' is-thin' : ''}`} d={l.d} stroke={color} />
        ))}
        {geo.dots.map((d, k) => (
          <circle key={k} className={`adm-gb-dot is-${d.kind}`} cx={d.cx} cy={d.cy} r={d.r} {...dotPaint(d, color)} />
        ))}
        {geo.hoverX != null && (
          <line className="adm-gb-cross" x1={geo.hoverX} x2={geo.hoverX} y1={geo.y0} y2={geo.yb} />
        )}
        {geo.hoverDot && (
          <circle
            className="adm-gb-hdot"
            cx={geo.hoverDot.cx}
            cy={geo.hoverDot.cy}
            r={3.5}
            fill={color}
            stroke={VAR.well}
            strokeWidth={2}
          />
        )}
      </svg>

      <div className="adm-gb-over" aria-hidden="true">
        {geo.grid.map((g) => (g.label
          ? <span key={g.y} className="adm-gb-y" style={{ left: geo.x0 - 6, top: g.y }}>{g.label}</span>
          : null))}
        {geo.glyphs.map((g) => (
          <span
            key={g.id}
            className={`adm-gb-glyph${g.on ? ' is-on' : ''}`}
            data-kind={g.kind}
            style={{ left: g.x, top: g.y }}
            title={markerTitle(g.marker)}
            onPointerEnter={() => onMarker?.(g.id)}
            onPointerLeave={() => onMarker?.(null)}
          >
            {glyphFor(g.kind)}
          </span>
        ))}
        {geo.ticks.map((t) => (
          <span
            key={`${t.label}-${t.x}`}
            className={`adm-gb-x${t.end ? ' is-end' : ''}${t.sofar ? ' is-sofar' : ''}`}
            style={{ left: t.x, top: geo.tickY }}
          >
            {t.label}
          </span>
        ))}
        {geo.message && (
          <span
            className="adm-gb-msg"
            // Inside the plot at any width: on a phone the sentence wraps to two lines.
            style={{ left: geo.message.x, top: geo.message.y, maxWidth: Math.max(80, geo.x1 - geo.x0 - 16) }}
          >
            {geo.message.text}
          </span>
        )}
      </div>
    </div>
  );
}
