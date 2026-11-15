// Pins the Soleil brand guide (docs/brand/) to the code it describes.
//
// docs/brand/tokens.json is the Design System token file the guide ships with.
// The guide's colours, type, radii and shadows are copies of values that live
// in code, so this test reads those sources and fails, naming the token, when
// one moves. The pin table is here, not in tokens.json.
//
//   a. grammar: tokens.json has the shape the Claude design-system page reads
//   b. pins:    every token that comes from code equals its source, both ways
//   c. hexes:   every hex written in docs/brand/*.md is a token value or drift
//   d. paths:   every repo path written in backticks in docs/brand/*.md exists
//
// When one goes red: update docs/brand/tokens.json and the guide pages, or
// record the difference in docs/brand/drift.md. Do not edit the pin to match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p) => readFileSync(REPO + p, 'utf8');
const TOKENS = JSON.parse(read('docs/brand/tokens.json'));
const FIX = 'update docs/brand/tokens.json and the guide pages, or record it in docs/brand/drift.md';

// Production only: the guide describes the email look (8f4aa6c0), which has
// not shipped to production. Until it does, theme.ts and the files that came
// with it are absent here, so the email pin and those paths wait for it. Main
// keeps the strict test; the release that ships the email look takes main's.
const EMAIL_LOOK_FILES = [
  'supabase/functions/_shared/email/theme.ts',
  'boards/scripts/gen-magic-link.mjs',
  'boards/public/email/mark-dark-84.png',
  'boards/src/lib/emailLook.test.mjs',
];
const EMAIL_LOOK_SHIPPED = existsSync(REPO + EMAIL_LOOK_FILES[0]);

const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/;
const FN_COLOUR = /^(rgb|rgba|hsl|hsla)\([^()]*\)$/;
const LENGTH = /^-?(\d+|\d*\.\d+)(px|rem|em|%)?$/;
const FAMILIES = ['color', 'spacing', 'radius', 'shadow'];

const themesOf = TOKENS.color?.themes?.map((t) => t.id) ?? [];
const valueFor = (tok, theme) => (typeof tok.value === 'string' ? tok.value : tok.value[theme] ?? tok.value.dark);
const colourByName = new Map((TOKENS.color?.tokens ?? []).map((t) => [t.name, t]));
const allTokens = () => FAMILIES.flatMap((f) => TOKENS[f]?.tokens ?? []);
const tokenByName = (n) => allTokens().find((t) => t.name === n);

// Resolve "{alias}" to the hex or rgba it names, in a theme.
function resolveColour(tok, theme) {
  let v = valueFor(tok, theme);
  for (let i = 0; i < 5 && /^\{.+\}$/.test(v); i++) {
    const target = colourByName.get(v.slice(1, -1));
    assert.ok(target, `colour token "${tok.name}" aliases "${v}", which is not a colour token`);
    v = valueFor(target, theme);
  }
  return v;
}
// Compare values as the CSS means them: case, spacing and a leading or trailing zero don't count.
const norm = (v) => String(v).toLowerCase().replace(/\s+/g, '').replace(/(^|[^\d])0\./g, '$1.').replace(/(\.\d*[1-9])0+(?!\d)|\.0+(?!\d)/g, '$1');

