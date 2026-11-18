// The card right-click menus, as pure builders: which rows, in what order, with
// which words. The surface (CanvasSurface) supplies the acts and decides what is
// possible; a row shows only when its act is present.
//
//   cardMenu(card, ctx, acts)  one card.   ctx: { canEdit, title? }
//   multiMenu(count, ctx, acts) several.   ctx: { canEdit }
//   groupMenu(ctx, acts)       a group (its label, or Group "Name" › on a card). ctx: { canEdit, name? }
//   arrowMenu(ctx, acts)       an arrow (editors only).  ctx: { canEdit }
//   commentPinMenu(ctx, acts)  a comment pin.
//
// Each returns { label, title?, quick?, items }.

import { t, plural } from '@lingui/core/macro';
import { row, group, layout, quickRow, resolve, allowOnly } from './rows.js';

const QUICK = ['cut', 'copy', 'duplicate', 'delete'];
const SHARE = ['send', 'copy-link', 'share-file', 'share-doc', 'download'];
const ORGANIZE = ['comment', 'note-comments', 'vote', 'move|keep-in-files', 'copy-to', 'add-to-group|group-menu', 'arrange'];
const INFO = ['info', 'backlinks'];

// Per kind: the open group (`edit` is the Edit › submenu, built from `edit`),
// and, where it differs from the default, the share / organize / info groups.
export const KIND_LAYOUT = {
  image: { open: ['view-full', 'edit-photo', 'edit'], edit: ['rename', 'caption', 'hyperlink', 'replace-image', 'upload-version'] },
  video: { open: ['open-player', 'edit'], edit: ['rename', 'upload-version', 'autoplay', 'loop', 'start-here', 'start-at', 'clear-start'] },
  audio: { open: ['edit'], edit: ['rename', 'upload-version', 'cover', 'remove-cover', 'loop'] },
  pdf: { open: ['open', 'edit'], edit: ['rename', 'upload-version'] },
  file: { open: ['open', 'edit'], edit: ['rename', 'upload-version'] },
  link: { open: ['open-link', 'rename'] },
  note: { open: ['fit-content'] },
  doc: { open: ['open-doc'] },
  art: { open: ['open-sketch'] },
  shape: { open: ['shape', 'stroke'] },
  grid: { open: ['spacing', 'reading-order', 'templates', 'generate-matrix'] },
  schedule: { open: ['schedule-view', 'go-today', 'rename'] },
  palette: { open: ['eyedrop', 'pick-from-image', 'labels'] },
  board: {
    open: ['open-cluster', 'color-cover', 'copy-to-workspace'],
    share: ['send', 'share-cluster', 'copy-link'],
    organize: ['rename', 'comment', 'move|keep-in-files', 'add-to-group|group-menu', 'arrange'],
    info: ['star', 'info'],
  },
  boardlink: { open: ['open-linked'] },
  shortcut: { open: ['open'] },
};

// What a viewer (ctx.canEdit false) may see: an allow-list, so an editing act
// passed by mistake never shows.
const VIEWER_OPEN = ['view-full', 'open-player', 'open', 'open-link', 'open-doc', 'open-sketch', 'open-cluster', 'open-linked'];
const VIEWER_SHARE = ['send', 'copy-link', 'download'];
const VIEWER_ORGANIZE = ['comment', 'note-comments', 'copy-to'];
const VIEWER_INFO = ['info', 'backlinks'];
const VIEWER_MULTI = ['send', 'copy-to', 'info'];

export function kindName(kind) {
  switch (kind) {
    case 'image': return t`Image`;
    case 'video': return t`Video`;
    case 'audio': return t`Audio`;
    case 'pdf': return t`PDF`;
    case 'file': return t`File`;
    case 'link': return t`Link`;
    case 'note': return t`Note`;
    case 'doc': return t`Doc`;
    case 'art': return t`Sketch`;
    case 'shape': return t({ message: 'Shape', context: 'add card' });
    case 'grid': return t`Grid`;
    case 'schedule': return t`Schedule`;
    case 'palette': return t`Color palette`;
    case 'board': return t`Cluster`;
    case 'boardlink': return t`Linked cluster`;
    default: return t`Card`;
  }
}

// An id like 'a|b' is either: the first present row (Add to group, or the
// card's own Group "Name" › when it is in one).
function pick(id, acts) {
  if (typeof id !== 'string' || !id.includes('|')) return resolve(id, acts);
  for (const one of id.split('|')) {
    const hit = resolve(one, acts);
    if (hit) return hit;
  }
  return null;
}

