// The checks a translation must pass (rules: src/locales/GLOSSARY.md), as two
// pure functions with no file I/O. scripts/i18nTranslate.mjs runs them on every
// translation it is handed and before it writes one into a catalog;
// src/lib/i18nCatalogs.test.mjs runs them on every translation in the catalogs.
//
//   normalizeTranslation(english, translation, locale)  -> the text to store
//   lintTranslation(english, translation, locale)       -> { errors, warnings }
//                                                          (lints the normalized text)
//
// ICU is read with what Lingui compiles with (@lingui/message-utils), so a
// message that passes here compiles at runtime; plural categories come from
// Intl.PluralRules. An error refuses the message; a warning is only shown.
import { compileMessageOrThrow } from '@lingui/message-utils/compileMessage';

const NBSP = ' ';
const NNBSP = ' ';

const lang = (locale) => String(locale).split(/[-_]/)[0].toLowerCase();

// ---- ICU helpers ----------------------------------------------------------

// The {names} and <n> tags a compiled message uses, as strings. (Moved here
// from i18nCatalogs.test.mjs.)
export function shape(compiled) {
  const parts = typeof compiled === 'string' ? [compiled] : compiled;
  const out = [];
  for (const part of parts) {
    if (typeof part === 'string') {
      for (const tag of part.matchAll(/<\/?\d+\/?>/g)) out.push(tag[0]);
    } else if (Array.isArray(part)) {
      out.push(`{${part[0]}}`);
      const opts = part[2];
      if (opts && typeof opts === 'object') {
        for (const v of Object.values(opts)) if (Array.isArray(v)) out.push(...shape(v));
      }
    }
  }
  return out;
}
const unique = (a) => [...new Set(a)].sort();

// Every plural / selectordinal / select in a compiled message, at any depth:
// { arg, type, keys }. (compileMessage drops the "=" of an exact key: =0 is "0".)
function selectors(compiled, out = []) {
  for (const part of compiled) {
    if (!Array.isArray(part)) continue;
    const [arg, type, opts] = part;
    if ((type === 'plural' || type === 'select' || type === 'selectordinal') && opts && typeof opts === 'object') {
      out.push({ arg, type, keys: Object.keys(opts).filter((k) => k !== 'offset') });
      for (const [k, v] of Object.entries(opts)) if (k !== 'offset' && Array.isArray(v)) selectors(v, out);
    }
  }
  return out;
}

const languageName = (locale) => {
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(locale) || locale; } catch { return locale; }
};

