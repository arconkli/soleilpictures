// What the database server's memory figures mean (pure; worker-dbmemory.js
// does the I/O). On 17 Nov 2026 the server ran short of memory for hours,
// swapped, then locked up. The figures come from Supabase's metrics endpoint
// as Prometheus text; this reads them and decides whether to page.

const WANTED = {
  node_memory_MemTotal_bytes: 'mem_total',
  node_memory_MemAvailable_bytes: 'mem_available',
  node_memory_SwapTotal_bytes: 'swap_total',
  node_memory_SwapFree_bytes: 'swap_free',
  node_vmstat_pswpin: 'pswpin',
  node_vmstat_pswpout: 'pswpout',
  node_vmstat_pgmajfault: 'pgmajfault',
};

// Pages swapped in per second, and major page faults per second, above which
// the server is thrashing.
export const THRASH_SWAPIN_PER_S = 300;
export const THRASH_MAJFLT_PER_S = 1000;
// Short: under 8% of memory available and, when the server has swap, over 60% of it in use.
export const SHORT_AVAIL_RATIO = 0.08;
export const SHORT_SWAP_USED_RATIO = 0.6;
// Counters turn into rates only between readings this far apart (seconds).
export const RATE_MIN_AGE_S = 60;
export const RATE_MAX_AGE_S = 1200;

// The first sample of each wanted metric; null when memory itself is missing.
export function parseReading(text) {
  try {
    const out = {};
    for (const key of Object.values(WANTED)) out[key] = null;
    for (const raw of String(text ?? '').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const m = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{[^}]*\})?\s+(\S+)/);
      if (!m) continue;
      const key = WANTED[m[1]];
      if (!key || out[key] !== null) continue;
      const v = Number(m[2]);
      if (Number.isFinite(v)) out[key] = Math.round(v);
    }
    if (out.mem_total == null || out.mem_available == null) return null;
    return out;
  } catch (_) {
    return null;
  }
}

export function isShort(r) {
  if (!r) return false;
  const { mem_total: mt, mem_available: ma, swap_total: st, swap_free: sf } = r;
  if (!(mt > 0) || ma == null || !(ma / mt < SHORT_AVAIL_RATIO)) return false;
  // No swap (or no swap figure): available memory alone decides.
  if (!(st > 0) || sf == null) return true;
  return (st - sf) / st > SHORT_SWAP_USED_RATIO;
}

// prev is what the database returned for the previous reading (same fields
// plus age_s). Null when there are no rates to speak of.
export function rates(prev, cur) {
  if (!prev || !cur) return null;
  const age = prev.age_s;
  if (typeof age !== 'number' || !(age >= RATE_MIN_AGE_S && age <= RATE_MAX_AGE_S)) return null;
  const rate = (a, b) => (typeof a === 'number' && typeof b === 'number' && b >= a ? (b - a) / age : null);
  const swapInPerSec = rate(prev.pswpin, cur.pswpin);
  const majfltPerSec = rate(prev.pgmajfault, cur.pgmajfault);
  // A counter that went backwards means the server restarted.
  if (swapInPerSec == null || majfltPerSec == null) return null;
  return { swapInPerSec, majfltPerSec };
}

export function judge(prev, cur, { recorded = true } = {}) {
  const r = rates(prev, cur);
  const availPct = cur?.mem_total > 0 && cur.mem_available != null ? (cur.mem_available / cur.mem_total) * 100 : null;
  const swapUsedPct = cur?.swap_total > 0 && cur.swap_free != null ? ((cur.swap_total - cur.swap_free) / cur.swap_total) * 100 : null;
  let verdict = 'ok';
  if (r && (r.swapInPerSec > THRASH_SWAPIN_PER_S || r.majfltPerSec > THRASH_MAJFLT_PER_S)) verdict = 'thrash';
  // Two short readings in a row, or one that could not even be stored: the
  // database not answering while memory is short is the failure itself. The
  // alert is raised in the same database, so while it isn't answering at all
  // it most likely can't land; this watch is for the hours of running short
  // before a lockup (on 17 Nov 2026 the server swapped for hours first).
  else if (isShort(cur) && (isShort(prev) || !recorded)) verdict = 'short';
  return {
    verdict, availPct, swapUsedPct,
    swapInPerSec: r ? r.swapInPerSec : null,
    majfltPerSec: r ? r.majfltPerSec : null,
  };
}

const MB = 1024 * 1024;
const fix = (n) => (Math.round(n * 10) / 10).toString();

export function alertText(j, cur) {
  const title = j.verdict === 'thrash' ? 'Database is swapping hard' : 'Database memory is running out';
  const lines = [];
  if (j.availPct != null) {
    lines.push(`Free memory: ${fix(j.availPct)}% (${Math.round(cur.mem_available / MB)} MB of ${Math.round(cur.mem_total / MB)} MB).`);
  }
  if (j.swapUsedPct != null) lines.push(`Swap used: ${fix(j.swapUsedPct)}%.`);
  if (j.swapInPerSec != null) lines.push(`Swap-in: ${Math.round(j.swapInPerSec)} pages/s. Major faults: ${Math.round(j.majfltPerSec)}/s.`);
  lines.push('The 17 Nov 2026 restart came after hours like this. Check Supabase > Reports > Memory, or move the database up a compute size.');
  return { title, body: lines.join('\n') };
}
