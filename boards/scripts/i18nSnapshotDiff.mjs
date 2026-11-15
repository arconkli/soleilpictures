// Compares the English snapshots tests/i18n-english.spec.js writes to
// .i18n-snapshot/<label>.json.
//
//   node scripts/i18nSnapshotDiff.mjs <baseline1.json> <baseline2.json> <after.json> [--merges]
//     A string whose count differs between the two baselines is unstable (a
//     clock-free timer, a random id, a race) and is ignored. Per screen, prints
//     the strings lost and gained between baseline 2 and after, and the screens
//     (or steps) missing from either. Exit 1 if anything changed, or if the
//     after run logged an "[i18n]" console error.
//
//     The one change the wrap is allowed to make to English is a thousands
//     separator in a count of 1,000 or more, so "1,234" and "1234" compare equal.
//
//     A wrap may also join text nodes that sat side by side into one: JSX draws
//     `{n} item` as two nodes ("1", "item") and <Trans> draws the sentence as one
//     ("1 item"). The page reads the same, so a gained string made of strings the
//     same screen lost (in order, joined by nothing or one space, two or more of
//     them) is a merge, not a change; one lost string now in pieces is a split.
//     Both are counted at the end and listed with --merges. Attributes never merge.
//
//   node scripts/i18nSnapshotDiff.mjs --pseudo <pseudo.json> <baseline.json> [--quiet]
//     Per screen, the English not yet wrapped: a text or attribute that still
//     has two ASCII letters in a row once everything inside a bracketed pair
//     is taken out. A wrapped message is drawn accented inside the brackets in
//     the pseudo run; anything left outside them was never read through a
//     message. User content the stubs serve (names, card titles, note text: the
//     snapshot's fixtureStrings) is cut out first, longest first, so it is not
//     counted. The baseline is the denominator (how many strings the screen has
//     in English) and says which screens the pseudo run missed. Also lists every
//     request body that carried a bracket: translated text being stored.
import fs from 'node:fs';

const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
// 1,234 and 1234 are the same count.
const norm = (s) => s.replace(/(\d),(?=\d{3}(?!\d))/g, '$1');

// The snapshot as one map per screen: "t: text" or "a: attr=value" to its count.
function flatten(snap) {
  const out = {};
  for (const [id, s] of Object.entries(snap.screens || {})) {
    const m = new Map();
    const add = (prefix, [k, n]) => { const key = `${prefix} ${norm(k)}`; m.set(key, (m.get(key) || 0) + n); };
    for (const e of s.texts || []) add('t:', e);
    for (const e of s.attrs || []) add('a:', e);
    out[id] = m;
  }
  return out;
}

// The strings of `pool` (text -> count) that, in some order, joined by nothing
// or one space, make `target`: two or more of them, or null. Takes them out of
// the pool when it finds them.
function explain(target, pool) {
  const used = [];
  const go = (i) => {
    if (i === target.length) return used.length >= 2;
    for (const [f, n] of pool) {
      if (n <= 0 || !target.startsWith(f, i)) continue;
      pool.set(f, n - 1);
      used.push(f);
      const j = i + f.length;
      if (go(j) || (target[j] === ' ' && go(j + 1))) return true;
      pool.set(f, n);
      used.pop();
    }
    return false;
  };
  return go(0) ? used : null;
}

