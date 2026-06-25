// Hidden, once-mounted <svg><defs> holding the SVG filters that the live photo
// adjustments reference by id (sharpness convolution + warmth color-matrix).
// CSS `filter: url(#soleil-sharpen-2)` resolves against these document-wide
// ids, so a single instance anywhere on the page is enough.
//
// The numbers come from lib/imageAdjust.js so the live preview and the download
// "bake" stay in lockstep.

import { memo } from 'react';
import { SHARPEN_KERNELS, WARMTH_LEVELS, warmthMatrixValues } from '../lib/imageAdjust.js';

function SoleilImageFiltersImpl() {
  const warmLevels = [];
  for (let n = 1; n <= WARMTH_LEVELS; n++) warmLevels.push(n);

  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false"
         style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      <defs>
        {SHARPEN_KERNELS.map((kernel, i) => (
          <filter key={`sharpen-${i + 1}`} id={`soleil-sharpen-${i + 1}`}
                  x="0" y="0" width="100%" height="100%">
            <feConvolveMatrix order="3"
                              kernelMatrix={kernel.join(' ')}
                              preserveAlpha="true"
                              edgeMode="duplicate" />
          </filter>
        ))}
        {warmLevels.map((n) => (
          <filter key={`warm-${n}`} id={`soleil-warm-${n}`}>
            <feColorMatrix type="matrix" values={warmthMatrixValues(n)} />
          </filter>
        ))}
        {warmLevels.map((n) => (
          <filter key={`cool-${n}`} id={`soleil-cool-${n}`}>
            <feColorMatrix type="matrix" values={warmthMatrixValues(-n)} />
          </filter>
        ))}
      </defs>
    </svg>
  );
}

export const SoleilImageFilters = memo(SoleilImageFiltersImpl);
export default SoleilImageFilters;
