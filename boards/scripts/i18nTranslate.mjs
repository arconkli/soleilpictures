// The translators' tool. Translators work in plain text files; this writes those
// files from the catalogs, checks a translation file, and writes checked
// translations back into src/locales/<locale>/messages.po.
//
//   node scripts/i18nTranslate.mjs export <locale> [--chunks 12]   untranslated messages -> DIR/in/NN.txt + DIR/index.json
//   node scripts/i18nTranslate.mjs check  <locale> <file…>         lint a translation file (exit 1 on any error)
//   node scripts/i18nTranslate.mjs apply  <locale> <file…>         check, then write into the .po (nothing on any error)
//   node scripts/i18nTranslate.mjs review <locale>                 DIR/review/<locale>/NN.txt: English beside the catalog's translation
//   node scripts/i18nTranslate.mjs status                          messages, translated, missing per locale
//
// DIR is .i18n-snapshot/translate (gitignored) unless --dir says otherwise.
// A translation file: one line per message, `number<TAB>"translation as a JSON string"`.
// The checks live in scripts/i18nLint.mjs. apply does not compile: run
// npm run i18n:build afterwards. Parser/serializer: @lingui/format-po.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, basename, resolve } from 'node:path';
import { formatter } from '@lingui/format-po';
import { lintTranslation, normalizeTranslation } from './i18nLint.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LOCALES_DIR = join(ROOT, 'src/locales');
const DEFAULT_DIR = join(ROOT, '.i18n-snapshot/translate');
const poFile = (locale) => join(LOCALES_DIR, locale, 'messages.po');
const ctxOf = (locale) => ({ locale, sourceLocale: 'en', filename: 'messages.po' });

const fail = (msg) => { console.error(msg); process.exit(1); };

function loadCatalog(locale, lineNumbers = false) {
  const file = poFile(locale);
  if (!existsSync(file)) fail(`No catalog for "${locale}": ${file}`);
  const src = readFileSync(file, 'utf8');
  return { src, catalog: formatter({ lineNumbers }).parse(src, ctxOf(locale)) };
}

function localesToTranslate() {
  return readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'en' && existsSync(poFile(d.name)))
    .map((d) => d.name);
}

function checkLocale(locale) {
  if (!locale || !localesToTranslate().includes(locale)) fail(`Say which language: one of ${localesToTranslate().join(', ')}.`);
}

// ---- export ---------------------------------------------------------------

