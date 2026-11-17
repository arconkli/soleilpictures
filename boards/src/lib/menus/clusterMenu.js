// The one cluster right-click menu (sidebar tree, Files page, Shared page,
// Shared with you, Home), as a pure builder. A row shows only when the surface
// supplies its act.
//
//   clusterMenu(board, ctx, acts) -> { label, title, items }
//
//   board: { name }
//   ctx:   { edit, isLastTop?, canRemoveFromList?, isRoot?, f2? }
//          edit false is a viewer (allow-list below); isLastTop disables Delete
//          with a hint; canRemoveFromList swaps Delete for Remove from my list;
//          isRoot (a workspace's root cluster) never gets Delete or Move to…; f2 says the
//          surface binds F2 to Rename; touch (and not selecting) puts Select first,
//          for a surface that can pick several (the Files page).
//   acts:  select, open, send, share-cluster, copy-link, rename, new-inside, move-cluster,
//          color-cover ({ tints, current, setTint, custom, upload, reset? }),
//          star ({ run, starred }), info, copy-cluster, paste-into,
//          opens-in-files ({ run, checked }), delete, remove-from-list

import { t } from '@lingui/core/macro';
import { layout } from './rows.js';

const VIEWER = ['open', 'send', 'copy-link', 'star', 'info', 'remove-from-list'];

export function clusterMenu(board, ctx, acts) {
  const name = board?.name || t`Untitled cluster`;
  const a = { ...acts };
  if (ctx?.f2 && a.rename) a.rename = { ...(typeof a.rename === 'function' ? { run: a.rename } : a.rename), shortcut: 'F2' };
  const canRemove = !!ctx?.canRemoveFromList;
  if (!canRemove) delete a['remove-from-list'];
  if (ctx?.isRoot) delete a['move-cluster'];   // the root can't move
  if (canRemove || ctx?.isRoot) delete a.delete;
  else if (ctx?.isLastTop && a.delete) {
    a.delete = { ...(typeof a.delete === 'function' ? { run: a.delete } : a.delete), disabled: true, hint: t`Your last cluster can't be deleted` };
  }

  const first = ctx?.touch && !ctx?.selecting && a.select ? ['select'] : [];
  if (ctx?.edit === false) {
    const only = {};
    for (const id of VIEWER) if (a[id]) only[id] = a[id];
    if (first.length) only.select = a.select;
    return {
      label: name,
      title: name,
      items: layout([[...first, 'open', 'send', 'copy-link'], ['star', 'info'], ['remove-from-list']], only),
    };
  }
  return {
    label: name,
    title: name,
    items: layout([
      [...first, 'open', 'send', 'share-cluster', 'copy-link'],
      ['rename', 'new-inside', 'move-cluster', 'color-cover'],
      ['star', 'info', 'more'],
      ['delete', 'remove-from-list'],
    ], a),
  };
}

// The cover tints as the colour submenu takes them: [{ key, swatch }], from the
// COVER_TINTS map (components/primitives.jsx), which the caller passes in so
// this file stays free of the UI.
export const coverTints = (map) => Object.keys(map || {}).map((key) => ({ key, swatch: map[key] }));

// The acts of one cluster's menu, bound to the shared action set
// (hooks/useClusterActions.js). A surface spreads its own acts over the result
// (its own opener, its inline rename) and leaves out the rows it doesn't offer
// by deleting them. With no action set (a surface mounted without App:
// local/LocalBoardsApp.jsx) the result is empty and the surface's own handlers
// are all there is.
//   o.surface   what Send to… records as where it came from
//   o.via       open / share attribution ('shared_page', …)
//   o.tints     coverTints(COVER_TINTS): without it there is no Color and cover row
//   o.at        { x, y }: where the menu opened, for the custom colour picker
//   o.infoKey   true where the surface binds ⌘I (else Info shows no key)
//   o.star      false hides Star; o.opensInFiles false hides Always open in Files
export function clusterActsFrom(cc, board, o = {}) {
  const id = board?.id;
  if (!cc || !id) return {};
  const acts = {
    open: () => cc.open(id, o.via),
    'share-cluster': () => cc.share(id, o.via),
    'copy-link': () => cc.copyLink(id),
    'new-inside': () => cc.newInside(id),
    'move-cluster': () => cc.moveTo(id),
    info: o.infoKey ? () => cc.info(id) : { run: () => cc.info(id), shortcut: null },
    'copy-cluster': () => cc.copy(id),
    'paste-into': { run: () => cc.pasteInto(id), disabled: !cc.canPaste() },
    delete: () => cc.remove(id),
    'remove-from-list': () => cc.removeFromList(id),
  };
  if (o.star !== false) acts.star = { run: () => cc.toggleStar(id), starred: cc.isStarred(id) };
  if (o.opensInFiles !== false) {
    const on = cc.opensInFiles(id);
    acts['opens-in-files'] = { run: () => cc.setOpensInFiles(id, !on), checked: on };
  }
  if (cc.canSend?.()) acts.send = () => cc.send(id, o.surface);
  if (o.tints) {
    acts['color-cover'] = {
      tints: o.tints,
      current: board.cover || 'neutral',
      setTint: (key) => cc.setTint(id, key === 'neutral' ? null : key),
      custom: () => cc.pickColor(id, o.at || {}),
      upload: () => cc.pickThumb(id),
      reset: board.thumb_custom ? () => cc.resetThumb(id) : undefined,
    };
  }
  return acts;
}