function compare(args, showMerges) {
  const [b1, b2, after] = args.map(read);
  const f1 = flatten(b1);
  const f2 = flatten(b2);
  const fa = flatten(after);
  let changed = false;
  let unstableTotal = 0;
  let mergeTotal = 0;
  const ids = [...new Set([...Object.keys(f2), ...Object.keys(fa)])].sort();
  for (const id of ids) {
    const base = f2[id];
    const now = fa[id];
    if (!base || !now) {
      console.log(`${id}: ${!base ? 'not in the baseline' : 'MISSING from the run'}`);
      changed = true;
      continue;
    }
    const first = f1[id] || new Map();
    const unstable = new Set();
    for (const k of new Set([...first.keys(), ...base.keys()])) if (first.get(k) !== base.get(k)) unstable.add(k);
    unstableTotal += unstable.size;
    const lostN = new Map();
    const gainN = new Map();
    for (const k of new Set([...base.keys(), ...now.keys()])) {
      if (unstable.has(k)) continue;
      const a = base.get(k) || 0;
      const b = now.get(k) || 0;
      if (a > b) lostN.set(k, a - b);
      else if (b > a) gainN.set(k, b - a);
    }
    const take = (m, k) => { const n = (m.get(k) || 0) - 1; if (n > 0) m.set(k, n); else m.delete(k); };
    const texts = (m) => new Map([...m].filter(([k]) => k.startsWith('t: ')).map(([k, n]) => [k.slice(3), n]));
    const merges = [];
    for (const [whole, parts, kind] of [[gainN, lostN, 'merge'], [lostN, gainN, 'split']]) {
      const pool = texts(parts);
      for (const [t, n] of [...texts(whole)].sort((x, y) => y[0].length - x[0].length)) {
        for (let c = 0; c < n; c++) {
          const used = explain(t, pool);
          if (!used) break;
          merges.push(`${kind}: ${used.map((u) => JSON.stringify(u)).join(' + ')} = ${JSON.stringify(t)}`);
          take(whole, `t: ${t}`);
          for (const u of used) take(parts, `t: ${u}`);
        }
      }
    }
    mergeTotal += merges.length;
    const shown = (k, n) => {
      const a = base.get(k) || 0;
      const b = now.get(k) || 0;
      return `${k}${a && b ? `  (x${a} -> x${b})` : n > 1 ? `  (x${n})` : ''}`;
    };
    const lost = [...lostN].map(([k, n]) => shown(k, n));
    const gained = [...gainN].map(([k, n]) => shown(k, n));
    if (showMerges && merges.length) {
      console.log(`== ${id}: ${merges.length} merged or split`);
      for (const m of merges.sort()) console.log(`  = ${m}`);
    }
    const errors = (after.screens[id]?.i18nErrors) || [];
    if (lost.length || gained.length || errors.length) {
      changed = true;
      console.log(`== ${id}`);
      for (const l of lost.sort()) console.log(`  - ${l}`);
      for (const g of gained.sort()) console.log(`  + ${g}`);
      for (const e of errors) console.log(`  ! ${e}`);
    }
  }
  const gone = (snap) => new Set((snap.missing || []).map((m) => m.id));
  const mb = gone(b2);
  const ma = gone(after);
  for (const id of [...ma].filter((x) => !mb.has(x))) { changed = true; console.log(`missing now, not in the baseline: ${id}`); }
  for (const id of [...mb].filter((x) => !ma.has(x))) { changed = true; console.log(`reached now, missing in the baseline: ${id}`); }
  console.log(`${ids.length} screens compared, ${unstableTotal} unstable strings ignored, ${mergeTotal} text nodes merged or split (same English; --merges lists them), ${changed ? 'CHANGED' : 'no changes'}`);
  return changed ? 1 : 0;
}

const STRIP = /⟦[^⟧]*⟧/g;
const WORDY = /[A-Za-z]{2}/;

function pseudo(args, quiet) {
  const [ps, bs] = args.map(read);
  const base = flatten(bs);
  const fixtures = [...(ps.fixtureStrings || [])].sort((a, b) => b.length - a.length);
  const unwrapped = (value) => {
    let v = value.replace(STRIP, ' ');
    for (const f of fixtures) v = v.split(f).join(' ');
    v = v.replace(/https?:\/\/\S+/g, ' ').replace(/\S+@\S+/g, ' ');
    return WORDY.test(v);
  };
  let all = 0;
  let bad = 0;
  for (const id of Object.keys(ps.screens || {}).sort()) {
    const s = ps.screens[id];
    const rows = [];
    let total = 0;
    for (const [t, n] of s.texts) { total += 1; if (unwrapped(t)) rows.push([`t: ${t}`, n]); }
    for (const [a, n] of s.attrs) { total += 1; if (unwrapped(a.slice(a.indexOf('=') + 1))) rows.push([`a: ${a}`, n]); }
    all += total;
    bad += rows.length;
    const inBase = base[id] ? base[id].size : 'not in the baseline';
    console.log(`== ${id}: ${total} strings (${inBase} in the baseline), ${rows.length} not wrapped`);
    if (!quiet) for (const [r, n] of rows) console.log(`   ${r}${n > 1 ? `  (x${n})` : ''}`);
  }
  for (const id of Object.keys(base)) if (!ps.screens[id]) console.log(`not in the pseudo run: ${id}`);
  for (const m of ps.missing || []) console.log(`missing: ${m.id}: ${m.error}`);
  const stored = [];
  for (const [id, s] of Object.entries(ps.screens || {})) for (const r of s.pseudoRequests || []) stored.push([id, r]);
  console.log(`\nrequest bodies that carried a bracket: ${stored.length}`);
  for (const [id, r] of stored) console.log(`  ${id}: ${r.method} ${r.url}  ${r.body.replace(/\s+/g, ' ').slice(0, 200)}`);
  console.log(`\n${all} strings, ${bad} not wrapped (${all ? Math.round((100 * bad) / all) : 0}%)`);
  return 0;
}

const argv = process.argv.slice(2);
const quiet = argv.includes('--quiet');
const showMerges = argv.includes('--merges');
const rest = argv.filter((a) => a !== '--quiet' && a !== '--merges');
if (rest[0] === '--pseudo' && rest.length === 3) process.exit(pseudo(rest.slice(1), quiet));
if (rest.length === 3 && !rest[0].startsWith('--')) process.exit(compare(rest, showMerges));
console.error('usage: i18nSnapshotDiff.mjs <baseline1.json> <baseline2.json> <after.json> [--merges]\n       i18nSnapshotDiff.mjs --pseudo <pseudo.json> <baseline.json> [--quiet]');
process.exit(2);
