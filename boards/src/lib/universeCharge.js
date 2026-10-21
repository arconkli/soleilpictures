// Many-body repulsion for the Universe's anchors, on a uniform grid.
//
// d3-force-3d's forceManyBody rebuilds an octree every tick and walks it with
// the Barnes-Hut approximation. The Universe always caps the force's reach
// (distanceMax) and spreads its anchors over a disk far wider than that reach,
// so the tree bought nothing and cost nearly all of every settle tick. With the reach as the cell size, every pair close enough to interact
// sits in the same cell or an adjacent one, so a 27-cell scan finds all of
// them, exactly.
//
// The per-pair law is d3's own: the OTHER node's strength × alpha / |d|², the
// squared distance floored the way d3's default distanceMin of 1 floors it, and
// nothing at or past distanceMax. Two nodes exactly on top of each other are
// pushed apart along x, deterministically, where d3 jiggles them at random.
// universeCharge.test.mjs holds it to d3 with the approximation turned off.
//
// Worker-safe: no DOM, no deps.

const PX = 73856093, PY = 19349663, PZ = 83492791;

export function forceGridCharge() {
  let nodes = [];
  let strengths = new Float64Array(0);
  let strength = () => -30;
  let dmax = Infinity, dmax2 = Infinity;
  // Scratch, grown when the node count outgrows it and reused every tick.
  let cx = new Int32Array(0), cy = new Int32Array(0), cz = new Int32Array(0);
  let keys = new Int32Array(0), order = new Int32Array(0);
  let starts = new Int32Array(1), fill = new Int32Array(0);

  function force(alpha) {
    const n = nodes.length;
    if (!n) return;
    const cell = dmax;
    let size = 1;
    while (size < n * 2) size <<= 1;
    const mask = size - 1;
    if (cx.length < n) {
      cx = new Int32Array(n); cy = new Int32Array(n); cz = new Int32Array(n);
      keys = new Int32Array(n); order = new Int32Array(n);
    }
    if (starts.length < size + 1) { starts = new Int32Array(size + 1); fill = new Int32Array(size); }
    else starts.fill(0, 0, size + 1);

    // Bucket every node by its cell (counting sort over the hashed cells).
    for (let i = 0; i < n; i++) {
      const d = nodes[i];
      const x = Math.floor(d.x / cell), y = Math.floor(d.y / cell), z = Math.floor(d.z / cell);
      cx[i] = x; cy[i] = y; cz[i] = z;
      const k = (Math.imul(x, PX) ^ Math.imul(y, PY) ^ Math.imul(z, PZ)) & mask;
      keys[i] = k;
      starts[k + 1]++;
    }
    for (let k = 0; k < size; k++) starts[k + 1] += starts[k];
    fill.set(starts.subarray(0, size));
    for (let i = 0; i < n; i++) order[fill[keys[i]]++] = i;

    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      const ax = a.x, ay = a.y, az = a.z;
      const x0 = cx[i], y0 = cy[i], z0 = cz[i];
      let vx = 0, vy = 0, vz = 0;
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          for (let oz = -1; oz <= 1; oz++) {
            const qx = x0 + ox, qy = y0 + oy, qz = z0 + oz;
            const k = (Math.imul(qx, PX) ^ Math.imul(qy, PY) ^ Math.imul(qz, PZ)) & mask;
            for (let p = starts[k], e = starts[k + 1]; p < e; p++) {
              const j = order[p];
              // A bucket can hold other cells that hash alike; only this
              // cell's nodes count, or a collision would count a pair twice.
              if (j === i || cx[j] !== qx || cy[j] !== qy || cz[j] !== qz) continue;
              const b = nodes[j];
              let dx = b.x - ax;
              const dy = b.y - ay, dz = b.z - az;
              let l = dx * dx + dy * dy + dz * dz;
              if (l >= dmax2) continue;
              if (l === 0) { dx = 1e-6 * (j - i); l = dx * dx; }
              if (l < 1) l = Math.sqrt(l);
              const w = strengths[j] * alpha / l;
              vx += dx * w; vy += dy * w; vz += dz * w;
            }
          }
        }
      }
      a.vx += vx; a.vy += vy; a.vz += vz;
    }
  }

  function initialize() {
    strengths = new Float64Array(nodes.length);
    for (let i = 0; i < nodes.length; i++) strengths[i] = +strength(nodes[i], i, nodes);
  }

  force.initialize = (_nodes) => { nodes = _nodes; initialize(); };
  force.strength = (s) => {
    strength = typeof s === 'function' ? s : () => +s;
    initialize();
    return force;
  };
  force.distanceMax = (d) => { dmax = +d; dmax2 = dmax * dmax; return force; };
  return force;
}