// Group "Name" › inside a card's menu: the same rows the group label shows.
// acts['group-menu'] = { name, acts: <groupMenu's acts>, ... }.
function groupMenuRow(acts) {
  const a = acts?.['group-menu'];
  if (!a || typeof a !== 'object') return null;
  const submenu = a.submenu || groupMenu({ canEdit: true, member: true }, a.acts || {}).items;
  return submenu.length ? row('group-menu', { ...a, submenu }) : null;
}

// Edit ›: the kind's edit rows folded into one submenu; a single row is shown
// directly instead of a submenu of one.
function editRow(ids, acts) {
  const items = group(ids, acts);
  if (!items.length) return null;
  if (items.length === 1) return items[0];
  const own = acts?.edit && typeof acts.edit === 'object' ? acts.edit : {};
  return row('edit', { ...own, submenu: items });
}

function openGroup(kind, acts) {
  const spec = KIND_LAYOUT[kind] || { open: [] };
  return (spec.open || []).map((id) => (id === 'edit' ? editRow(spec.edit, acts) : resolve(id, acts))).filter(Boolean);
}

function entries(ids, acts) {
  return ids.map((id) => (id === 'group-menu' ? groupMenuRow(acts) : pick(id, acts))).filter(Boolean);
}

function organizeEntries(ids, acts) {
  return ids.map((id) => {
    if (id === 'add-to-group|group-menu') return groupMenuRow(acts) || resolve('add-to-group', acts);
    return pick(id, acts);
  }).filter(Boolean);
}

export function cardMenu(card, ctx, acts) {
  const kind = card?.kind;
  const label = ctx?.title || kindName(kind);
  const spec = KIND_LAYOUT[kind] || { open: [] };
  if (ctx?.canEdit === false) {
    const open = openGroup(kind, acts).filter((it) => VIEWER_OPEN.includes(it.id));
    return {
      label,
      items: layout([
        open,
        entries(allowOnly(spec.share || SHARE, VIEWER_SHARE), acts),
        entries(allowOnly(ORGANIZE, VIEWER_ORGANIZE), acts),
        entries(allowOnly(spec.info || INFO, VIEWER_INFO), acts),
      ]),
    };
  }
  const quick = quickRow(QUICK, acts);
  return {
    label,
    ...(quick.length ? { quick } : {}),
    items: layout([
      openGroup(kind, acts),
      entries(spec.share || SHARE, acts),
      organizeEntries(spec.organize || ORGANIZE, acts),
      entries(spec.info || INFO, acts),
    ]),
  };
}

export function multiMenu(count, ctx, acts) {
  const title = plural(count, { one: '# card', other: '# cards' });
  if (ctx?.canEdit === false) {
    return { label: title, title, items: layout([allowOnly(['send', 'copy-to'], VIEWER_MULTI), allowOnly(['info'], VIEWER_MULTI)], acts) };
  }
  const quick = quickRow(QUICK, acts);
  return {
    label: title,
    title,
    ...(quick.length ? { quick } : {}),
    items: layout([
      ['send', 'download'],
      [...[pick('move|keep-in-files', acts)].filter(Boolean), 'copy-to', 'group-these', 'add-to-group', 'remove-from-group', 'new-cluster-from'],
      ['align', 'arrange', 'tidy'],
      ['info'],
    ], acts),
  };
}

export function groupMenu(ctx, acts) {
  const name = ctx?.name;
  const label = name ? t`Group "${name}"` : t({ message: 'Group', context: 'noun' });
  if (ctx?.canEdit === false) {
    return { label, items: layout([['group-comment', 'group-info']], acts) };
  }
  return {
    label,
    items: layout([
      ['rename-group', 'group-comment'],
      ['outline', 'group-label', 'outline-shape', 'outline-color'],
      ['turn-into-cluster', 'group-info'],
      ['remove-from-group', 'ungroup'],
    ], acts),
  };
}

// Editors only: a viewer gets no arrow menu at all.
export function arrowMenu(ctx, acts) {
  const label = t`Arrow`;
  if (ctx?.canEdit === false) return { label, items: [] };
  return {
    label,
    items: layout([
      ['arrow-label'],
      ['curved', 'two-way', 'dashed', 'reset-curve'],
      ['delete-arrow'],
    ], acts),
  };
}

// A comment pin. Rows only for actions the comments code already has; the
// surface leaves an act out when it does not apply (not the author, no link
// helper, ...).
export function commentPinMenu(ctx, acts) {
  return {
    label: t`Comment`,
    items: layout([
      ['open-comment', 'resolve', 'reopen', 'copy-comment-link'],
      ['delete-comment'],
    ], acts),
  };
}
