// The doc's one row of tools (the owner's pick "A + C's side panel",
// 2026-10-21) and how it folds into ⋯ as its room narrows: with the side
// panel open, in a pane beside another doc, docked. It is always one row.
// Pure, for components/doc/DocBarA.jsx, which lays the row out from these
// ids and sizes (the selects take their widths from here, so the sums below
// are the row's real width).

// The row with room for everything, group by group (a hairline between two).
const FULL = [
  ['doc'],
  ['undo', 'redo'],
  ['style', 'font', 'size'],
  ['bold', 'italic', 'underline', 'strike', 'code', 'color', 'clear'],
  ['bullet', 'ordered', 'task', 'align'],
  ['link', 'comment'],
  ['insert'],
  ['find', 'more'],
];

// What folds first, as the room narrows: Find (⌘F, and the side panel's tab),
// the font and its size, the rarer marks, alignment, undo and redo (⌘Z),
// the colour, and last the doc's name, which leaves its icon. ⋯ never folds.
export const FOLD_STEPS = [
  ['find'],
  ['font', 'size'],
  ['strike', 'code', 'clear'],
  ['align'],
  ['undo', 'redo'],
  ['color'],
  ['docLabel'],
];

// The widths the CSS gives them (components/doc/docLook.css): buttons are
// the toolbar look's (32px, 44 under a finger), a button with a ⌄ is wider,
// and each select has its own width.
export const DOC_BAR_SIZES = {
  desktop: { bs: 32, pad: 4, gap: 1, sg: 9, caret: 46, doc: 80, docIcon: 44, style: 96, font: 86, size: 54 },
  touch: { bs: 44, pad: 4, gap: 1, sg: 9, caret: 60, doc: 88, docIcon: 52, style: 104, font: 96, size: 64 },
};

const SELECTS = new Set(['doc', 'docIcon', 'style', 'font', 'size']);
const CARETS = new Set(['align', 'insert']);

function unitWidth(id, s) {
  if (SELECTS.has(id)) return s[id];
  if (CARETS.has(id)) return s.caret;
  return s.bs;
}

export function docBarGroups(level) {
  const folded = new Set(FOLD_STEPS.slice(0, level).flat());
  const groups = FULL
    .map((g) => g.flatMap((id) => {
      if (id === 'doc') return [folded.has('docLabel') ? 'docIcon' : 'doc'];
      return folded.has(id) ? [] : [id];
    }))
    .filter((g) => g.length);
  // ⋯ alone after Find folds sits with + in one group.
  const last = groups.at(-1);
  if (last.length === 1 && last[0] === 'more' && groups.at(-2)?.at(-1) === 'insert') {
    groups.pop();
    groups.at(-1).push('more');
  }
  return groups;
}

// What ⋯ holds besides its own rows, in folding order.
docBarGroups.folded = (level) => FOLD_STEPS.slice(0, level).flat();

export function docBarWidth(groups, s) {
  let w = s.pad * 2 + s.sg * Math.max(0, groups.length - 1);
  for (const g of groups) w += g.reduce((sum, id) => sum + unitWidth(id, s), 0) + s.gap * (g.length - 1);
  return w;
}

// The least folding whose row fits in `available` px, or the most there is.
export function docBarFit(available, s) {
  for (let level = 0; level <= FOLD_STEPS.length; level++) {
    if (docBarWidth(docBarGroups(level), s) <= available) return level;
  }
  return FOLD_STEPS.length;
}
