// Pure grouping of LINKED grids for the cluster browser. Grids that share a
// `templateId` are one "family" (same layout, global-synced). With tens of them
// a list drowns, so we collapse a family (≥ minGroup members) into ONE group
// node — placed where its first member falls in the current sort order — and
// fold the rest away until expanded. Singletons and non-grids pass through
// unchanged. No React / no Yjs → unit-testable like listItem.js.
import { spatialOrder } from './gridSequence.js';

// Order a family's members by spatial position (reading order), so an expanded
// family reads 1..N the way the grids sit on the canvas. Falls back to input
// order if anything is off (e.g. missing coords).
function orderMembers(members) {
  try {
    const rects = members.map(m => ({ id: m.id, x: m.card?.x || 0, y: m.card?.y || 0, w: m.card?.w || 0, h: m.card?.h || 0 }));
    const order = spatialOrder(rects, 'z');
    const byId = new Map(members.map(m => [m.id, m]));
    const seq = order.map(id => byId.get(id)).filter(Boolean);
    return seq.length === members.length ? seq : members;
  } catch (_) { return members; }
}

// items: the already-sorted ListItems. Returns a NEW display list where each
// qualifying family is a group node:
//   { isGroup:true, id:'grp:<tid>', templateId, name, count, members[], preview }
// members[] are the ordered ListItems (rendered only when the group is expanded).
export function groupGridFamilies(items, { gridTemplates = {}, minGroup = 2 } = {}) {
  const list = items || [];

  // Bucket grid items by templateId (linked grids only).
  const byTemplate = new Map();
  for (const it of list) {
    const tid = it && it.kind === 'grid' && it.card && it.card.templateId;
    if (!tid) continue;
    if (!byTemplate.has(tid)) byTemplate.set(tid, []);
    byTemplate.get(tid).push(it);
  }

  // Only families with ≥ minGroup members collapse; a lone linked grid stays a
  // normal row (a "group of 1" would just add noise).
  const grouped = new Set();
  for (const [tid, members] of byTemplate) if (members.length >= minGroup) grouped.add(tid);
  if (!grouped.size) return list.slice();

  const emitted = new Set();
  const out = [];
  for (const it of list) {
    const tid = it && it.kind === 'grid' && it.card && it.card.templateId;
    if (tid && grouped.has(tid)) {
      if (emitted.has(tid)) continue;          // fold remaining members into the group
      emitted.add(tid);
      const members = orderMembers(byTemplate.get(tid));
      out.push({
        isGroup: true,
        id: `grp:${tid}`,
        templateId: tid,
        name: (gridTemplates[tid] && gridTemplates[tid].name) || 'Grid family',
        count: members.length,
        members,
        preview: members[0]?.preview || { mode: 'icon', kind: 'grid' },
      });
    } else {
      out.push(it);
    }
  }
  return out;
}
