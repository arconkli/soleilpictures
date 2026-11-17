// The Files menus, as pure builders: one file, several files, and the empty
// floor of the Files page. A row shows only when the surface supplies its act.
//
//   fileMenu(file, ctx, acts)   ctx: { touch?, selecting?, f2?, delKey? }
//   filesMenu(count, ctx, acts) ctx: { mixed? } (clusters among the files: "# items")
//   floorMenu(acts)             new-cluster, upload, paste, select-all
//
// Each returns { label, title?, items }. No counts in labels: the count is the title.

import { t, plural } from '@lingui/core/macro';
import { row, layout, group } from './rows.js';
import { del } from './shortcuts.js';

const withKey = (act, shortcut) => (act ? { ...(typeof act === 'function' ? { run: act } : act), shortcut } : act);

export function fileMenu(file, ctx, acts) {
  const a = { ...acts };
  // F2 and Delete show only where the surface binds them.
  if (a.rename) a.rename = withKey(a.rename, ctx?.f2 ? 'F2' : null);
  if (a.delete) a.delete = withKey(a.delete, ctx?.delKey ? del() : null);
  const name = file?.name || t`File`;
  return {
    label: name,
    title: name,
    items: layout([
      [
        ctx?.touch && !ctx?.selecting ? 'select' : null,
        'quick-look', 'open-player', 'show-in-files', 'show-on-canvas', 'put-on-canvas',
      ].filter(Boolean),
      ['send', 'copy-link', 'share-file', 'share-doc', 'download'],
      ['rename', 'upload-version', 'move-file', 'copy-file', 'star'],
      ['info', 'backlinks', 'delete'],
    ], a),
  };
}

export function filesMenu(count, ctx, acts) {
  const title = ctx?.mixed
    ? plural(count, { one: '# item', other: '# items' })
    : plural(count, { one: '# file', other: '# files' });
  return {
    label: title,
    title,
    items: layout([
      ['put-on-canvas', 'send', 'download'],
      ['move-file', 'copy-file'],
      ['info', 'delete'],
    ], acts),
  };
}

export function floorMenu(acts) {
  const paste = acts?.paste ? row('paste', acts.paste, { label: t`Paste` }) : null;
  const newCluster = acts?.['new-cluster'] ? row('new-cluster', acts['new-cluster'], { label: t`New cluster` }) : null;
  return {
    label: t`Files`,
    items: layout([
      [newCluster, ...group(['upload'], acts)].filter(Boolean),
      [paste, ...group(['select-all'], acts)].filter(Boolean),
    ]),
  };
}
