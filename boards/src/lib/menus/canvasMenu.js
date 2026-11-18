// The canvas (background) right-click menu and its Add › submenu, as pure
// builders. A row shows only when the surface supplies its act.
//
//   canvasMenu(ctx, acts)  ctx: { canEdit, label? }  -> { label, quick?, items }
//   addMenu(acts)                                    -> { label, items }
//
// The quick row (editors) is the five most common adds; the same acts feed the
// Add › submenu, so a surface passes one 'add-*' act per thing it can add.
// A quick button's label is the act's `quickLabel` (its tooltip words, "Add a note"),
// and its `short` the plain name ("Note") a phone's tile shows under the icon.

import { t } from '@lingui/core/macro';
import { row, layout } from './rows.js';

const QUICK_ADD = ['add-note', 'add-image', 'add-cluster', 'add-doc', 'add-link'];

const ADD_GROUPS = [
  ['add-note', 'add-image', 'add-cluster', 'add-linked-cluster', 'add-doc', 'add-file', 'add-folder'],
  ['add-grid', 'add-schedule', 'add-shape', 'add-palette', 'add-draw', 'add-arrow'],
  ['add-link', 'add-comment', 'add-vote'],
];

export function addMenu(acts) {
  return { label: t({ message: 'Add', context: 'menu' }), items: layout(ADD_GROUPS, acts) };
}

export function canvasMenu(ctx, acts) {
  const label = ctx?.label || t`Canvas menu`;
  if (ctx?.canEdit === false) {
    return {
      label,
      items: layout([['comment'], ['select-all', 'select-touch'], ['copy-link', 'cluster-info']], acts),
    };
  }
  // A quick button names the act the way its tooltip does ("Add a note"): the
  // act's `quickLabel`, while the Add › submenu keeps the plain "Note". The
  // plain name rides along as `short`, the words under a phone's tile.
  const quick = QUICK_ADD
    .map((id) => {
      const it = row(id, acts?.[id]);
      const ql = acts?.[id]?.quickLabel;
      return it && ql ? { ...it, label: ql, short: it.label } : it;
    })
    .filter((it) => it && it.run);
  const sub = addMenu(acts).items;
  const add = sub.length ? row('add', { ...(acts?.add && typeof acts.add === 'object' ? acts.add : {}), submenu: sub }) : null;
  return {
    label,
    ...(quick.length ? { quick } : {}),
    items: layout([
      ['delete-drawn'],
      [add, 'paste', 'select-all', 'select-touch'],
      ['tidy', 'fit'],
      ['background', 'export'],
      ['share-cluster', 'copy-link', 'cluster-info'],
      ['clear-drawings'],
    ], acts),
  };
}
