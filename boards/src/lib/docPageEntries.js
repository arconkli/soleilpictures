// A doc's page list when one page has more than one entry, or has lost its place.
//
// Each page is one plain entry in docPages ({ id, name, parent_id, order }),
// and an edit replaces the entry, so two edits to one page at the same moment
// leave an entry each. Builds from before 2026-10-21 showed both, and a move
// that renumbered every sibling copied whole branches that way. A page now
// shows once, each field from the entry that wrote it last: the name from the
// highest `nameV`, where it sits (parent_id and order together) from the
// highest `posV`. Equal stamps go to the later entry, which every device
// agrees on. docState.js writes the stamps and clears leftover entries;
// docText.js reads the list for search, so this imports nothing.

export const pageStamp = (v) => (Number.isFinite(v) ? v : 0);

// Where a page sits among its siblings, and the one way to sort them: the page
// list, a move and a drop all count positions from this.
export const pageOrder = (p) => (Number.isFinite(p?.order) ? p.order : 0);
export const byPageOrder = (a, b) => pageOrder(a) - pageOrder(b);

// The page list as people see it: one entry per page, in the order each page
// first appears. A page with a single entry is returned as it is.
export function mergePageEntries(entries) {
  const groups = new Map();
  for (const e of entries || []) {
    if (!e || typeof e !== 'object' || !e.id) continue;
    const g = groups.get(e.id);
    if (!g) { groups.set(e.id, { name: e, pos: e, last: e, count: 1 }); continue; }
    g.count += 1;
    if (pageStamp(e.nameV) >= pageStamp(g.name.nameV)) g.name = e;
    if (pageStamp(e.posV) >= pageStamp(g.pos.posV)) g.pos = e;
    g.last = e;
  }
  const out = [];
  for (const g of groups.values()) {
    if (g.count === 1) { out.push(g.last); continue; }
    out.push({
      ...g.last,
      name: g.name.name, nameV: pageStamp(g.name.nameV),
      parent_id: g.pos.parent_id ?? null, order: g.pos.order, posV: pageStamp(g.pos.posV),
    });
  }
  return out;
}

// Whether one entry already says everything the merged page does, so the
// page's other entries can go without losing an edit.
export function holdsWholePage(entry, page) {
  return !!entry && !!page
    && entry.name === page.name
    && (entry.parent_id ?? null) === (page.parent_id ?? null)
    && entry.order === page.order
    && pageStamp(entry.nameV) === pageStamp(page.nameV)
    && pageStamp(entry.posV) === pageStamp(page.posV);
}

// Pages whose place is gone, which the list used to drop without a word.
// Deleting a page takes the text of every page it knew was inside it, so a page
// someone moved or added into it at the same moment still has its text: it
// shows at the top. One that delete left behind (an older tab's move had
// rewritten it inside) has none, and stays out. Two pages moved into each other
// at the same moment both show at the top. Nothing is written; the next edit to
// such a page writes where it now shows. `hasText(id)` says whether the page's
// text is still there.
export function placeStrays(pages, hasText) {
  const byId = new Map();
  for (const p of pages) byId.set(p.id, p);
  const fate = new Map();   // id → 'kept' | 'top' | 'gone'
  for (const start of pages) {
    if (fate.has(start.id)) continue;
    // Walk up from `start` until the top, a page already placed, a parent that
    // is gone, or a page this walk has passed (a loop).
    const path = [];
    const onPath = new Map();
    let p = start;
    let lost = false;       // whether the walk's last page hangs from nothing that shows
    for (;;) {
      onPath.set(p.id, path.length);
      path.push(p);
      const pid = p.parent_id;
      if (pid == null || pid === '') break;
      if (fate.has(pid)) { lost = fate.get(pid) === 'gone'; break; }
      const parent = byId.get(pid);
      if (!parent) { lost = true; break; }
      if (onPath.has(pid)) {
        const from = onPath.get(pid);
        for (let i = from; i < path.length; i++) fate.set(path[i].id, 'top');
        path.length = from;
        break;
      }
      p = parent;
    }
    for (let i = path.length - 1; i >= 0; i--) {
      const q = path[i];
      const under = i === path.length - 1 ? lost : fate.get(path[i + 1].id) === 'gone';
      fate.set(q.id, !under ? 'kept' : hasText(q.id) ? 'top' : 'gone');
    }
  }
  const out = [];
  for (const p of pages) {
    const f = fate.get(p.id);
    if (f === 'gone') continue;
    out.push(f === 'top' && p.parent_id != null ? { ...p, parent_id: null } : p);
  }
  return out;
}
