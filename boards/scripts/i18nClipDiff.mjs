// Compares the clips and sideways scroll that tests/i18n-english.spec.js records
// in .i18n-snapshot/<label>.json, an English run against a language run.
//
//   node scripts/i18nClipDiff.mjs <english.json> <lang.json>
//     Both runs must be at the same size (both desktop or both I18N_PHONE=1).
//     Per screen in the language run, prints each clip key (reason, tag and
//     classes: "x button.tm-sbtn" is text cut or ellipsised sideways, "y" cut
//     vertically or line-clamped, "edge" pushed past the right edge) whose count
//     is higher than in English, or absent there, with the count in each run and
//     the language run's samples; "sideways" when the page scrolls sideways in
//     the language and not in English. At the end, the screens present in one
//     run but missing from (or in `missing` of) the other.
//
//     A cut English does not have is a layout bug the translation exposed: the
//     longer or taller words no longer fit. It is a report, not a gate: exit 0.
import fs from 'node:fs';

const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

const argv = process.argv.slice(2);
if (argv.length !== 2) {
  console.error('usage: i18nClipDiff.mjs <english.json> <lang.json>');
  process.exit(2);
}
const [en, lang] = argv.map(read);
const gone = (snap) => new Set((snap.missing || []).map((m) => m.id));
const enGone = gone(en);
const langGone = gone(lang);

let flagged = 0;
let compared = 0;
const onlyLang = [];
for (const id of Object.keys(lang.screens || {}).sort()) {
  const e = en.screens && en.screens[id];
  if (!e) { onlyLang.push(id); continue; }
  compared += 1;
  const l = lang.screens[id];
  const base = new Map((e.clips || []).map(([k, n]) => [k, n]));
  const lines = [];
  for (const [k, n, samples] of l.clips || []) {
    const was = base.get(k) || 0;
    if (n <= was) continue;
    lines.push(`  ${k}  (en x${was} -> x${n})${samples.length ? `  ${samples.map((s) => JSON.stringify(s)).join(' | ')}` : ''}`);
  }
  if (l.sideways && !e.sideways) lines.push('  sideways: the page scrolls sideways (not in English)');
  if (lines.length) {
    flagged += lines.length;
    console.log(`== ${id}`);
    for (const x of lines) console.log(x);
  }
}
const onlyEn = Object.keys(en.screens || {}).filter((id) => !(lang.screens || {})[id]).sort();
for (const id of onlyLang) console.log(`not in the English run: ${id}`);
for (const id of onlyEn) console.log(`not in the language run: ${id}${langGone.has(id) ? ' (missing)' : ''}`);
for (const id of langGone) if (!onlyEn.includes(id) && !enGone.has(id)) console.log(`missing in the language run only: ${id}`);
for (const id of enGone) if (!langGone.has(id) && !onlyLang.includes(id)) console.log(`missing in the English run only: ${id}`);
console.log(`${compared} screens compared, ${flagged} new clips or sideways scrolls`);
