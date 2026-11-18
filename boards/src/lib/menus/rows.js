// The right-click menus' row catalogue and the helpers that turn a surface's
// actions ("acts") into menu items. Pure: no React, no DOM, no fetch.
//
// ROWS[id] = { icon, label: (act) => t`…`, shortcut?: () => string, hint?, danger?, search? }.
// Labels are functions: Lingui's `t` runs when a menu is built, never at module
// scope, so the words follow the language.
//
// An act is a function, or { run, label?, icon?, hint?, aside?, checked?, radio?,
// disabled?, submenu?, search?, danger?, shortcut?, swatch? }. A row shows only
// when its act is present; the builders (cardMenu.js and the others) decide
// which rows, in what order. The item shape is the menu component's
// ({ id, label, icon, shortcut, hint, aside, danger, disabled, checked, radio,
// swatch, submenu, search, run }, { divider }, { caption }, { backlinks: true }).

import { t, plural } from '@lingui/core/macro';
import { tidyMenu } from '../menuKeys.js';
import { mod, shift, plain, del } from './shortcuts.js';

const R = (icon, label, extra = {}) => ({ icon, label, ...extra });
const px = (n) => t`${n} px`;

export const ROWS = {
  // ── open group ──
  'view-full': R('ArrowsOut', () => t`View full size`),
  'edit-photo': R('SlidersHorizontal', () => t`Edit photo…`),
  edit: R('PencilSimple', () => t({ message: 'Edit', context: 'menu' })),
  'open-player': R('PlayCircle', () => t`Open in player`),
  open: R('ArrowSquareOut', () => t({ message: 'Open', context: 'verb' })),
  'open-link': R('ArrowSquareOut', () => t`Open link`),
  'open-doc': R('FileText', () => t`Open doc`),
  'open-sketch': R('Scribble', () => t`Open sketch`),
  'open-cluster': R('ArrowSquareOut', () => t`Open cluster`),
  'open-linked': R('ArrowSquareOut', () => t`Open linked cluster`),
  'fit-content': R('ArrowsInLineVertical', () => t`Fit to content`),
  shape: R('Shapes', () => t({ message: 'Shape', context: 'menu' })),
  stroke: R('LineSegment', () => t`Stroke`),
  spacing: R('ArrowsOutLineHorizontal', () => t`Spacing`),
  'reading-order': R('ListNumbers', () => t`Reading order`),
  templates: R('Layout', () => t`Templates`),
  'generate-matrix': R('Table', () => t`Generate matrix…`),
  'schedule-view': R('CalendarBlank', () => t({ message: 'View', context: 'schedule' })),
  'go-today': R('CalendarCheck', () => t`Go to today`),
  eyedrop: R('Eyedropper', () => t`Eyedrop color…`),
  'pick-from-image': R('ImageSquare', () => t`Pick from cluster image…`),
  labels: R('TextAa', () => t({ message: 'Labels', context: 'palette' })),
  'color-cover': R('Palette', () => t`Color and cover`),
  // ── edit submenu ──
  rename: R('PencilSimple', () => t`Rename…`),
  caption: R('TextAlignLeft', () => t`Caption…`),
  hyperlink: R('Link', () => t({ message: 'Link…', context: 'image hyperlink' })),
  'replace-image': R('ImageSquare', () => t`Replace image…`),
  'upload-version': R('UploadSimple', () => t`Upload new version…`),
  autoplay: R('PlayCircle', () => t`Autoplay`),
  loop: R('Repeat', () => t`Loop`),
  'start-here': R('MapPin', () => t`Start here`),
  'start-at': R('Timer', () => t`Start at…`),
  'clear-start': R('X', () => t`Clear start point`),
  cover: R('Image', (a) => (a.has ? t`Replace cover image…` : t`Cover image…`)),
  'remove-cover': R('ImageBroken', () => t`Remove cover image`),
  // ── share group ──
  send: R('PaperPlaneTilt', () => t`Send to…`),
  'share-cluster': R('ShareNetwork', () => t`Share…`),
  'copy-link': R('LinkSimple', () => t`Copy link`),
  'share-file': R('ShareNetwork', () => t`Share file…`),
  'share-doc': R('ShareNetwork', () => t`Share doc…`),
  download: R('DownloadSimple', () => t`Download`),
  // ── organize group ──
  comment: R('ChatCircle', () => t`Add comment`),
  'note-comments': R('ChatsCircle', (a) => { const count = a.count ?? 0; return plural(count, { one: '# comment', other: '# comments' }); }),
  vote: R('ListChecks', () => t`Add vote`),
  move: R('Folder', () => t`Move to cluster`, { search: () => ({ placeholder: t`Find a cluster` }) }),
  'copy-to': R('CopySimple', () => t`Copy to cluster`, { search: () => ({ placeholder: t`Find a cluster` }) }),
  'add-to-group': R('BoundingBox', () => t`Add to group`),
  'group-menu': R('BoundingBox', (a) => { const name = a.name ?? ''; return t`Group "${name}"`; }),
  'group-these': R('BoundingBox', () => t({ message: 'Group', context: 'verb' }), { shortcut: () => mod('G') }),
  'remove-from-group': R('SignOut', () => t`Remove from group`),
  'new-cluster-from': R('FolderPlus', () => t`New cluster from these`),
  align: R('AlignLeft', () => t`Align`),
  arrange: R('Stack', () => t`Arrange`),
  tidy: R('Broom', () => t`Tidy up`),
  // ── clipboard (the quick row on card menus) ──
  cut: R('Scissors', () => t`Cut`, { shortcut: () => mod('X') }),
  copy: R('Copy', () => t({ message: 'Copy', context: 'verb' }), { shortcut: () => mod('C') }),
  duplicate: R('PlusSquare', () => t`Duplicate`, { shortcut: () => mod('D') }),
  delete: R('Trash', () => t`Delete`, { shortcut: () => del(), danger: true }),
  // ── info group ──
  star: R('Star', (a) => (a.starred ? t({ message: 'Unstar', context: 'verb' }) : t({ message: 'Star', context: 'verb' }))),
  info: R('Info', () => t`Info`, { shortcut: () => mod('I') }),
  'copy-to-workspace': R('CopySimple', () => t`Copy to my workspace`),
  // ── Move to cluster › ──
  'new-cluster': R('FolderPlus', () => t`New cluster…`),
  'top-level': R('ArrowBendUpLeft', () => t`Top level`),
  'keep-in-files': R('TrayArrowDown', () => t`Keep in Files only`, { hint: () => t`Takes it off the canvas` }),
  // ── Arrange › ──
  'arrange-front': R('ArrowLineUp', () => t`Bring to front`),
  'arrange-forward': R('ArrowUp', () => t`Bring forward`, { shortcut: () => plain(']') }),
  'arrange-backward': R('ArrowDown', () => t`Send backward`, { shortcut: () => plain('[') }),
  'arrange-back': R('ArrowLineDown', () => t`Send to back`),
  // ── Align › ──
  'align-left': R('AlignLeft', () => t`Align left`),
  'align-center': R('AlignCenterHorizontal', () => t`Align center`),
  'align-right': R('AlignRight', () => t`Align right`),
  'align-top': R('AlignTop', () => t`Align top`),
  'align-middle': R('AlignCenterVertical', () => t`Align middle`),
  'align-bottom': R('AlignBottom', () => t`Align bottom`),
  'distribute-h': R('ArrowsHorizontal', () => t`Distribute horizontally`),
  'distribute-v': R('ArrowsVertical', () => t`Distribute vertically`),
  // ── Tidy up › ──
  'tidy-justified': R('Rows', () => t`Justified rows`),
  'tidy-masonry': R('Columns', () => t`Masonry columns`),
  'tidy-grid': R('GridFour', () => t`Grid`),
  'tidy-row': R('ArrowsHorizontal', () => t`Single row`),
  'tidy-column': R('ArrowsVertical', () => t`Single column`),
  // ── Stroke › / Templates › ──
  'stroke-color': R('Palette', () => t`Stroke color…`),
  'fill-color': R('PaintBucket', () => t`Fill color…`),
  'stroke-1': R(null, () => px(1)),
  'stroke-2': R(null, () => px(2)),
  'stroke-4': R(null, () => px(4)),
  'stroke-8': R(null, () => px(8)),
  'save-template': R('FloppyDisk', () => t`Save as template…`),
  'apply-template': R('Layout', () => t`Apply template…`),
  'share-layout': R('ShareNetwork', () => t`Share layout`),
  // ── cluster colour and cover › ──
  'cover-custom': R(null, () => t`Custom…`),
  'upload-thumb': R('UploadSimple', () => t`Upload custom thumbnail…`),
  'reset-thumb': R('ArrowCounterClockwise', () => t`Reset to auto thumbnail`),
  // ── group menu ──
  'rename-group': R('PencilSimple', () => t`Rename group…`),
  'group-comment': R('ChatCircle', () => t`Add comment`),
  outline: R('BoundingBox', () => t`Outline`),
  'group-label': R('TextT', () => t({ message: 'Label', context: 'group label' })),
  'outline-shape': R('Selection', () => t`Outline shape`),
  'outline-box': R(null, () => t`Box`),
  'outline-hug': R(null, () => t`Hug`),
  'outline-color': R('Palette', () => t`Outline color…`),
  'turn-into-cluster': R('FolderPlus', () => t`Turn into cluster…`),
  'group-info': R('Info', () => t`Group info`),
  ungroup: R('SelectionSlash', () => t`Ungroup`, { danger: true }),
  // ── arrow menu ──
  'arrow-label': R('TextT', (a) => (a.has ? t`Edit label…` : t`Add label…`)),
  curved: R('BezierCurve', () => t`Curved`),
  'two-way': R('ArrowsLeftRight', () => t`Two-way`),
  dashed: R('LineSegments', () => t`Dashed`),
  'reset-curve': R('ArrowCounterClockwise', () => t`Reset curve`),
  'delete-arrow': R('Trash', () => t`Delete arrow`, { danger: true }),
  // ── comment pin ──
  'open-comment': R('ChatCircle', () => t({ message: 'Open', context: 'verb' })),
  resolve: R('CheckCircle', () => t`Resolve`),
  reopen: R('ArrowCounterClockwise', () => t`Reopen`),
  'copy-comment-link': R('LinkSimple', () => t`Copy link`),
  'delete-comment': R('Trash', () => t`Delete`, { danger: true }),
  // ── canvas menu ──
  'delete-drawn': R('Trash', () => t`Delete drawing`, { danger: true }),
  add: R('Plus', () => t({ message: 'Add', context: 'menu' })),
  paste: R('ClipboardText', () => t`Paste here`, { shortcut: () => mod('V') }),
  'select-all': R('SelectionAll', () => t`Select all`, { shortcut: () => mod('A') }),
  'select-touch': R('CheckSquare', () => t`Select…`),
  fit: R('CornersOut', () => t`Fit everything`, { shortcut: () => shift('1') }),
  background: R('PaintBucket', () => t`Background`),
  export: R('Export', () => t`Export`),
  'export-png': R('Image', () => t`PNG image`),
  'export-pdf': R('FilePdf', () => t`PDF (Save from Print)`),
  'cluster-info': R('Info', () => t`Cluster info`, { shortcut: () => mod('I') }),
  'clear-drawings': R('Eraser', () => t`Clear all drawings`, { danger: true }),
  // ── Add › (and the canvas menu's quick-add row) ──
  // N, C and G pick a TOOL (a click then places the card); only Draw and Arrow's
  // keys do what their rows do, so only they show one.
  'add-note': R('NotePencil', () => t`Note`),
  'add-image': R('Image', () => t`Image`),
  'add-cluster': R('Folder', () => t`Cluster`),
  'add-linked-cluster': R('ArrowSquareOut', () => t`Linked cluster`),
  'add-doc': R('FileText', () => t`Doc`),
  'add-file': R('Paperclip', () => t`File`),
  'add-folder': R('FolderSimple', () => t`Folder`),
  'add-grid': R('GridFour', () => t`Grid`),
  'add-schedule': R('CalendarBlank', () => t`Schedule`),
  'add-shape': R('Square', () => t({ message: 'Shape', context: 'add card' })),
  'add-palette': R('Palette', () => t`Color palette`),
  'add-draw': R('Scribble', () => t`Draw`, { shortcut: () => plain('D') }),
  'add-arrow': R('ArrowUpRight', () => t`Arrow`, { shortcut: () => plain('A') }),
  'add-link': R('Link', () => t`Link`),
  'add-comment': R('ChatCircle', () => t`Comment`),
  'add-vote': R('ListChecks', () => t`Vote`),
  // ── cluster menu ──
  'new-inside': R('FolderPlus', () => t`New cluster inside`),
  'move-cluster': R('Folder', () => t`Move to…`),
  more: R('DotsThree', () => t`More`),
  'copy-cluster': R('Copy', () => t({ message: 'Copy', context: 'verb' })),
  'paste-into': R('ClipboardText', () => t`Paste into this cluster`),
  'opens-in-files': R('FolderOpen', () => t`Always open in Files`),
  'remove-from-list': R('MinusCircle', () => t`Remove from my list`),
  // ── file menu ──
  select: R('CheckSquare', () => t({ message: 'Select', context: 'verb' })),
  'quick-look': R('Eye', () => t`Quick look`, { shortcut: () => plain('Space') }),
  'show-in-files': R('FolderOpen', () => t`Show in Files`),
  'show-on-canvas': R('Crosshair', () => t`Show on board`),
  'put-on-canvas': R('ArrowSquareIn', () => t`Put on board`),
  'move-file': R('Folder', () => t`Move to…`),
  'copy-file': R('CopySimple', () => t`Copy to…`),
  upload: R('UploadSimple', () => t`Upload files…`),
};

