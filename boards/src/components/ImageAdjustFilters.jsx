// Per-card SVG photo-adjustment filters. Renders one hidden <filter
// id="soleil-adj-<cardId>"> for every image card that has filter-stage
// adjustments; the card's <img> (and the lightbox / full-screen editor)
// reference it via CSS `filter: url(#soleil-adj-<cardId>)`.
//
// Mounted ONCE in CanvasSurface, OUTSIDE the transformed canvas layer, and keyed
// off `cards.filter(hasFilterStages)` (not mounted cards) so the id resolves
// document-wide even when the canvas card is viewport-culled while the lightbox
// or modal is open.
//
// `color-interpolation-filters="sRGB"` is MANDATORY: SVG filters default to
// linearRGB, but the canvas download bake works on sRGB bytes — without sRGB
// here the live preview would not match the downloaded file.

import { memo } from 'react';
import {
  normalizeAdjust, hasFilterStages, adjustFilterId,
  toneActive, colorActive, buildToneTable, buildColorMatrix,
  buildSharpenKernel, clarityParams,
} from '../lib/imageAdjust.js';

function buildPrimitives(n) {
  const prims = [];
  let last = 'SourceGraphic';

  if (toneActive(n)) {
    const tv = buildToneTable(n);
    prims.push(
      <feComponentTransfer key="tone" in={last} result="adjTone">
        <feFuncR type="table" tableValues={tv} />
        <feFuncG type="table" tableValues={tv} />
        <feFuncB type="table" tableValues={tv} />
      </feComponentTransfer>
    );
    last = 'adjTone';
  }

  if (colorActive(n)) {
    prims.push(
      <feColorMatrix key="color" in={last} type="matrix"
                     values={buildColorMatrix(n).join(' ')} result="adjColor" />
    );
    last = 'adjColor';
  }

  if (n.clarity !== 0) {
    // Linear unsharp (high-pass add): out = src + amt*(src - blur). Scales with
    // clarity sign (negative softens). Mid-tone weighting is the bake's exactness
    // refinement; live applies it uniformly.
    const { c, stdDev, gain } = clarityParams(n);
    const amt = c * gain;
    prims.push(
      <feGaussianBlur key="cblur" in={last} stdDeviation={stdDev} result="adjCBlur" />,
      <feComposite key="clarity" in={last} in2="adjCBlur" operator="arithmetic"
                   k1="0" k2={1 + amt} k3={-amt} k4="0" result="adjClarity" />
    );
    last = 'adjClarity';
  }

  if (n.sharpness !== 0) {
    prims.push(
      <feConvolveMatrix key="sharp" in={last} order="3"
                        kernelMatrix={buildSharpenKernel(n.sharpness).join(' ')}
                        preserveAlpha="true" edgeMode="duplicate" result="adjOut" />
    );
    last = 'adjOut';
  }

  return prims;
}

const PerCardFilter = memo(function PerCardFilter({ cardId, adjust }) {
  const n = normalizeAdjust(adjust);
  if (!n) return null;
  return (
    <filter id={adjustFilterId(cardId)} colorInterpolationFilters="sRGB"
            x="-5%" y="-5%" width="110%" height="110%">
      {buildPrimitives(n)}
    </filter>
  );
});

function ImageAdjustFiltersImpl({ cards }) {
  const edited = (cards || []).filter((c) => c.kind === 'image' && hasFilterStages(c.adjust));
  if (edited.length === 0) return null;
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false"
         style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      <defs>
        {edited.map((c) => <PerCardFilter key={c.id} cardId={c.id} adjust={c.adjust} />)}
      </defs>
    </svg>
  );
}

export const ImageAdjustFilters = memo(ImageAdjustFiltersImpl);
export default ImageAdjustFilters;
