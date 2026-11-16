// A shared file's comment rail is a chunk of its own (components/comments/
// fileCommentParts.js), fetched by the public /f/<token> page. Nothing it
// imports may reach the canvas or a doc, and the files the shared-file page
// loads at once may not even name the canvas's comment chunk in an import():
// either one makes the bundler split what the comment parts share with the
// canvas out of the canvas's chunk (the app's first download grows) and puts
// canvas code on a public page. scripts/bundleBudget.mjs sees the size in a
// build; this says which import did it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Across lines: `import {\n a,\n b\n} from '../cards.jsx'` is one import.
// Between the keyword and `from` there is never a quote or a semicolon.
const IMPORT = /(?:^|[\n;])\s*(?:import|export)\s+(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC = /import\(\s*(?:\/\*[^*]*\*\/\s*)?['"]([^'"]+)['"]\s*\)/g;

const read = (file) => readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '');
// A relative import has to be a file that is there: one written without its
// extension, or misspelt, would otherwise drop out of the walk unseen.
function target(from, spec) {
  if (!spec.startsWith('.')) return null;   // a package
  const at = resolve(dirname(from), spec.replace(/[?#].*$/, ''));
  assert.ok(existsSync(at) && statSync(at).isFile(), `${from.slice(SRC.length + 1)} imports ${spec}, which is not a file`);
  return at;
}
// Every file `start` imports statically, itself included.
function closure(start) {
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    if (!/\.(?:jsx?|mjs)$/.test(file)) return;
    for (const m of read(file).matchAll(IMPORT)) {
      const next = target(file, m[1]);
      if (next) walk(next);
    }
  };
  walk(resolve(SRC, start));
  return [...seen].map((f) => f.slice(SRC.length + 1));
}

const CANVAS_OR_DOC = /(?:^|\/)(?:cards\.jsx|CanvasSurface\.jsx|docState\.js|commentsApi\.js|canvasThreads\.js|docThreadOps\.js|CommentAbout\.jsx|canvasComments\.css|commentParts\.js|CanvasComment[A-Za-z]*\.jsx|DocThreadsPanel\.jsx|DocFloatCards\.jsx|boardsApi\.js)$/;

test("a shared file's comment chunk holds no canvas or doc code", () => {
  const files = closure('components/comments/fileCommentParts.js');
  assert.ok(files.includes('components/comments/FileThreads.jsx'));
  assert.ok(files.includes('components/comments/CommentCard.jsx'));
  assert.ok(files.includes('components/comments/commentsLook.css'));
  assert.deepEqual(files.filter((f) => CANVAS_OR_DOC.test(f)), []);
});

test('what the shared-file page loads at once never asks for the canvas comment chunks', () => {
  const files = closure('components/fileShare/FileSharePage.jsx');
  assert.ok(files.includes('components/comments/commentPartsLazy.jsx'));
  assert.ok(!files.includes('components/comments/canvasPartsLazy.jsx'), 'the shared-file page imports canvasPartsLazy.jsx');
  for (const f of files.filter((x) => x.startsWith('components/comments/') || x.startsWith('components/fileShare/'))) {
    const asked = [...read(resolve(SRC, f)).matchAll(DYNAMIC)].map((m) => m[1]);
    const hit = asked.filter((spec) => /commentParts\.js|CanvasComment|canvasPartsLazy/.test(spec) && !/fileCommentParts/.test(spec));
    assert.deepEqual(hit, [], `${f} asks for ${hit.join(', ')}`);
  }
});

test('KindIcon is a module of its own, and cards.jsx only imports it', () => {
  assert.match(read(resolve(SRC, 'components/KindIcon.jsx')), /export function KindIcon/);
  const cards = read(resolve(SRC, 'components/cards.jsx'));
  assert.doesNotMatch(cards, /export\s+(?:function|const)\s+KindIcon/);
  assert.doesNotMatch(read(resolve(SRC, 'components/KindIcon.jsx')), /cards\.jsx/);
});
