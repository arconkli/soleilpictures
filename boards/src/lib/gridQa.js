// DEV-only Grid QA bridge (see localMode.isGridQaMode). Pure grid-layout +
// grid-sequence helpers + deterministic seeds, published on window.__soleilGridTest
// by main.jsx under ?gridqa=1 so the Playwright spec (tests/grids.spec.js) can
// assert the load-bearing behaviour — exact cell tiling, the shared-edge divider
// constraint, split/merge invariants, spatial sequence ordering + auto-renumber,
// and label resolution — with no backend. Mirrors lib/snapQa.js / lib/arrowQa.js.
import {
  GRID_TUNING, computeCellRects, collectDividers, resizeDivider, splitCell,
  mergeCell, removeDivider, dividerSnapTargets, leafIds, normalizeTree, presetTree, PRESETS,
} from './gridLayout.js';
import {
  SEQ_TUNING, spatialOrder, labelFor, resolveTagText, hasLabelTag, orderKey,
} from './gridSequence.js';

// Deterministic id generator so seeded trees have stable, inspectable ids.
function counter() { let n = 0; return () => 'c' + (++n); }

// The canonical storyboard layout: col[ topLeaf(0.5), row[ bL(0.5), bR(0.5) ](0.5) ].
// Leaf ids are c1 (top), c2 (bottom-left), c3 (bottom-right). The bottom row sits
// at path [1]; its single divider is childIndex 0 (between c2 and c3).
export function seedGridLayout() {
  return presetTree('storyboard-1-2', counter());
}

// A C×R matrix of Grid rects on an aligned lattice, ids `g<row>_<col>`.
export function seedGridMatrix(cols = 3, rows = 2, cw = 200, ch = 150, gap = 20) {
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({ id: `g${r}_${c}`, x: c * (cw + gap), y: r * (ch + gap), w: cw, h: ch });
    }
  }
  return out;
}

export function makeGridTestBridge() {
  return {
    GRID_TUNING, SEQ_TUNING, PRESETS,
    computeCellRects, collectDividers, resizeDivider, splitCell, mergeCell,
    removeDivider, dividerSnapTargets, leafIds, normalizeTree, presetTree,
    spatialOrder, labelFor, resolveTagText, hasLabelTag, orderKey,
    seedGridLayout, seedGridMatrix,
  };
}