// Submenus the builders assemble themselves from the surface's acts: the parent
// row shows when at least one child has an act. A nested array is a group (a
// divider between groups).
export const STATIC_SUBMENUS = {
  stroke: [['stroke-color', 'fill-color'], ['stroke-1', 'stroke-2', 'stroke-4', 'stroke-8']],
  templates: [['save-template', 'apply-template', 'share-layout']],
  arrange: [['arrange-front', 'arrange-forward', 'arrange-backward', 'arrange-back']],
  align: [['align-left', 'align-center', 'align-right', 'align-top', 'align-middle', 'align-bottom'], ['distribute-h', 'distribute-v']],
  tidy: [['tidy-justified', 'tidy-masonry', 'tidy-grid', 'tidy-row', 'tidy-column']],
  'outline-shape': [['outline-box', 'outline-hug']],
  export: [['export-png', 'export-pdf']],
  more: [['copy-cluster', 'paste-into', 'opens-in-files']],
};

const asAct = (act) => (act === true ? {} : typeof act === 'function' ? { run: act } : act);

// One item from the catalogue and an act (null when there is no act, or no such
// row). `over` is the builder's own override of the act's fields (a label or a
// hint the builder knows better), applied last.
export function row(id, act, over) {
  const def = ROWS[id];
  if (!def || !act) return null;
  const a = { ...asAct(act), ...over };
  const it = { id, label: a.label != null ? a.label : def.label(a) };
  const icon = a.icon ?? def.icon;
  if (icon) it.icon = icon;
  const shortcut = 'shortcut' in a ? a.shortcut : def.shortcut?.();
  if (shortcut) it.shortcut = shortcut;
  const hint = a.hint ?? def.hint?.();
  if (hint) it.hint = hint;
  if (a.aside) it.aside = a.aside;
  if (a.danger ?? def.danger) it.danger = true;
  if (a.disabled) it.disabled = true;
  if (a.checked !== undefined) it.checked = !!a.checked;
  if (a.radio) it.radio = true;
  if (a.swatch) it.swatch = a.swatch;
  if (a.submenu) {
    it.submenu = a.submenu;
    const search = a.search ?? def.search?.();
    if (search) it.search = search;
  }
  const run = typeof act === 'function' ? act : a.run;
  if (run) it.run = run;
  return it;
}