test('grammar: tokens.json has the Design System shape', () => {
  assert.equal(TOKENS.name, 'Soleil');
  assert.equal(TOKENS.version, 1);
  assert.deepEqual(themesOf, ['dark', 'light'], 'color.themes: dark first, then light');
  for (const t of TOKENS.color.themes) assert.ok(typeof t.name === 'string' && t.name, `theme ${t.id} needs a name`);

  const seen = new Map();
  for (const f of FAMILIES) {
    const list = TOKENS[f]?.tokens;
    assert.ok(Array.isArray(list) && list.length, `${f}.tokens must be a non-empty list, never a name->value map`);
    assert.deepEqual(Object.keys(TOKENS[f]), f === 'color' ? ['themes', 'tokens'] : ['tokens'], `${f} holds only ${f === 'color' ? '"themes" and ' : ''}"tokens"`);
    for (const tok of list) {
      assert.deepEqual(Object.keys(tok).sort(), ['name', 'usage', 'value'], `${f} token ${tok.name}: keys are name, value, usage`);
      assert.match(tok.name, NAME, `${f} token name "${tok.name}"`);
      assert.ok(!seen.has(tok.name), `token name "${tok.name}" is in ${seen.get(tok.name)} and ${f}: names are unique across families`);
      seen.set(tok.name, f);
      assert.ok(typeof tok.usage === 'string' && tok.usage.trim() && !/\n/.test(tok.usage), `${tok.name}: usage is one short sentence`);
    }
  }

  // Values: a string (the dark theme) or {dark, light} with dark first.
  for (const f of FAMILIES) {
    for (const tok of TOKENS[f].tokens) {
      const v = tok.value;
      if (typeof v === 'object') {
        assert.ok(v && !Array.isArray(v), `${tok.name}: value is a string or {dark, light}`);
        const keys = Object.keys(v);
        assert.equal(keys[0], 'dark', `${tok.name}: dark is the primary theme and comes first`);
        assert.ok(keys.every((k) => themesOf.includes(k)), `${tok.name}: unknown theme in ${keys}`);
      } else assert.equal(typeof v, 'string', `${tok.name}: value is a string or {dark, light}`);
    }
  }

  // Colours: hex, rgb/rgba/hsl without a function inside, or an alias of another colour token.
  for (const tok of TOKENS.color.tokens) {
    for (const theme of themesOf) {
      const v = valueFor(tok, theme);
      if (/^\{.+\}$/.test(v)) {
        const target = v.slice(1, -1);
        assert.notEqual(target, tok.name, `${tok.name}: an alias cannot name itself`);
        const t = colourByName.get(target);
        assert.ok(t, `${tok.name}: alias ${v} is not a colour token`);
        assert.ok(!/^\{.+\}$/.test(valueFor(t, theme)), `${tok.name}: alias ${v} points at another alias`);
      } else {
        assert.ok(HEX.test(v) || FN_COLOUR.test(v), `${tok.name} (${theme}): "${v}" is not a hex, rgb()/rgba()/hsl() or {alias}`);
        assert.ok(!/var\(|color-mix|transparent|currentcolor/i.test(v), `${tok.name}: no var(), color-mix() or named colours`);
      }
    }
  }
  // Hex style: lowercase, 6 digits (8 with alpha).
  for (const tok of TOKENS.color.tokens) {
    for (const v of typeof tok.value === 'string' ? [tok.value] : Object.values(tok.value)) {
      if (v.startsWith('#')) assert.match(v, /^#([0-9a-f]{6}|[0-9a-f]{8})$/, `${tok.name}: hex is lowercase, 6 digits (8 with alpha)`);
    }
  }
  const canon = ['night', 'ink', 'soleil', 'ink-on-soleil', 'sun-shade', 'sun-cream', 'sunset-glow'];
  assert.deepEqual(TOKENS.color.tokens.slice(0, 7).map((t) => t.name), canon, 'the seven canon brand tokens come first');

  // Type
  const ty = TOKENS.type;
  assert.ok(Array.isArray(ty.fonts) && ty.fonts.length, 'type.fonts is a list');
  for (const f of ty.fonts) {
    assert.equal(f.family, 'Aileron');
    assert.match(f.file, /^fonts\/[\w.-]+\.woff2$/, `font file ${f.file}`);
    assert.match(f.weight, /^\d{3}$/);
  }
  assert.deepEqual(Object.keys(ty.families), ['display', 'sans', 'mono', 'script']);
  for (const [k, v] of Object.entries(ty.families)) assert.ok(typeof v === 'string' && v.trim(), `type.families.${k}`);
  assert.ok(Array.isArray(ty.groups) && ty.groups.length);
  const styleNames = new Set();
  for (const g of ty.groups) {
    assert.ok(g.name && ty.families[g.family], `type group "${g.name}" names a family in type.families`);
    for (const s of g.styles) {
      assert.match(s.name, NAME, `type style name "${s.name}"`);
      assert.ok(!styleNames.has(s.name), `type style "${s.name}" repeats`);
      styleNames.add(s.name);
      assert.match(s.fontSize, LENGTH, `${s.name}.fontSize`);
      assert.match(String(s.lineHeight), LENGTH, `${s.name}.lineHeight`);
      assert.equal(typeof s.fontWeight, 'number', `${s.name}.fontWeight is a number`);
      if (s.letterSpacing !== undefined) assert.match(s.letterSpacing, LENGTH, `${s.name}.letterSpacing`);
    }
  }
  // Lengths and shadows.
  for (const f of ['spacing', 'radius']) {
    for (const tok of TOKENS[f].tokens) assert.match(String(tok.value), LENGTH, `${f} token ${tok.name}: "${tok.value}" is a length`);
  }
  for (const tok of TOKENS.shadow.tokens) {
    for (const v of typeof tok.value === 'string' ? [tok.value] : Object.values(tok.value)) {
      assert.ok(!/var\(|color-mix/.test(v), `shadow ${tok.name}: no var() or color-mix()`);
    }
  }
});

// ---- b. pins --------------------------------------------------------------

function block(css, start) {
  const i = css.indexOf(start);
  assert.ok(i >= 0, `${start} not found`);
  let j = css.indexOf('{', i);
  const b = j;
  let d = 0;
  for (; j < css.length; j++) {
    if (css[j] === '{') d++;
    if (css[j] === '}' && --d === 0) break;
  }
  return css.slice(b + 1, j).replace(/\/\*[\s\S]*?\*\//g, '');
}
const propsOf = (b) => Object.fromEntries([...b.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const isPlainColour = (v) => /^(#[0-9a-f]{3,8}|rgba?\([^()]*\))$/i.test(v);

const STYLES = 'boards/src/styles.css';
const css = read(STYLES);
const DARK = propsOf(block(css, ':root {'));
const LIGHT = propsOf(block(css, "[data-theme='light'] {"));
// A property the light block doesn't set keeps its dark value.
const effective = (prop, theme) => (theme === 'light' && prop in LIGHT ? LIGHT[prop] : DARK[prop]);
// Custom properties whose token carries a different name.
const TOKEN_FOR_PROP = { '--soleil': 'soleil', '--on-soleil': 'ink-on-soleil' };
const tokenNameFor = (prop) => TOKEN_FOR_PROP[prop] ?? prop.slice(2);

function pin(tokenName, source, expected, theme = 'dark') {
  const tok = tokenByName(tokenName);
  assert.ok(tok, `token "${tokenName}" is missing: ${source} has a value for it. ${FIX}`);
  const actual = tok.value && (TOKENS.color.tokens.includes(tok) ? resolveColour(tok, theme) : valueFor(tok, theme));
  assert.equal(norm(actual), norm(expected), `token "${tokenName}" (${theme}) is ${actual} but ${source} has ${expected}. ${FIX}`);
}

test('pins: Clusters colours equal styles.css, both ways', () => {
  for (const theme of ['dark', 'light']) {
    const block = theme === 'dark' ? DARK : { ...DARK, ...LIGHT };
    for (const prop of Object.keys(DARK).concat(Object.keys(LIGHT))) {
      if (!isPlainColour(effective(prop, theme))) continue;
      // Reverse: every plain-colour property has a token. Forward: the token equals it.
      pin(tokenNameFor(prop), `${STYLES} ${prop} (${theme === 'dark' ? ':root' : "[data-theme='light']"})`, block[prop], theme);
    }
  }
  // Forward, the other way: a token pinned to a property that no longer is a plain colour.
  const fromApp = new Set(Object.keys(DARK).filter((p) => isPlainColour(DARK[p])).map(tokenNameFor));
  // mark-line-light is sampled from boards/public/clusters-logo-light.png (the dominant opaque
  // non-orange colour of its dashes), so no stylesheet holds it. section-* and glass* are pinned
  // by their own test below, from boardStyle.js and clusterSidebar.css.
  const knownElsewhere = (n) => /^(email-|studio-|section-|island-line$|glass(-solid)?$|mark-line-light$|night$|ink$|sun-shade$|sun-cream$|sunset-glow$)/.test(n);
  for (const tok of TOKENS.color.tokens) {
    assert.ok(fromApp.has(tok.name) || knownElsewhere(tok.name), `colour token "${tok.name}" has no pin: its custom property in ${STYLES} is gone or no longer a plain colour. ${FIX}`);
  }
});

test('pins: canon tokens equal their sources', () => {
  // night and ink are brand constants, the same in every theme; the light ground and ink are
  // bg-0's and ink-0's own light values, pinned with the rest of the Clusters colours.
  pin('night', `${STYLES} --bg-0`, DARK['--bg-0']);
  pin('ink', `${STYLES} --ink-0`, DARK['--ink-0']);
  pin('soleil', `${STYLES} --soleil`, DARK['--soleil']);
  pin('ink-on-soleil', `${STYLES} --on-soleil`, DARK['--on-soleil']);

  // The three-tone sun: the Clusters mark's own colours.
  const SUN = 'boards/src/lib/sunMark.js MARK_COLORS';
  const m = read('boards/src/lib/sunMark.js').match(/MARK_COLORS\s*=\s*\{([^}]*)\}/);
  assert.ok(m, `${SUN} not found`);
  const mark = Object.fromEntries([...m[1].matchAll(/(\w+)\s*:\s*'(#[0-9a-fA-F]{6})'/g)].map((x) => [x[1], x[2]]));
  pin('soleil', SUN + '.orange', mark.orange);
  pin('sun-shade', SUN + '.shadow', mark.shadow);
  pin('sun-cream', SUN + '.cream', mark.cream);

  // The studio's sun orb: script.js builds it with hslToHex(hue, saturation, lightness).
  const SCRIPT = 'script.js ColorPalette';
  const js = read('script.js');
  const num = (re) => {
    const x = js.match(re);
    assert.ok(x, `${SCRIPT}: ${re} not found. ${FIX}`);
    return Number(x[1]);
  };
  const [h, s, l] = [num(/this\.hue\s*=\s*(\d+(?:\.\d+)?)/), num(/this\.saturation\s*=\s*(\d+(?:\.\d+)?)/), num(/this\.lightness\s*=\s*(\d+(?:\.\d+)?)/)];
  const hslToHex = (hh, ss, ll) => {
    ll /= 100;
    const a = (ss * Math.min(ll, 1 - ll)) / 100;
    const f = (n) => {
      const k = (n + hh / 30) % 12;
      return Math.round(255 * (ll - a * Math.max(Math.min(k - 3, 9 - k, 1), -1))).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  };
  pin('sunset-glow', `${SCRIPT} (hslToHex(${h}, ${s}, ${l}))`, hslToHex(h, s, l));
});

test('pins: section colours and glass equal boardStyle.js and clusterSidebar.css', () => {
  // The eight named section colours are the data palette: their tones, in order.
  const FILE = 'boards/src/lib/boardStyle.js';
  const list = read(FILE).match(/SECTION_COLOURS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\.map/);
  assert.ok(list, `${FILE}: SECTION_COLOURS not found. ${FIX}`);
  const tones = [...list[1].matchAll(/name:\s*'(\w+)',\s*tone:\s*'(#[0-9a-fA-F]{6})'/g)];
  assert.equal(tones.length, 8, `${FILE}: SECTION_COLOURS parsed to ${tones.length} colours, not 8. ${FIX}`);
  for (const [, name, hex] of tones) pin('section-' + name, `${FILE} SECTION_COLOURS.${name}.tone`, hex);
  assert.deepEqual(
    TOKENS.color.tokens.filter((t) => t.name.startsWith('section-')).map((t) => t.name),
    tones.map((t) => 'section-' + t[1]),
    `section-* tokens are the names in ${FILE} SECTION_COLOURS, in its order. ${FIX}`,
  );

  // glass and glass-solid: --sbf-glass and --sbf-solid are color-mix(in oklab, <colour> P%, transparent),
  // which is that colour at alpha P%. Written out as the rgba they resolve to, in each theme.
  const SB = 'boards/src/components/sidebar/clusterSidebar.css';
  const sb = read(SB);
  const dk = propsOf(block(sb, '.app.sb-files, body[data-sb-files], .public-dark {'));
  const lt = propsOf(block(sb, "[data-theme='light'] .app.sb-files, [data-theme='light'] body[data-sb-files] {"));
  const toRgba = (def, theme, what) => {
    const m = def?.match(/^color-mix\(in oklab,\s*(var\(--bg-1\)|#[0-9a-f]{6})\s+(\d+)%,\s*transparent\)$/i);
    assert.ok(m, `${SB} ${what} (${theme}) is no longer color-mix(in oklab, <colour> P%, transparent): "${def}". ${FIX}`);
    const hex = m[1].startsWith('var') ? effective('--bg-1', theme) : m[1];
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return `rgba(${r},${g},${b},${Number(m[2]) / 100})`;
  };
  for (const [token, prop] of [['glass', '--sbf-glass'], ['glass-solid', '--sbf-solid']]) {
    pin(token, `${SB} ${prop}`, toRgba(dk[prop], 'dark', prop));
    pin(token, `${SB} ${prop}`, toRgba(lt[prop], 'light', prop), 'light');
  }
});

test('pins: email tokens equal the email theme T', { skip: !EMAIL_LOOK_SHIPPED && 'email look not on production yet' }, () => {
  const FILE = 'supabase/functions/_shared/email/theme.ts';
  const body = read(FILE).match(/export const T = \{([^}]*)\}/);
  assert.ok(body, `${FILE}: export const T not found`);
  const T = [...body[1].matchAll(/(\w+)\s*:\s*"(#[0-9a-fA-F]{6})"/g)];
  assert.ok(T.length >= 10, `${FILE}: T parsed to ${T.length} colours`);
  const kebab = (k) => k.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/([a-z])(\d)/g, '$1-$2').toLowerCase();
  const names = new Set();
  for (const [, key, hex] of T) {
    names.add('email-' + kebab(key));
    pin('email-' + kebab(key), `${FILE} T.${key}`, hex);
  }
  for (const tok of TOKENS.color.tokens.filter((t) => t.name.startsWith('email-'))) {
    assert.ok(names.has(tok.name), `token "${tok.name}" matches nothing in ${FILE} T. ${FIX}`);
    assert.equal(typeof tok.value, 'string', `${tok.name}: email is dark only`);
  }
});

test('pins: studio colours, glass, radii, shadows and type equal their sources', () => {
  const STUDIO = 'style.css';
  const sc = read(STUDIO);
  pin('studio-text', `${STUDIO} --light-color (hue from script.js)`, 'hsl(25, 95%, 98%)');
  assert.match(sc, /--light-color:\s*hsl\(var\(--hue\),\s*95%,\s*98%\)/, `${STUDIO} --light-color changed. ${FIX}`);
  assert.match(read('script.js'), /this\.hue\s*=\s*25\b/, 'script.js hue is no longer 25, so studio-text is stale. ' + FIX);
  const nav = sc.match(/background:\s*(rgba\(15,\s*12,\s*10,\s*0?\.35\))/);
  assert.ok(nav, `${STUDIO}: the bottom nav background changed from rgba(15, 12, 10, 0.35). ${FIX}`);
  pin('studio-nav', `${STUDIO} nav background`, nav[1]);
  const gb = sc.match(/--glass-border:\s*(rgba\([^)]*\))/);
  assert.ok(gb, `${STUDIO} --glass-border not found. ${FIX}`);
  pin('studio-glass-border', `${STUDIO} --glass-border`, gb[1]);

  // Clusters glass island (clusterSidebar.css), both themes.
  const SB = 'boards/src/components/sidebar/clusterSidebar.css';
  const sb = read(SB);
  const dk = propsOf(block(sb, '.app.sb-files, body[data-sb-files], .public-dark {'));
  const lt = propsOf(block(sb, "[data-theme='light'] .app.sb-files, [data-theme='light'] body[data-sb-files] {"));
  pin('island-line', `${SB} --sbf-glass-line`, dk['--sbf-glass-line']);
  pin('island-line', `${SB} --sbf-glass-line`, lt['--sbf-glass-line'], 'light');
  pin('island', `${SB} --sbf-glass-shadow`, dk['--sbf-glass-shadow']);
  pin('island', `${SB} --sbf-glass-shadow`, lt['--sbf-glass-shadow'], 'light');
  pin('island-chip', `${SB} --sbf-chip-shadow`, dk['--sbf-chip-shadow']);
  pin('island-chip', `${SB} --sbf-chip-shadow`, lt['--sbf-chip-shadow'], 'light');
  const menuDark = block(sb, '.sbf-upmenu {').match(/box-shadow:[^;]*,\s*(0 18px [^;,]*rgba\([^)]*\))\s*;/);
  const menuLight = sb.match(/\[data-theme='light'\] \.sbf-upmenu \{[^}]*,\s*(0 18px [^;,]*rgba\([^)]*\))\s*;/);
  assert.ok(menuDark && menuLight, `${SB} .sbf-upmenu shadow not found. ${FIX}`);
  pin('menu', `${SB} .sbf-upmenu`, menuDark[1]);
  pin('menu', `${SB} .sbf-upmenu`, menuLight[1], 'light');

  // Radii, spacing, shadows from the custom properties of styles.css.
  for (const f of ['radius', 'spacing']) {
    for (const tok of TOKENS[f].tokens) pin(tok.name, `${STYLES} --${tok.name}`, DARK['--' + tok.name]);
  }
  for (const n of ['shadow-1', 'shadow-2', 'shadow-3', 'shadow-glow']) {
    pin(n, `${STYLES} --${n}`, DARK['--' + n]);
    pin(n, `${STYLES} --${n}`, effective('--' + n, 'light'), 'light');
  }
  pin('soleil-glow', `${STYLES} --soleil-glow`, DARK['--soleil-glow']);

  // Type: .t-* classes.
  for (const g of TOKENS.type.groups) {
    for (const s of g.styles) {
      const rule = css.match(new RegExp(`^\\.t-${s.name}\\s*\\{([^}]*)\\}`, 'm'));
      assert.ok(rule, `type style "${s.name}" has no .t-${s.name} class in ${STYLES}. ${FIX}`);
      const decl = Object.fromEntries([...rule[1].matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
      const where = `${STYLES} .t-${s.name}`;
      assert.equal(norm(s.fontSize), norm(decl['font-size']), `type "${s.name}" fontSize differs from ${where}. ${FIX}`);
      assert.equal(norm(s.lineHeight), norm(decl['line-height']), `type "${s.name}" lineHeight differs from ${where}. ${FIX}`);
      assert.equal(String(s.fontWeight), decl['font-weight'], `type "${s.name}" fontWeight differs from ${where}. ${FIX}`);
      assert.equal(norm(s.letterSpacing ?? ''), norm(decl['letter-spacing'] ?? ''), `type "${s.name}" letterSpacing differs from ${where}. ${FIX}`);
      const fam = decl['font-family'].match(/var\(--font-(\w+)\)/)?.[1];
      assert.equal(g.family, fam, `type group "${g.name}" family differs from ${where}. ${FIX}`);
    }
  }
  const fam = TOKENS.type.families;
  assert.match(DARK['--font-sans'], /^aileron\b/i, `${STYLES} --font-sans no longer starts with aileron. ${FIX}`);
  assert.match(DARK['--font-display'], /^brandon-grotesque\b/i, `${STYLES} --font-display no longer starts with brandon-grotesque. ${FIX}`);
  assert.match(DARK['--font-mono'], /JetBrains Mono/, `${STYLES} --font-mono no longer starts with JetBrains Mono. ${FIX}`);
  assert.match(css, /font-family:\s*'Courier Prime'/, `${STYLES} no longer loads Courier Prime. ${FIX}`);
  assert.ok(fam.display.includes('brandon-grotesque') && fam.sans.includes('aileron') && fam.mono.includes('JetBrains Mono') && fam.script.includes('Courier Prime'));
});

// ---- c. hexes and d. paths in the guide pages -----------------------------

const BRAND_DIR = REPO + 'docs/brand/';
const pages = () => readdirSync(BRAND_DIR).filter((f) => f.endsWith('.md')).sort();
const HEX_IN_TEXT = /(?<![\w&#])#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w-])/g;
const expand = (h) => '#' + (h.length === 3 ? [...h].map((c) => c + c).join('') : h).toLowerCase();

test('hexes: every hex in docs/brand/*.md is a token value or recorded drift', () => {
  const allowed = new Set();
  for (const tok of TOKENS.color.tokens) {
    for (const theme of themesOf) {
      const v = resolveColour(tok, theme);
      if (v.startsWith('#')) allowed.add(v.toLowerCase());
    }
  }
  const driftPath = BRAND_DIR + 'drift.md';
  const drift = new Set(existsSync(driftPath) ? [...readFileSync(driftPath, 'utf8').matchAll(HEX_IN_TEXT)].map((m) => expand(m[1])) : []);
  const bad = [];
  for (const page of pages()) {
    if (page === 'drift.md') continue;
    const text = readFileSync(BRAND_DIR + page, 'utf8');
    for (const m of text.matchAll(HEX_IN_TEXT)) {
      const hex = expand(m[1]);
      if (!allowed.has(hex) && !drift.has(hex)) bad.push(`docs/brand/${page}: ${m[0]}`);
    }
  }
  assert.deepEqual(bad, [], `hex values that are neither a colour token nor in docs/brand/drift.md (${FIX}):\n${bad.join('\n')}`);
});

const DOMAIN_FIRST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|org|net|io|dev|app|ai|co)$/i;
function looksLikeRepoPath(s) {
  if (/\s/.test(s) || !s.includes('/')) return false;
  if (/:\/\//.test(s) || /[<>{}*]/.test(s)) return false;
  if (s.startsWith('--') || s.startsWith('#')) return false;
  if (DOMAIN_FIRST.test(s.split('/')[0])) return false;
  return true;
}

test('paths: every repo path in docs/brand/*.md exists', () => {
  const missing = [];
  for (const page of pages()) {
    const text = readFileSync(BRAND_DIR + page, 'utf8');
    for (const m of text.matchAll(/`([^`\n]+)`/g)) {
      const s = m[1];
      if (!looksLikeRepoPath(s)) continue;
      if (!EMAIL_LOOK_SHIPPED && EMAIL_LOOK_FILES.includes(s)) continue;
      if (!existsSync(REPO + s)) missing.push(`docs/brand/${page}: ${s}`);
    }
  }
  assert.deepEqual(missing, [], `paths that do not exist relative to the repo root:\n${missing.join('\n')}`);
});
