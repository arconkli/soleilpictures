// fontLoading.test.mjs — JetBrains Mono never holds up the first paint.
//
//   node --test src/lib/fontLoading.test.mjs
//
// The font was an @import at the top of styles.css: the browser found it only
// once the app's stylesheet had arrived, then waited on Google before painting.
// index.html loads it now, the way it loads Typekit. This keeps it there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const css = readFileSync(resolve(ROOT, 'src/styles.css'), 'utf8');
const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
const worker = readFileSync(resolve(ROOT, 'src/worker.js'), 'utf8');
const HREF = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500&display=swap';

test('styles.css imports no remote stylesheet', () => {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(noComments, /@import\s+(url\()?['"]?https?:/i);
  assert.match(css, /--font-mono:\s*'JetBrains Mono'/);
});

test('index.html loads the font with display=swap and never as a blocking stylesheet', () => {
  assert.ok(html.includes(`<link rel="preload" as="style" href="${HREF}" />`));
  assert.ok(html.includes(`<noscript><link rel="stylesheet" href="${HREF}" /></noscript>`));
  assert.ok(html.includes('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />'));
  // Attached by the page's own nonced script block, next to Typekit.
  assert.match(html, /jb\.rel = 'stylesheet';\s+jb\.href = 'https:\/\/fonts\.googleapis\.com\/css2\?family=JetBrains\+Mono:wght@500&display=swap';\s+document\.head\.appendChild\(jb\);/);
  // Outside <noscript>, no <link rel="stylesheet"> to a font host sits in the markup.
  const live = html.replace(/<noscript>[\s\S]*?<\/noscript>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
  assert.doesNotMatch(live, /<link[^>]+rel="stylesheet"[^>]+(googleapis|typekit)/);
  // No inline event handler: those cannot carry the nonce.
  assert.doesNotMatch(live, /<link[^>]+\sonload=/i);
});

test('the Worker\'s policy allows the stylesheet and its font files', () => {
  assert.match(worker, /"style-src [^"]*https:\/\/fonts\.googleapis\.com/);
  assert.match(worker, /"font-src [^"]*https:\/\/fonts\.gstatic\.com/);
});