// Where each message sits in the code: { id: { file, line } } from a second,
// line-numbered extract into a temp folder (the catalogs carry no line numbers).
function sourceLines() {
  mkdirSync(join(ROOT, '.i18n-snapshot'), { recursive: true });
  const tmp = mkdtempSync(join(ROOT, '.i18n-snapshot/lines-'));
  try {
    const config = join(tmp, 'lingui.config.mjs');
    writeFileSync(config, `import real from ${JSON.stringify(pathToFileURL(join(ROOT, 'lingui.config.js')).href)};
import { formatter } from '@lingui/format-po';
export default {
  ...real,
  rootDir: ${JSON.stringify(ROOT)},
  locales: ['en'],
  format: formatter({ lineNumbers: true }),
  catalogs: [{ ...real.catalogs[0], path: ${JSON.stringify(join(tmp, '{locale}/messages'))} }],
};
`);
    const run = spawnSync('npx', ['lingui', 'extract', '--config', config], { cwd: ROOT, encoding: 'utf8' });
    if (run.status !== 0) fail(`lingui extract (line numbers) failed:\n${run.stdout}${run.stderr}`);
    const src = readFileSync(join(tmp, 'en/messages.po'), 'utf8');
    const catalog = formatter({ lineNumbers: true }).parse(src, ctxOf('en'));
    const out = {};
    for (const [id, entry] of Object.entries(catalog)) {
      const origins = (entry.origin || []).map(([file, line]) => ({ file, line: line ?? 0 }));
      origins.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
      if (origins.length) out[id] = origins[0];
    }
    return out;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const noteOf = (entry) => (entry.comments || []).join('; ');
const tail = (e) => `${e.context ? `\tctx ${JSON.stringify(e.context)}` : ''}${e.note ? `\tnote ${JSON.stringify(e.note)}` : ''}`;

// Chunk boundaries (end offsets into the numbered list): about N/K each, cut at
// a file boundary when one lies within ±15% of the target, else mid-file.
function chunkEnds(files, total, chunks) {
  const target = total / chunks;
  const fileEnds = [];
  let at = 0;
  for (const f of files) { at += f.length; fileEnds.push(at); }
  const ends = [];
  let prev = 0;
  for (let k = 1; k < chunks; k++) {
    const ideal = Math.round((k * total) / chunks);
    let cut = ideal;
    let best = Infinity;
    for (const e of fileEnds) {
      const d = Math.abs(e - ideal);
      if (e > prev && d <= 0.15 * target && d < best) { best = d; cut = e; }
    }
    if (cut <= prev) cut = Math.min(total, prev + 1);
    ends.push(cut);
    prev = cut;
  }
  ends.push(total);
  return ends.filter((e, i) => i === 0 || e > ends[i - 1]);
}

function groupsOf(entries) {
  // entries: [{ n, file, … }] in order -> consecutive same-file runs
  const out = [];
  for (const e of entries) {
    const last = out[out.length - 1];
    if (last && last.file === e.file) last.items.push(e); else out.push({ file: e.file, items: [e] });
  }
  return out;
}

function writeChunkFile(path, header, chunkEntries, line) {
  let text = `${header}\n`;
  for (const g of groupsOf(chunkEntries)) {
    text += `@ ${g.file}\n`;
    for (const e of g.items) text += `${line(e)}\n`;
  }
  writeFileSync(path, text);
}

function cmdExport(locale, opts) {
  checkLocale(locale);
  const chunks = Math.max(1, Number(opts.chunks) || 12);
  const { catalog } = loadCatalog(locale);
  const lines = sourceLines();
  const todo = Object.entries(catalog)
    .filter(([, e]) => !e.obsolete && !e.translation)
    .map(([id, e]) => {
      const lineInfo = lines[id] || { file: (e.origin?.[0]?.[0]) || '(unknown)', line: 0 };
      return { id, message: e.message || '', context: e.context || '', note: noteOf(e), file: lineInfo.file, line: lineInfo.line };
    });
  todo.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || (a.id < b.id ? -1 : 1)));
  todo.forEach((e, i) => { e.n = i + 1; });

  const total = todo.length;
  const dir = opts.dir;
  rmSync(join(dir, 'in'), { recursive: true, force: true });
  mkdirSync(join(dir, 'in'), { recursive: true });

  const ends = total ? chunkEnds(groupsOf(todo).map((g) => g.items), total, Math.min(chunks, total)) : [];
  const index = { locale, messages: {} };
  const summary = [];
  let start = 0;
  ends.forEach((end, i) => {
    const part = todo.slice(start, end);
    const name = String(i + 1).padStart(2, '0');
    const header = `# in/${name}.txt: messages ${part[0].n}–${part[part.length - 1].n} of ${total}. One per line: number, a tab, the English as a JSON string, then any of: ctx "…" (the message's context), note "…" (a note from the code).`;
    writeChunkFile(join(dir, 'in', `${name}.txt`), header, part, (e) => `${e.n}\t${JSON.stringify(e.message)}${tail(e)}`);
    for (const e of part) {
      index.messages[e.n] = { id: e.id, message: e.message, ...(e.context ? { context: e.context } : {}), ...(e.note ? { note: e.note } : {}), file: e.file, chunk: i + 1 };
    }
    summary.push(`${name}: ${part.length} messages, ${part[0].file} … ${part[part.length - 1].file}`);
    start = end;
  });
  writeFileSync(join(dir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  console.log(`${locale}: ${total} messages to translate in ${ends.length} files in ${join(dir, 'in')}`);
  for (const s of summary) console.log(`  ${s}`);
}

// ---- check / apply --------------------------------------------------------

function loadIndex(dir, locale) {
  const file = join(dir, 'index.json');
  if (!existsSync(file)) fail(`No ${file}: run export ${locale} first.`);
  const index = JSON.parse(readFileSync(file, 'utf8'));
  if (index.locale !== locale) fail(`${file} is for "${index.locale}", not "${locale}": run export ${locale} (or use --dir).`);
  return index;
}

// Lints each file. Returns { ok: [{ n, text }], errors, warnings, lines } and prints findings.
function checkFiles(locale, files, dir, { complete }) {
  const index = loadIndex(dir, locale);
  const result = { entries: [], errors: 0, warnings: 0 };
  for (const file of files) {
    let lineCount = 0;
    let errors = 0;
    let warnings = 0;
    const seen = new Set();
    const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
    const say = (lineNo, n, kind, msg) => {
      console.log(`${file}:${lineNo}${n ? ` n=${n}` : ''} ${kind} ${msg}`);
      if (kind === 'ERROR') errors++; else warnings++;
    };
    text.forEach((raw, i) => {
      const m = raw.match(/^(\d+)\t(.*)$/);
      if (!m) return;
      lineCount++;
      const n = m[1];
      const field = m[2].split('\t')[0];
      const item = index.messages[n];
      if (!item) return say(i + 1, n, 'ERROR', 'unknown number: not in index.json');
      if (seen.has(n)) return say(i + 1, n, 'ERROR', 'number given twice');
      seen.add(n);
      let value;
      try { value = JSON.parse(field); } catch { return say(i + 1, n, 'ERROR', 'not valid JSON: write the translation as one JSON string in double quotes, escaping " as \\"'); }
      if (typeof value !== 'string') return say(i + 1, n, 'ERROR', 'not a JSON string');
      const { errors: errs, warnings: warns } = lintTranslation(item.message, value, locale);
      for (const e of errs) say(i + 1, n, 'ERROR', e);
      for (const w of warns) say(i + 1, n, 'WARN', w);
      if (!errs.length) result.entries.push({ n, id: item.id, text: normalizeTranslation(item.message, value, locale) });
    });
    const inFile = join(dir, 'in', basename(file));
    if (complete && /^\d\d\.txt$/.test(basename(file)) && existsSync(inFile)) {
      const missing = [];
      for (const raw of readFileSync(inFile, 'utf8').split('\n')) {
        const m = raw.match(/^(\d+)\t/);
        if (m && !seen.has(m[1])) missing.push(m[1]);
      }
      if (missing.length) {
        console.log(`${file} ERROR missing ${missing.length} of the numbers in ${inFile}: ${missing.join(', ')}`);
        errors++;
      }
    }
    console.log(`${file}: ${lineCount} lines, ${errors} errors, ${warnings} warnings`);
    result.errors += errors;
    result.warnings += warnings;
  }
  return { ...result, index };
}

function cmdCheck(locale, files, opts) {
  checkLocale(locale);
  if (!files.length) fail('Name the file(s) to check.');
  const { errors } = checkFiles(locale, files, opts.dir, { complete: true });
  process.exit(errors ? 1 : 0);
}

function cmdApply(locale, files, opts) {
  checkLocale(locale);
  if (!files.length) fail('Name the file(s) to apply.');
  const { errors, entries, index } = checkFiles(locale, files, opts.dir, { complete: false });
  if (errors) fail(`Refused: ${errors} error${errors === 1 ? '' : 's'}. Nothing was written.`);
  const { src, catalog } = loadCatalog(locale);
  let written = 0;
  const skipped = [];
  for (const e of entries) {
    const entry = catalog[e.id];
    if (!entry || entry.message !== index.messages[e.n].message) { skipped.push(e.n); continue; }
    entry.translation = e.text;
    written++;
  }
  let out = formatter({ lineNumbers: false }).serialize(catalog, ctxOf(locale));
  // The header's date is the extractor's to move, not ours.
  const date = (s) => s.match(/^"POT-Creation-Date: .*\\n"$/m)?.[0];
  if (date(src) && date(out)) out = out.replace(date(out), date(src));
  if (written) writeFileSync(poFile(locale), out);
  if (skipped.length) console.log(`Skipped ${skipped.length} (the code changed since the export, or the message is gone): n=${skipped.join(', ')}`);
  console.log(`${locale}: ${written} translation${written === 1 ? '' : 's'} written to src/locales/${locale}/messages.po. Next: npm run i18n:build`);
}

// ---- review ---------------------------------------------------------------

function cmdReview(locale, opts) {
  checkLocale(locale);
  const dir = opts.dir;
  const index = loadIndex(dir, locale);
  const { catalog } = loadCatalog(locale);
  const out = join(dir, 'review', locale);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const all = Object.entries(index.messages).map(([n, m]) => ({ n: Number(n), ...m })).sort((a, b) => a.n - b.n);
  const total = all.length;
  const byChunk = new Map();
  for (const e of all) { if (!byChunk.has(e.chunk)) byChunk.set(e.chunk, []); byChunk.get(e.chunk).push(e); }
  let files = 0;
  for (const [chunk, part] of byChunk) {
    const name = String(chunk).padStart(2, '0');
    const header = `# review/${locale}/${name}.txt: messages ${part[0].n}–${part[part.length - 1].n} of ${total}. One per line: number, a tab, the English as a JSON string, a tab, the catalog's translation as a JSON string ("" when none), then any of: ctx "…" (the message's context), note "…" (a note from the code).`;
    writeChunkFile(join(out, `${name}.txt`), header, part, (e) => `${e.n}\t${JSON.stringify(e.message)}\t${JSON.stringify(catalog[e.id]?.translation || '')}${tail(e)}`);
    files++;
  }
  console.log(`${locale}: ${total} messages in ${files} files in ${out}`);
}

// ---- status ---------------------------------------------------------------

function cmdStatus() {
  for (const locale of localesToTranslate()) {
    const { catalog } = loadCatalog(locale);
    const live = Object.values(catalog).filter((e) => !e.obsolete);
    const translated = live.filter((e) => e.translation).length;
    console.log(`${locale}: ${live.length} messages, ${translated} translated, ${live.length - translated} missing`);
  }
}

// ---- cli ------------------------------------------------------------------

const args = process.argv.slice(2);
const opts = { dir: DEFAULT_DIR, chunks: 12 };
const rest = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dir') opts.dir = resolve(args[++i] || '');
  else if (args[i] === '--chunks') opts.chunks = args[++i];
  else rest.push(args[i]);
}
const [cmd, locale, ...files] = rest;

switch (cmd) {
  case 'export': cmdExport(locale, opts); break;
  case 'check': cmdCheck(locale, files, opts); break;
  case 'apply': cmdApply(locale, files, opts); break;
  case 'review': cmdReview(locale, opts); break;
  case 'status': cmdStatus(); break;
  default: fail('Usage: node scripts/i18nTranslate.mjs export|check|apply|review <locale> [files…] [--dir DIR] [--chunks 12] | status');
}