// A row whose children the builder assembles (STATIC_SUBMENUS), or that the
// surface fills itself through act.submenu. Null when it would be empty.
function parentRow(id, acts, over) {
  const own = acts?.[id];
  const base = own && typeof own === 'object' ? own : {};
  const submenu = base.submenu || layout(STATIC_SUBMENUS[id], acts);
  return submenu.length ? row(id, { ...base, submenu }, over) : null;
}

// Cover colours (Color and cover ›): the tint swatches as radio rows with a
// translated name each, then Custom…, Upload custom thumbnail…, Reset to auto
// thumbnail (only when its act is there).
// act = { tints: [{ key, swatch }], current, setTint(key), custom?, upload?, reset? } or { submenu }.
export function tintName(key) {
  switch (key) {
    case 'neutral': return t({ message: 'Neutral', context: 'cover color' });
    case 'warm': return t({ message: 'Warm', context: 'cover color' });
    case 'cool': return t({ message: 'Cool', context: 'cover color' });
    case 'sun': return t({ message: 'Sun', context: 'cover color' });
    case 'dusk': return t({ message: 'Dusk', context: 'cover color' });
    case 'sand': return t({ message: 'Sand', context: 'cover color' });
    case 'sea': return t({ message: 'Sea', context: 'cover color' });
    default: return String(key).charAt(0).toUpperCase() + String(key).slice(1);
  }
}

