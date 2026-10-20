// No stylesheet here nests one style rule inside another. Nested CSS parses,
// so a block that lands inside another rule (a hunk staged by line number,
// a bad merge) builds fine and silently stops matching: the selector becomes
// "outer inner". That is how the message composer's chip styles ended up
// inside .emoji-palette-btn in 6c00023f. @media, @supports and the other
// at-rules may hold rules; keyframe steps are not style rules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const KEYFRAME_STEP = /^(from|to|\d+(\.\d+)?%)(\s*,\s*(from|to|\d+(\.\d+)?%))*$/;

function cssFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : cssFiles(p);
    return name.endsWith('.css') ? [p] : [];
  });
}

export function nestedStyleRules(css) {
  const found = [];
  const stack = [];
  let prelude = '';
  let line = 1;
  for (let i = 0; i < css.length; i += 1) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      line += (css.slice(i, end).match(/\n/g) || []).length;
      i = end + 1;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c) j += css[j] === '\\' ? 2 : 1;
      prelude += css.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === '\n') line += 1;
    if (c === '{') {
      const p = prelude.trim();
      const kind = p.startsWith('@') ? 'at' : 'style';
      if (kind === 'style' && stack.includes('style') && !KEYFRAME_STEP.test(p)) found.push(`${line}: ${p.slice(0, 80)}`);
      stack.push(kind);
      prelude = '';
    } else if (c === '}' || c === ';') {
      if (c === '}') stack.pop();
      prelude = '';
    } else {
      prelude += c;
    }
  }
  return found;
}

test('the detector finds a rule that landed inside another', () => {
  assert.deepEqual(nestedStyleRules('.a { color: red;\n.b { color: blue; } }'), ['2: .b']);
  assert.deepEqual(nestedStyleRules('@media (x) { .a { color: red; } }\n@keyframes k { 50% { opacity: 0; } }'), []);
  assert.deepEqual(nestedStyleRules('.a { content: "{"; } /* .b { } */'), []);
});

test('no stylesheet nests a style rule inside another', () => {
  const files = cssFiles(SRC);
  assert.ok(files.length > 10, 'found the stylesheets');
  for (const f of files) assert.deepEqual(nestedStyleRules(readFileSync(f, 'utf8')), [], f);
});
