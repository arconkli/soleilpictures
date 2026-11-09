// Picture search from any language. Picture descriptions (entity_search.seen)
// are English, so a query in another language is translated to English by the
// Worker (POST /api/search/translate, Workers AI m2m100) and the English words
// are matched against the descriptions (searchPicturesByWords).
//
// Nothing here touches navigator or the DOM at import time. The Worker imports
// M2M100_LANGS from this file, so tagsClient (which pulls in the browser
// Supabase client) is loaded only when a query is translated.

import { minSearchLength, searchLength } from './textFold.js';

// m2m100's language codes, without 'en' (nothing to translate).
export const M2M100_LANGS = new Set((
  'af am ar ast az ba be bg bn br bs ca ceb cs cy da de el es et fa ff fi fr fy ga gd gl gu ha he hi hr ht hu hy id ig ilo ' +
  'is it ja jv ka kk km kn ko lb lg ln lo lt lv mg mk ml mn mr ms my ne nl no ns oc or pa pl ps pt ro ru sd si sk sl so sq ' +
  'sr ss su sv sw ta th tl tn tr uk ur uz vi wo xh yi yo zh zu'
).split(' '));

const LEGACY = { iw: 'he', in: 'id', nb: 'no', nn: 'no', fil: 'tl' };

const baseCodes = (languages) => (languages || [])
  .map((tag) => String(tag || '').split('-')[0].toLowerCase())
  .filter(Boolean)
  .map((c) => LEGACY[c] || c);

const SCRIPT = (name) => new RegExp(`\\p{Script=${name}}`, 'u');
const HANGUL = SCRIPT('Hangul');
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HAN = SCRIPT('Han');
const CYRILLIC = SCRIPT('Cyrillic');
const ARABIC = SCRIPT('Arabic');
const LATIN = SCRIPT('Latin');
// Scripts that map to one language each.
const ONE = [
  ['Hebrew', 'he'], ['Thai', 'th'], ['Greek', 'el'], ['Bengali', 'bn'], ['Gujarati', 'gu'], ['Gurmukhi', 'pa'],
  ['Tamil', 'ta'], ['Kannada', 'kn'], ['Malayalam', 'ml'], ['Sinhala', 'si'], ['Khmer', 'km'], ['Lao', 'lo'],
  ['Myanmar', 'my'], ['Georgian', 'ka'], ['Armenian', 'hy'], ['Ethiopic', 'am'],
].map(([s, c]) => [SCRIPT(s), c]);
const DEVANAGARI = SCRIPT('Devanagari');

// The language a query is written in, as an m2m100 code, or null when it needs
// no translation (English, or a Latin-script query from someone whose first
// language is English) or cannot be told.
export function queryLanguage(q, languages = globalThis.navigator?.languages || []) {
  const s = String(q || '');
  if (!s) return null;
  // Not every keystroke: a query below the search minimum is not searched yet,
  // and a Latin one needs three letters before it is worth a model call.
  if (searchLength(s) < minSearchLength(s)) return null;
  const mine = baseCodes(languages);
  if (HANGUL.test(s)) return 'ko';
  if (KANA.test(s)) return 'ja';
  if (HAN.test(s)) {
    const ja = mine.indexOf('ja');
    const zh = mine.indexOf('zh');
    return ja !== -1 && (zh === -1 || ja < zh) ? 'ja' : 'zh';
  }
  if (CYRILLIC.test(s)) return mine.find((c) => ['uk', 'bg', 'sr', 'mk', 'be', 'kk'].includes(c)) || 'ru';
  if (ARABIC.test(s)) return mine.find((c) => c === 'fa' || c === 'ur') || 'ar';
  for (const [re, code] of ONE) if (re.test(s)) return code;
  if (DEVANAGARI.test(s)) return mine.find((c) => c === 'mr' || c === 'ne') || 'hi';
  if (LATIN.test(s)) {
    if (searchLength(s) < 3) return null;
    const first = mine[0];
    return first && first !== 'en' && M2M100_LANGS.has(first) ? first : null;
  }
  return null;
}

const STOP = new Set((
  'a an the of with in on at to for and or my your his her its who which that he she it they their our we i you me him them by from as is are was be'
).split(' '));

// The words of an English description of a picture worth matching: lower
// case, letters and digits only, no stop words, at most the first 6.
export function pictureWords(english) {
  const words = String(english || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP.has(w));
  return [...new Set(words)].slice(0, 6);
}

// Postgres regex for one word as a whole word, with a plural: car and cars
// match, scar and card do not.
export function pictureWordPattern(word) {
  if (!/^[a-z0-9]+$/.test(String(word))) return null;
  return '[[:<:]]' + word + '(s|es)?[[:>:]]';
}

const _cache = new Map();
const CACHE_MAX = 100;

// The English for a query, or null. Only an answer is kept: a failure (no
// session yet, a slow model, the fetch helper's cooldown after a 5xx or a
// spent budget) is asked again next time. tagsClient is loaded here, not at
// the top, so the Worker, which imports M2M100_LANGS from this file, never
// pulls in the browser's Supabase client.
export async function translateQuery(q, lang, { workspaceId } = {}) {
  const key = lang + '\u0000' + q;
  if (_cache.has(key)) return _cache.get(key);
  const { authedFetch } = await import('./tagsClient.js');
  const res = await authedFetch('/api/search/translate', { q, source_lang: lang, workspace_id: workspaceId });
  const english = typeof res?.english === 'string' && res.english.trim() ? res.english : null;
  if (!english) return null;
  if (_cache.size >= CACHE_MAX) _cache.delete(_cache.keys().next().value);
  _cache.set(key, english);
  return english;
}
