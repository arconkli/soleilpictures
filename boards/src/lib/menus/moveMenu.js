// The Move to cluster › and Copy to cluster › submenus' rows, as a pure builder.
//
//   moveToClusterRows({ recent, all, acts, currentId? }) -> items
//
//   recent: clusters the person went to lately (up to 4 show; the current cluster
//           and anything not in `all` is skipped)
//   all:    every valid target, in today's order. A target is
//           { id, name, tint?, path?, parents? }: `path` is the parent path as
//           text, or `parents` the parent names, joined here with " / "
//           (nothing for a top-level cluster)
//   acts:   { pick(target), newCluster?, keepInFiles?, topLevel? }
//           newCluster -> "New cluster…"; topLevel -> "Top level" (cluster cards
//           being nested); keepInFiles -> "Keep in Files only" (Move only: a
//           Copy leaves it out)
//
// The caller puts the result in the row's `submenu` (the catalogue gives the row
// its search field).

import { t } from '@lingui/core/macro';
import { row, layout } from './rows.js';

const RECENT_MAX = 4;

function targetRow(target, pick, prefix = 'to') {
  const path = target.path || (Array.isArray(target.parents) && target.parents.length ? target.parents.join(' / ') : '');
  return {
    id: `${prefix}-${target.id}`,
    label: target.name,
    ...(path ? { aside: path } : {}),
    ...(target.tint ? { swatch: target.tint } : { icon: 'Folder' }),
    run: () => pick?.(target),
  };
}

export function moveToClusterRows({ recent = [], all = [], acts = {}, currentId } = {}) {
  const valid = new Set(all.map((c) => c.id));
  const recents = recent
    .filter((c) => c && c.id !== currentId && valid.has(c.id))
    .slice(0, RECENT_MAX);
  const flat = [
    row('top-level', acts.topLevel),
    row('new-cluster', acts.newCluster),
    ...(recents.length ? [{ caption: t`Recent` }, ...recents.map((c) => targetRow(c, acts.pick, 'recent'))] : []),
    ...(all.length ? [{ caption: t`All clusters` }, ...all.map((c) => targetRow(c, acts.pick))] : []),
  ];
  const keep = row('keep-in-files', acts.keepInFiles);
  return layout([flat, keep ? [keep] : []]);
}
