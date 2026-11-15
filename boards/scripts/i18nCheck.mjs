// npm run i18n:check (CI: "Translations are in sync with the code").
//
// 1. The .po catalogs are what `lingui extract --clean` would write now.
// 2. The compiled catalogs (src/locales/<locale>/messages.mjs) are what
//    `lingui compile` would write from them.
//
// 3. src/lib/defaultNames.data.js (the names the app writes into people's data,
//    in every language, read by the Worker) is what scripts/i18nDefaultNames.mjs
//    would write from the .po files.
//
// All are committed, so the Cloudflare build never runs Lingui. The check
// never rewrites a file: it compiles, compares, and puts the originals back.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { check as defaultNamesCurrent } from './i18nDefaultNames.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LOCALES_DIR = join(ROOT, 'src/locales');
const FIX = 'run npm run i18n:build and commit';

function run(args) {
  return spawnSync('npx', ['lingui', ...args], { cwd: ROOT, encoding: 'utf8' });
}

const sync = run(['check', 'sync', '--clean']);
if (sync.status !== 0) {
  process.stdout.write(sync.stdout || '');
  process.stderr.write(sync.stderr || '');
  console.error(`\nThe catalogs are out of sync with the code: ${FIX}.`);
  process.exit(1);
}

const compiled = () => readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => join(LOCALES_DIR, d.name, 'messages.mjs'))
  .filter((f) => existsSync(f));

const before = new Map(compiled().map((f) => [f, readFileSync(f)]));
const compile = run(['compile']);
const changed = [];
for (const [file, original] of before) {
  if (!existsSync(file) || !readFileSync(file).equals(original)) changed.push(file);
}
const fresh = compiled().filter((f) => !before.has(f));
for (const [file, original] of before) writeFileSync(file, original);
for (const f of fresh) changed.push(f);

if (compile.status !== 0) {
  process.stdout.write(compile.stdout || '');
  process.stderr.write(compile.stderr || '');
  console.error('\nlingui compile failed.');
  process.exit(1);
}
if (changed.length) {
  const names = changed.map((f) => f.slice(LOCALES_DIR.length + 1).split('/')[0]);
  console.error(`The compiled catalogs are behind their .po files (${names.join(', ')}): ${FIX}.`);
  process.exit(1);
}
if (!defaultNamesCurrent()) {
  console.error(`src/lib/defaultNames.data.js is behind the catalogs' "default name" entries: ${FIX}.`);
  process.exit(1);
}
console.log('Translations are in sync with the code.');
