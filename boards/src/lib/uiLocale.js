// The language the interface is drawn in, and the two pure rules that decide
// it. No imports: this runs in the browser, in node's tests and in
// vite.config.js, which serialises pickLocale and englishOnlyPath into
// index.html (appPreloadList.mjs) so the catalog is fetched while the page
// parses.

export const LOCALES = ['en', 'es', 'fr', 'pt-BR', 'ru', 'ja', 'ko'];

let current = 'en';
export function uiLocale() { return current; }
export function setUiLocale(l) { current = l || 'en'; }

// The locale the boot resolved for this page (lib/i18nBoot.js), whether or not
// its catalog arrived in time; null where the boot didn't choose (the
// English-only public pages, the dev ?lang= overrides). lib/accountLocale.js
// compares the account's language with it.
let booted = null;
export function bootLocale() { return booted; }
export function setBootLocale(l) { booted = l || null; }

// The locale for the person's choice (Settings' language; 'auto' or nothing
// means follow the browser), else the first of `languages` we have, else
// 'en'. A regional tag finds its language (es-MX → es), and any Portuguese
// finds pt-BR. Serialised with toString(): keep it self-contained ES5 with no
// comments inside.
export function pickLocale(choice, languages, locales) {
  function match(tag) {
    if (typeof tag !== 'string' || !tag) return null;
    tag = tag.replace(/_/g, '-');
    var lower = tag.toLowerCase();
    for (var i = 0; i < locales.length; i++) {
      if (locales[i].toLowerCase() === lower) return locales[i];
    }
    var lang = lower.split('-')[0];
    if (lang === 'pt' && locales.indexOf('pt-BR') >= 0) return 'pt-BR';
    for (var j = 0; j < locales.length; j++) {
      if (locales[j].toLowerCase() === lang) return locales[j];
    }
    return null;
  }
  var first = match(choice);
  if (first) return first;
  for (var k = 0; k < languages.length; k++) {
    var m = match(languages[k]);
    if (m) return m;
  }
  return 'en';
}

// True for the public site, which stays English: the pages a signed-out
// visitor or a crawler reaches. The same paths as the route matchers in
// main.jsx. Serialised with toString(): ES5, no comments inside.
export function englishOnlyPath(pathname, signedIn) {
  var p = (pathname || '/').toLowerCase().replace(/\/+$/, '') || '/';
  if (/^\/legal(\/|$)/.test(p) || p === '/scout') return true;
  if (/^\/(tools|vs|best)(\/|$)/.test(p)) return true;
  if (/^\/(use-cases|templates|docs)(\/|$)/.test(p)) return true;
  if (p === '/changelog' || p === '/pricing/talk-to-us' || p === '/explore') return true;
  if (/^\/c\/./.test(p)) return true;
  if (p === '/pricing' && !signedIn) return true;
  return false;
}

// Settings' language, cached in soleil.ui beside the theme; 'auto' or nothing
// means follow the browser.
export function readLocaleChoice() {
  try {
    const lang = JSON.parse(localStorage.getItem('soleil.ui') || '{}')?.lang;
    return typeof lang === 'string' ? lang : null;
  } catch (_) { return null; }
}

// The language a new account starts in (lib/accountLocale.js): the person's
// choice, else their browser's. Sent as signInWithOtp's data.locale, so the
// sign-in code email is already in it. Never throws.
export function signupLocale() {
  try {
    return pickLocale(readLocaleChoice(), navigator.languages || [navigator.language], LOCALES);
  } catch (_) { return 'en'; }
}
