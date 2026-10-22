import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// The Messages QA harness (?msgqa=1) is dev-only. These pin the guards that
// keep it out of production and the seam it relies on. Source scans, like the
// other tests here: the modules under test read import.meta.env.

const SRC = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(join(SRC, rel), 'utf8');

// The first statement of a named function's body.
function firstStatement(src, name) {
  const m = new RegExp(`export function ${name}\\([^)]*\\)\\s*\\{\\s*([^\\n]+)`).exec(src);
  assert.ok(m, `${name} not found`);
  return m[1].trim();
}

test('main.jsx mounts the harness only behind the literal DEV guard', () => {
  const src = read('main.jsx');
  assert.match(src, /\} else if \(import\.meta\.env\.DEV && isMsgQaMode\(\)\) \{/);
  assert.match(src, /import\('\.\/local\/MessagesQaHarness\.jsx'\)/);
});

test('the supabase seam is a live binding whose installer starts with the DEV guard', () => {
  const src = read('lib/supabase.js');
  assert.match(src, /export let supabase = /);
  assert.equal(firstStatement(src, 'installSupabaseForQa'), 'if (!import.meta.env.DEV) return;');
});

test('the attachment resolver hook starts with the DEV guard; the pure links module stays pure', () => {
  assert.equal(firstStatement(read('lib/messageAttachmentUrls.js'), 'installAttachmentResolverForQa'), 'if (!import.meta.env.DEV) return;');
  assert.doesNotMatch(read('lib/messageAttachmentLinks.js'), /import\.meta/);
  assert.match(read('components/MessageBubble.jsx'), /return publicAttachmentUrl\(path\);/);
  assert.match(read('lib/messageAttachments.js'), /publicAttachmentUrl\(att\.storage_path\)/);
});

test('localMode knows ?msgqa: a mode check and a QA_MODE_PARAMS entry', () => {
  const src = read('lib/localMode.js');
  assert.match(src, /export function isMsgQaMode\(\) \{\s*if \(!import\.meta\.env\.DEV/);
  const list = /const QA_MODE_PARAMS = \[([\s\S]*?)\];/.exec(src);
  assert.ok(list && /'msgqa'/.test(list[1]), "QA_MODE_PARAMS lists 'msgqa'");
});

test('nothing aliases the supabase client at module level (the swap is by live binding)', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.(jsx?|mjs)$/.test(name) || /\.test\.mjs$/.test(name)) continue;
      const rel = relative(SRC, full);
      if (rel === 'lib/supabase.js') continue;
      readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
        // `const sb = supabase;` at column 0: a copy taken once, at import time.
        if (/^(const|let|var|export const)\s+\w+\s*=\s*supabase\s*[;,]?\s*$/.test(line)) offenders.push(`${rel}:${i + 1}`);
      });
    }
  };
  walk(SRC);
  assert.deepEqual(offenders, []);
});

test('no app code imports the harness or its fake (only main.jsx may reach the harness)', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const rel = relative(SRC, full);
      if (statSync(full).isDirectory()) { if (rel === 'local') continue; walk(full); continue; }
      if (!/\.(jsx?|mjs)$/.test(name) || /\.test\.mjs$/.test(name)) continue;
      const src = readFileSync(full, 'utf8');
      if (/from\s+['"][^'"]*local\/msgqa/.test(src) || /import\(\s*['"][^'"]*local\/msgqa/.test(src)) offenders.push(rel);
      if (rel !== 'main.jsx' && /(from\s+|import\(\s*)['"][^'"]*MessagesQaHarness/.test(src)) offenders.push(rel);
    }
  };
  walk(SRC);
  assert.deepEqual(offenders, []);
});
