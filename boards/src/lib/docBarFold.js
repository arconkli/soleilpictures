// The doc's one row of tools (the owner's pick "A + C's side panel",
// 2026-10-21) and how it folds into ⋯ as its room narrows: with the side
// panel open, in a pane beside another doc, docked. It is always one row.
// On a phone the row rides on the keyboard instead (docBarPhoneGroups).
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
// the colour, and the doc's name, which leaves its icon. A docked doc can be
// a quarter of the window, so then the link (⌘K), the lists and comment, the
// doc's type and its style, until B I U, + and ⋯ are all there is. ⋯ never
// folds.
export const FOLD_STEPS = [
  ['find'],
  ['font', 'size'],
  ['strike', 'code', 'clear'],
  ['align'],
  ['undo', 'redo'],
  ['color'],
  ['docLabel'],
  ['link'],
  ['ordered'],
  ['comment'],
  ['task'],
  ['bullet'],
  ['doc'],
  ['style'],
];

// Under a finger (the mockups' A-ipad and AC-ipad) there's no ⌘F, and each
// tool takes more room: the fonts, the rarer marks, alignment and the colour
// fold first, so Find stays (A-ipad), then undo and redo, Find, the link,
// the numbered list and the doc's name (AC-ipad, the side panel open), then
// as above.
export const TOUCH_FOLD_STEPS = [
  ['font', 'size'],
  ['strike', 'code', 'clear'],
  ['align'],
  ['color'],
  ['undo', 'redo'],
  ['find'],
  ['link'],
  ['ordered'],
  ['docLabel'],
  ['comment'],
  ['task'],
  ['bullet'],
  ['doc'],
  ['style'],
];

// A screenplay's row (the mockup's AC-script): its element, title page, scene
// numbers and dual dialogue are the side panel's Elements, and Find is in ⋯
// (and ⌘F), so the row is its type, undo and redo, link, comment and
// bookmark, and ⋯. It folds the bookmark, the link, undo and redo, then its
// name.
const SCRIPT_FULL = [
  ['script'],
  ['undo', 'redo'],
  ['link', 'comment', 'bookmark'],
  ['more'],
];
export const SCRIPT_FOLD_STEPS = [
  ['bookmark'],
  ['link'],
  ['undo', 'redo'],
  ['docLabel'],
];
const ROWS = {
  doc: { full: FULL, steps: FOLD_STEPS, touchSteps: TOUCH_FOLD_STEPS },
  script: { full: SCRIPT_FULL, steps: SCRIPT_FOLD_STEPS },
};
// `input`: 'desktop' (a mouse) or 'touch' (a finger), whose folding differs.
const rowOf = (kind, input = 'desktop') => {
  const row = ROWS[kind] || ROWS.doc;
  return { full: row.full, steps: (input === 'touch' && row.touchSteps) || row.steps };
};

// The widths the CSS gives them (components/doc/docLook.css): buttons are
// the toolbar look's (32px, 44 under a finger), a button with a ⌄ is wider,
// and each select has its own width.
export const DOC_BAR_SIZES = {
  desktop: { bs: 32, pad: 4, gap: 1, sg: 9, caret: 46, doc: 80, docIcon: 44, script: 128, style: 96, font: 86, size: 54 },
  touch: { bs: 44, pad: 4, gap: 1, sg: 9, caret: 60, doc: 88, docIcon: 52, script: 136, style: 104, font: 96, size: 64 },
};

const SELECTS = new Set(['doc', 'docIcon', 'script', 'style', 'font', 'size']);
const CARETS = new Set(['align', 'insert']);

function unitWidth(id, s) {
  if (id === 'scriptIcon') return s.docIcon;
  if (SELECTS.has(id)) return s[id];
  if (CARETS.has(id)) return s.caret;
  return s.bs;
}

export function docBarGroups(level, kind = 'doc', input = 'desktop') {
  const { full, steps } = rowOf(kind, input);
  const folded = new Set(steps.slice(0, level).flat());
  const groups = full
    .map((g) => g.flatMap((id) => {
      if (folded.has(id)) return [];
      if ((id === 'doc' || id === 'script') && folded.has('docLabel')) return [`${id}Icon`];
      return [id];
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
docBarGroups.folded = (level, kind = 'doc', input = 'desktop') => rowOf(kind, input).steps.slice(0, level).flat();

// A phone's row, on the keyboard (mockup A-phone): it scrolls sideways
// rather than fold, and ⋯ holds the rest of the text's tools. What the
// doc's ⋯ holds besides (Find, the layout, the zoom, Export, the counts) is
// the header's ⋯ there, which is the same whether the keyboard is up or
// not. A screenplay's is its element, undo and redo, link, comment and
// bookmark; its title page, scene numbers and dual dialogue are the side
// panel's Elements, in the header's ⋯.
const PHONE = {
  doc: [['style'], ['bold', 'italic', 'underline'], ['bullet', 'ordered', 'task'], ['link', 'comment'], ['insert', 'more']],
  script: [['element'], ['undo', 'redo'], ['link', 'comment', 'bookmark']],
};
const PHONE_MORE = {
  doc: ['font', 'size', 'strike', 'code', 'color', 'clear', 'align', 'undo', 'redo'],
  script: [],
};
export function docBarPhoneGroups(kind = 'doc') {
  return (PHONE[kind] || PHONE.doc).map((g) => [...g]);
}
docBarPhoneGroups.folded = (kind = 'doc') => [...(PHONE_MORE[kind] || PHONE_MORE.doc)];

export function docBarWidth(groups, s) {
  let w = s.pad * 2 + s.sg * Math.max(0, groups.length - 1);
  for (const g of groups) w += g.reduce((sum, id) => sum + unitWidth(id, s), 0) + s.gap * (g.length - 1);
  return w;
}

// The least folding whose row fits in `available` px, or the most there is.
export function docBarFit(available, s, kind = 'doc', input = 'desktop') {
  const { steps } = rowOf(kind, input);
  for (let level = 0; level <= steps.length; level++) {
    if (docBarWidth(docBarGroups(level, kind, input), s) <= available) return level;
  }
  return steps.length;
}