function pluralCategories(locale, type) {
  const order = ['zero', 'one', 'two', 'few', 'many', 'other'];
  return new Intl.PluralRules(locale, { type: type === 'selectordinal' ? 'ordinal' : 'cardinal' }).resolvedOptions().pluralCategories
    .slice().sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

// ---- normalize ------------------------------------------------------------

const URL_RE = /https?:\/\/[^\s<>"{}]+/g;
const DOMAIN_RE = /(?<![A-Za-z0-9@.-])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|app|dev|co|ai|me|tv|ly|so|xyz|gg|fm)\b(?:\/[^\s<>"{}]*)?/g;
// A simple {argument}: the ICU syntax a French space must never enter.
const ARG_RE = /\{\s*[\w.$-]+\s*(?:,\s*(?:number|date|time)\s*(?:,[^{}]*)?)?\}/g;

function protectedRanges(text) {
  const ranges = [];
  for (const re of [URL_RE, DOMAIN_RE, ARG_RE]) {
    for (const m of text.matchAll(re)) ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges.sort((a, b) => a[0] - b[0]);
}

const isSpace = (c) => c === ' ' || c === NBSP || c === NNBSP || c === '\n' || c === '\t';

function frenchSpaces(text) {
  const ranges = protectedRanges(text);
  let out = '';
  let r = 0;
  for (let i = 0; i < text.length;) {
    while (r < ranges.length && ranges[r][1] <= i) r++;
    if (r < ranges.length && ranges[r][0] <= i) {
      const end = ranges[r][1];
      out += text.slice(i, end);
      i = end;
      continue;
    }
    const ch = text[i];
    if (';:?!»'.includes(ch)) {
      const next = text[i + 1];
      const last = out[out.length - 1];
      const digits = ch === ':' && /\d/.test(last || '') && /\d/.test(next || '');
      // A colon with no space after it joins a token (m:ss, {m}:{ss}, a bare https://); it ends no clause.
      const joined = ch === ':' && /[\p{L}\p{N}/{\\]/u.test(next || '');
      // French puts no space after an opening bracket: (?) stays (?), and ( ?) becomes (?).
      const opened = /[([][   ]*$/.test(out);
      if (ch === ':' && (last === ':' || next === ':' || digits || joined)) {
        out += ch;
      } else if (opened) {
        out = out.replace(/[   ]+$/, '') + ch;
      } else if (last === ' ' || last === NNBSP) {
        out = out.replace(/[  ]+$/, '') + NBSP + ch;
      } else if (last !== undefined && !isSpace(last) && !(ch !== '»' && ';:?!'.includes(last))) {
        out += NBSP + ch;
      } else {
        out += ch;
      }
      i++;
    } else if (ch === '«') {
      out += ch;
      i++;
      if (text[i] === ' ' || text[i] === NNBSP) {
        while (text[i] === ' ' || text[i] === NNBSP) i++;
        out += NBSP;
      } else if (i < text.length && !isSpace(text[i])) {
        out += NBSP;
      }
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

export function normalizeTranslation(english, translation, locale) {
  const en = String(english ?? '');
  const lead = en.match(/^\s*/)[0];
  const trail = en.slice(lead.length).match(/\s*$/)[0];
  let core = String(translation ?? '').trim();
  if (!core) return core;
  core = core.replace(/\.{3}/g, '…');
  core = core.replace(/(?<=\p{L})'(?=\p{L})/gu, '’');
  if (lang(locale) === 'fr') core = frenchSpaces(core);
  return lead + core + trail;
}

// ---- kept as written ------------------------------------------------------

const asciiWord = (w) => ({ text: w, re: new RegExp(`(?<![A-Za-z0-9])${w}(?![A-Za-z0-9])`, 'g') });
const KEPT_WORDS = ['Soleil Clusters', 'Soleil', 'Creator', 'Ctrl', 'Esc'].map(asciiWord);
const KEPT_SYMBOLS = ['⌘', '⌥', '⇧', '⌃'];
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const trimUrl = (s) => s.replace(/[.,;:!?)»”’…]+$/, '');

const countOf = (text, item) => {
  if (item.re) return (text.match(item.re) || []).length;
  return text.split(item.text).length - 1;
};

function keptItems(english) {
  const items = [...KEPT_WORDS, ...KEPT_SYMBOLS.map((s) => ({ text: s }))];
  const found = new Set();
  for (const m of english.matchAll(URL_RE)) found.add(trimUrl(m[0]));
  for (const m of english.matchAll(DOMAIN_RE)) found.add(trimUrl(m[0]));
  for (const m of english.matchAll(EMAIL_RE)) found.add(m[0]);
  for (const text of found) items.push({ text });
  return items;
}

// ---- warnings' measures ---------------------------------------------------

// The text with each {argument} (a plural counts for its whole span) replaced by `fill`, tags removed.
function flatten(text, fill) {
  let s = text.replace(/<\/?\d+\/?>/g, '').replace(/\*\*/g, '');
  let prev;
  do { prev = s; s = s.replace(/\{[^{}]*\}/g, fill); } while (s !== prev);
  return s;
}

const wide = (cp) => (cp >= 0x1100 && cp <= 0x115F) || (cp >= 0x2E80 && cp <= 0xA4CF) || (cp >= 0xAC00 && cp <= 0xD7A3)
  || (cp >= 0xF900 && cp <= 0xFAFF) || (cp >= 0xFE30 && cp <= 0xFE6F) || (cp >= 0xFF00 && cp <= 0xFF60) || (cp >= 0xFFE0 && cp <= 0xFFE6);
const width = (s) => { let w = 0; for (const ch of s) w += wide(ch.codePointAt(0)) ? 2 : 1; return w; };

const QUOTES = {
  fr: { bad: '“”', use: '« »' },
  ru: { bad: '“”', use: '« »' },
  ja: { bad: '“”«»', use: '「」' },
  es: { bad: '«»「」', use: '“ ”' },
  pt: { bad: '«»「」', use: '“ ”' },
  ko: { bad: '«»「」', use: '“ ”' },
};

// ---- lint -----------------------------------------------------------------

const list = (a) => a.join(', ');

export function lintTranslation(english, translation, locale) {
  const errors = [];
  const warnings = [];
  const en = String(english ?? '');
  const tr = normalizeTranslation(en, translation, locale);

  if (!tr.trim()) { errors.push('empty translation'); return { errors, warnings }; }

  let enTree;
  let trTree;
  try { enTree = compileMessageOrThrow(en); } catch (e) { errors.push(`the English does not compile: ${String(e.message).split('\n')[0]}`); }
  try { trTree = compileMessageOrThrow(tr); } catch (e) {
    errors.push(`does not compile: ${String(e.message).split('\n')[0]} (check the braces and commas)`);
  }

  const enSel = enTree ? selectors(enTree) : [];
  if (enTree && trTree) {
    // 2. placeholders and tags
    const want = unique(shape(enTree));
    const got = unique(shape(trTree));
    const missing = want.filter((x) => !got.includes(x));
    const extra = got.filter((x) => !want.includes(x));
    if (missing.length || extra.length) {
      errors.push(`placeholders and tags must match the English${missing.length ? `; missing ${list(missing)}` : ''}${extra.length ? `; not in the English: ${list(extra)}` : ''}`);
    }

    // 4. plural, selectordinal and select
    const trSel = selectors(trTree);
    for (const e of enSel) {
      if (!trSel.some((t) => t.arg === e.arg && t.type === e.type)) {
        const other = trSel.find((t) => t.arg === e.arg);
        errors.push(other
          ? `{${e.arg}} is a ${e.type} in the English but a ${other.type} here: make it a ${e.type}`
          : `${e.type} {${e.arg}} is missing: keep the English's ${e.type}`);
      }
    }
    for (const t of trSel) {
      if (t.type === 'select') {
        const e = enSel.find((x) => x.arg === t.arg && x.type === 'select');
        if (!e) { if (!enSel.some((x) => x.arg === t.arg)) errors.push(`select {${t.arg}} is not in the English: remove it`); continue; }
        const missing = e.keys.filter((k) => !t.keys.includes(k));
        const extra = t.keys.filter((k) => !e.keys.includes(k));
        if (missing.length || extra.length) {
          errors.push(`select {${t.arg}}: keys must be exactly ${list(e.keys)}${missing.length ? ` (missing: ${list(missing)})` : ''}${extra.length ? ` (not allowed: ${list(extra)})` : ''}`);
        }
      } else {
        const cats = pluralCategories(locale, t.type);
        const exact = (k) => /^\d+$/.test(k);
        const isFew = cats.includes('few');
        const optional = new Set(!isFew && cats.includes('one') && cats.includes('other') ? ['many'] : []);
        const needed = cats.filter((c) => !optional.has(c));
        const have = t.keys.filter((k) => !exact(k));
        const name = languageName(locale);
        const lacking = needed.filter((c) => !have.includes(c));
        const notAllowed = have.filter((c) => !cats.includes(c));
        const enNode = enSel.find((x) => x.arg === t.arg && x.type === t.type);
        const lackingExact = (enNode ? enNode.keys.filter(exact) : []).filter((k) => !t.keys.includes(k));
        if (lacking.length || notAllowed.length) {
          errors.push(`${t.type === 'plural' ? 'plural' : 'selectordinal'} {${t.arg}}: ${name} needs ${list(needed)}${optional.size ? ` (${list([...optional])} optional)` : ''}${lacking.length ? ` (missing: ${list(lacking)})` : ''}${notAllowed.length ? ` (${name} has no ${list(notAllowed)}: remove ${notAllowed.length > 1 ? 'them' : 'it'})` : ''}`);
        }
        if (lackingExact.length) errors.push(`plural {${t.arg}}: keep the English's exact ${list(lackingExact.map((k) => `=${k}`))}`);
      }
    }
  }

  // 3. the quote trap
  for (let i = 0; i < tr.length; i++) {
    if (tr[i] === "'" && (tr[i + 1] === '{' || tr[i + 1] === '<') && tr[i - 1] !== "'" && tr[i + 1] !== "'") {
      const token = tr.slice(i + 1).match(/^(?:\{[^{}]*\}?|<\/?\d*\/?>?)/)[0] || tr[i + 1];
      errors.push(`a straight ' before ${token} hides it: write ’`);
    }
  }

  // A plural has a different number of branches in each language (Russian has
  // four), and what a branch holds is repeated in each, so in a message with a
  // plural the counts below can differ: they must still be present or absent
  // together (and ** still in pairs).
  const scaled = enSel.length > 0;

  // 5. bold markers
  const stars = (s) => s.split('**').length - 1;
  if (scaled
    ? (stars(en) === 0) !== (stars(tr) === 0) || stars(tr) % 2 !== 0
    : stars(en) !== stars(tr)) errors.push(`** appears ${stars(tr)} times, the English has ${stars(en)}: bold markers come in pairs`);

  // 6. kept as written
  for (const item of keptItems(en)) {
    const a = countOf(en, item);
    const b = countOf(tr, item);
    if (scaled ? (a === 0) !== (b === 0) : a !== b) errors.push(`"${item.text}" must stay as written, ${a} time${a === 1 ? '' : 's'} as in the English (found ${b})`);
  }

  // 7. quote marks
  const q = QUOTES[lang(locale)];
  if (q) {
    const used = [...q.bad].filter((c) => tr.includes(c));
    if (used.length) errors.push(`do not use ${used.join(' ')} in ${languageName(locale)}: use ${q.use}`);
  }

  // Warnings
  const plain = flatten(en, '');
  const words = plain.match(/\p{L}+/gu) || [];
  if (tr === en && words.length >= 2) warnings.push('identical to the English: translate it, or leave it if it is a name or code');

  const enWidth = width(flatten(en, 'xxxx'));
  if (enWidth <= 24) {
    const trWidth = width(flatten(tr, 'xxxx').replace(/\*\*/g, ''));
    if (trWidth > 1.5 * enWidth + 4) warnings.push(`long label: ${trWidth} wide against ${enWidth} in the English: shorten it`);
  }

  const lines = (s) => s.split('\n').length - 1;
  if (lines(en) !== lines(tr)) warnings.push(`${lines(tr)} line breaks, the English has ${lines(en)}`);

  if (lang(locale) === 'ja' && /[぀-ヿ㐀-鿿][.,]/.test(tr)) warnings.push('ja: use 。 and 、 after Japanese text, not . and ,');

  return { errors, warnings };
}
