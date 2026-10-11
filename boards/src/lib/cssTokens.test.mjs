// cssTokens.test.mjs — every var(--x) in the app must name a token that is
// defined somewhere.
//
// An undefined custom property fails silently, and in the worst possible way.
// `var(--bg3, #1a1a1f)` (the real token is --bg-3) does not look broken in dark
// theme: the hard-coded dark fallback paints, so it reads as correct — and then
// ships a near-black file card with #2c2c30 text into light theme. With no
// fallback it is quieter still: `border: 1px solid var(--bd-1)` is invalid at
// computed-value time, so the whole border just isn't there. An audit found 22
// such names (--bg0/--bg1/--bg2/--bg3, --line2, --bd-1, --accent-2, --bg-elev,
// --on-soleil …), several of them copied from one file to the next because
// they looked like they worked (VIS-03, VIS-12).
//
// "Defined" means one of:
//   - a declaration `--x:` in any stylesheet or inline style string, or
//   - the name as a quoted string in JS/JSX — setProperty('--x', …) and React
//     style objects ({ '--x': … }) set tokens at runtime that no stylesheet
//     declares (--upgrade-chip-gutter, --ct-progress, --peer-color …).
// Comments are stripped first, so prose that mentions a token by name does
// not count as a use or a definition.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('..', import.meta.url));

// Tokens whose NAME is built at runtime, so no literal exists to find. Keep
// this empty unless the dynamic setter is real; say where it lives.
const RUNTIME_ONLY = new Set([]);

function walk(dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.(css|jsx?|mjs)$/.test(ent.name) && !/\.test\.mjs$/.test(ent.name)) out.push(p);
  }
  return out;
}

// Blank comments out rather than deleting them, so line numbers still point
// at the real line.
const blank = (t) => t.replace(/[^\n]/g, ' ');
function stripComments(text, isCss) {
  if (isCss) return text.replace(/\/\*[\s\S]*?\*\//g, blank);
  // Script: a `/*` glued to a word or quote is a string ('image/*', '*/*'),
  // not a comment, and eating from there to the next `*/` would hide real
  // code. The [^:] guard on line comments keeps https:// intact.
  return text
    .replace(/(?<![\w'"`*/.])\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:\\])(\/\/[^\n]*)/g, (_, pre, c) => pre + blank(c));
}

function scan() {
  const defined = new Set(RUNTIME_ONLY);
  const uses = new Map(); // name -> ['file:line', …]
  for (const file of walk(SRC)) {
    const isCss = file.endsWith('.css');
    const raw = readFileSync(file, 'utf8');
    const text = stripComments(raw, isCss);
    for (const m of text.matchAll(/(?<![\w-])(--[\w-]+)\s*:/g)) defined.add(m[1]);
    // Runtime setters are read from the raw source: a stray definition from a
    // comment can only make this test more lenient, never wrongly red.
    if (!isCss) for (const m of raw.matchAll(/['"`](--[\w-]+)['"`]/g)) defined.add(m[1]);
    for (const m of text.matchAll(/var\(\s*(--[\w-]+)/g)) {
      const line = text.slice(0, m.index).split('\n').length;
      const at = `${relative(SRC, file)}:${line}`;
      if (!uses.has(m[1])) uses.set(m[1], []);
      uses.get(m[1]).push(at);
    }
  }
  return { defined, uses };
}

test('every var(--token) used in src names a token that is defined', () => {
  const { defined, uses } = scan();
  assert.ok(uses.size > 100, 'the scan found almost no var() uses — it is not reading the stylesheets');
  const missing = [...uses].filter(([name]) => !defined.has(name));
  assert.deepEqual(
    missing.map(([name, at]) => `${name} (${at.length}×, e.g. ${at[0]})`),
    [],
    'These tokens are used but never defined, so each use falls back (or drops ' +
    'the whole declaration). Use the real token — --bg-0…4, --line-1…3, ' +
    '--ink-0…4, --radius/-sm/-md/-lg — or define the new one in :root and ' +
    "[data-theme='light'] in styles.css.",
  );
});

test('the scan catches a typo it is meant to catch', () => {
  // Guard the guard: a regex that matched nothing would pass the test above.
  const { defined } = scan();
  assert.ok(defined.has('--bg-3') && !defined.has('--bg3'));
  assert.ok(defined.has('--line-2') && !defined.has('--line2'));
});

test('the theme blocks declare color-scheme, so native controls follow the theme', () => {
  // Without it a date field in dark theme draws a black calendar icon on a
  // #16161a fill and opens a white picker; selects and checkboxes stay light
  // (VIS-11). The scheme rides on the same blocks as the tokens.
  const css = stripComments(readFileSync(join(SRC, 'styles.css'), 'utf8'), true);
  const block = (sel) => {
    const at = css.indexOf(`${sel} {`);
    assert.ok(at >= 0, `${sel} block not found in styles.css`);
    return css.slice(at, css.indexOf('}', at));
  };
  assert.match(block(':root'), /color-scheme:\s*dark/);
  assert.match(block("[data-theme='light']"), /color-scheme:\s*light/);
});

test('iframes keep color-scheme normal, so embeds stay transparent in dark theme', () => {
  // An iframe inherits `dark` from :root; when that differs from the embedded
  // document's scheme (third-party embeds declare none) Chromium paints an
  // opaque white backdrop behind it, boxing X/Spotify/IG embeds in white.
  const css = stripComments(readFileSync(join(SRC, 'styles.css'), 'utf8'), true);
  assert.match(css, /(?:^|\n)iframe\s*\{[^}]*color-scheme:\s*normal/);
});

test('nothing on a gold fill is inked with --bg-0', () => {
  // --bg-0 is near-black in dark theme and near-white (#f5f5f7) in light, so
  // as text on #ffa500 it reads in one theme and sits at about 1.8:1 in the
  // other: the 9.5px VIEW ONLY badge, unread counts, Send (VIS-10). Ink on
  // gold is --on-soleil, which is dark in both themes. The workspace rail is
  // the one exception: its light-theme block re-inks those chips white on
  // purpose.
  const RAIL = new Set(['.rail-ws.active', '.rail-avatar']);
  const css = stripComments(readFileSync(join(SRC, 'styles.css'), 'utf8'), true);
  const bad = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const body = m[2];
    if (!/background(?:-color)?:\s*var\(--(soleil|accent)\)/.test(body)) continue;
    const sel = m[1].trim().split('\n').pop().trim();
    if (!RAIL.has(sel) && /(?<![\w-])color:\s*var\(--bg-0\b/.test(body)) bad.push(sel);
  }
  assert.deepEqual(bad, []);
});
