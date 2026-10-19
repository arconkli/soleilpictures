// The line under the workspace's name in the files sidebar (preview only): who
// is here right now, or whose workspace it is. It says nothing in a workspace
// that's only yours with nobody else in it — "Yours" was that line, and it
// told you nothing (owner, 2026-10-19: "remove the 'yours'").
//
// Pure, so App's sidebar top and the QA harness say the same thing.

// The first word of a name, or what comes before the @ of an address.
export function firstName(label) {
  const s = String(label || '').trim();
  if (!s) return '';
  if (s.includes('@') && !/\s/.test(s)) return s.split('@')[0];
  return s.split(/\s+/)[0];
}

// "Maya is here", "Maya and Jon are here", "Maya, Jon and Sam are here",
// "Maya, Jon and 3 others are here".
export function hereText(names) {
  const n = (names || []).filter(Boolean);
  if (n.length === 0) return '';
  if (n.length === 1) return `${n[0]} is here`;
  if (n.length === 2) return `${n[0]} and ${n[1]} are here`;
  if (n.length === 3) return `${n[0]}, ${n[1]} and ${n[2]} are here`;
  const rest = n.length - 2;
  return `${n[0]}, ${n[1]} and ${rest} others are here`;
}

// others: the people in this workspace now, not you — [{ id, name }], name
//   being whatever label the app has for them (a name or an address).
// mine: you made this workspace (or it's your personal one).
// sharedBy: who shared it with you, when it isn't yours; coowner: you co-own it.
// → { kind: 'here', text, faces: [{ id, initial }] } (at most 3 faces),
//   { kind: 'shared', text }, or null when there's nothing worth a line.
export function whoLine({ others = [], mine = true, sharedBy = '', coowner = false } = {}) {
  const seen = new Set();
  const here = [];
  for (const p of others || []) {
    if (!p?.id || seen.has(p.id)) continue;
    seen.add(p.id);
    here.push(p);
  }
  if (here.length) {
    const names = here.map((p) => firstName(p.name) || 'Someone');
    return {
      kind: 'here',
      text: hereText(names),
      faces: here.slice(0, 3).map((p, i) => ({ id: p.id, initial: (names[i] || '?').charAt(0).toUpperCase() })),
    };
  }
  if (mine) return null;
  const by = String(sharedBy || '').trim() || 'someone';
  return { kind: 'shared', text: coowner ? `Co-owner · shared by ${by}` : `Shared by ${by}` };
}