function colorCoverRow(act, over) {
  const a = asAct(act);
  if (!a) return null;
  if (a.submenu) return row('color-cover', a, over);
  const tints = (a.tints || []).map((tn) => ({
    id: `cover-${tn.key}`,
    label: tintName(tn.key),
    swatch: tn.swatch,
    checked: (a.current || 'neutral') === tn.key,
    radio: true,
    run: () => a.setTint?.(tn.key),
  }));
  const submenu = layout([
    tints,
    [row('cover-custom', a.custom), row('upload-thumb', a.upload), row('reset-thumb', a.reset)],
  ]);
  return submenu.length ? row('color-cover', { ...a, submenu }, over) : null;
}

// Background › on the canvas menu: swatches as radio rows, divider, Custom….
// act = { options: [{ key, swatch }], current, pick(key), custom? } or { submenu }.
export function backgroundName(key) {
  switch (key) {
    case 'default': return t({ message: 'Default', context: 'background' });
    case 'paper': return t({ message: 'Paper', context: 'background' });
    case 'midnight': return t({ message: 'Midnight', context: 'background' });
    case 'mauve': return t({ message: 'Mauve', context: 'background' });
    case 'cream': return t({ message: 'Cream', context: 'background' });
    case 'sage': return t({ message: 'Sage', context: 'background' });
    case 'charcoal': return t({ message: 'Charcoal', context: 'background' });
    default: return String(key).charAt(0).toUpperCase() + String(key).slice(1);
  }
}

