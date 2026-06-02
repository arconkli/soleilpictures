// Deterministic string→[0,1) hash + a bounded "orbital distance" multiplier.
// Used to scatter graph dots onto varied orbits instead of one even shell
// (see HomeGraph + universeSimWorker). Worker-safe: no DOM, no deps.

// FNV-1a over char codes, folded to [0,1).
export function hash01(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296; // unsigned → [0,1)
}

// Multiplier in [1-spread, 1+spread) keyed deterministically on an id.
// spread 0.35 → orbits range 0.65×–1.35× the base distance.
export function orbitJitter(id, spread = 0.35) {
  return 1 + (hash01(id) * 2 - 1) * spread;
}

// d3-force resolves string ids → node objects on first tick, so a link's
// target may be a string OR a { id } node. Normalize to the id.
export function targetId(l) {
  const t = l && l.target;
  return typeof t === 'object' && t !== null ? t.id : t;
}