function backgroundRow(act, over) {
  const a = asAct(act);
  if (!a) return null;
  if (a.submenu) return row('background', a, over);
  const opts = (a.options || []).map((o) => ({
    id: `bg-${o.key}`,
    label: backgroundName(o.key),
    swatch: o.swatch,
    checked: (a.current ?? 'default') === o.key,
    radio: true,
    run: () => a.pick?.(o.key),
  }));
  const custom = a.custom ? { id: 'bg-custom', label: t`Custom…`, run: a.custom } : null;
  const submenu = layout([opts, [custom]]);
  return submenu.length ? row('background', { ...a, submenu }, over) : null;
}

// Radio rows for a choice list (Spacing, Reading order, View, Shape): options
// [{ id, label, icon? }], the current id, pick(id).
export function radioRows(options, current, pick) {
  return (options || []).map((o) => ({
    id: o.id,
    label: o.label,
    ...(o.icon ? { icon: o.icon } : {}),
    checked: current === o.id,
    radio: true,
    run: () => pick?.(o.id),
  }));
}

// One entry of a group: a row id (resolved against the acts), or a ready item.
export function resolve(id, acts, over) {
  if (id && typeof id === 'object') return id;
  if (STATIC_SUBMENUS[id]) return parentRow(id, acts, over);
  if (id === 'color-cover') return colorCoverRow(acts?.[id], over);
  if (id === 'background') return backgroundRow(acts?.[id], over);
  if (id === 'backlinks') return acts?.backlinks ? { backlinks: true } : null;
  return row(id, acts?.[id], over);
}

// The present rows of a list of ids (or ready items).
export function group(ids, acts) {
  return (ids || []).map((id) => resolve(id, acts)).filter(Boolean);
}

// Groups of rows -> one flat list: dividers only between non-empty groups,
// never doubled or at the ends (tidyMenu). A group is an array of ids / items.
export function layout(groups, acts) {
  const out = [];
  for (const g of groups || []) {
    const items = group(g, acts);
    if (!items.length) continue;
    if (out.length) out.push({ divider: true });
    out.push(...items);
  }
  return tidyMenu(out);
}

// The quick row's buttons: the present rows of Cut · Copy · Duplicate · Delete.
export function quickRow(ids, acts) {
  return group(ids, acts).filter((it) => it.run);
}

// Only the ids in `allow`: the viewer's allow-list, so an editing act passed by
// mistake never shows. Ready items pass through.
export function allowOnly(ids, allow) {
  const ok = new Set(allow);
  return (ids || []).filter((id) => typeof id !== 'string' || ok.has(id));
}
