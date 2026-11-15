// Picks the interface language at boot and loads its catalog. Vite-only (it
// uses import.meta.glob); node's tests use lib/i18n.js and activateCatalog.
//
// English is in the code, so it needs nothing and startLocale returns null.
// Another language returns a promise main.jsx waits on before it draws, so a
// first paint is never half one language and half another. It always
// resolves, and within deadlineMs: a catalog that is slow or fails leaves this
// page load in English, and one that arrives after the deadline is ignored.
import { i18n, activateCatalog, readLocaleChoice, resolveLocale } from './i18n.js';
import { installPseudo } from './i18nPseudo.js';
import { installEarlyRead } from './i18nEarlyRead.js';
import { setBootLocale } from './uiLocale.js';

// One lazy chunk per language, fetched only for the language chosen. English
// has no catalog: its messages are the code's own.
const CATALOGS = import.meta.glob(['../locales/*/messages.mjs', '!../locales/en/messages.mjs']);

async function loadCatalog(locale) {
  const load = CATALOGS[`../locales/${locale}/messages.mjs`];
  if (!load) throw new Error(`no catalog for ${locale}`);
  return (await load()).messages;
}

// Dev only: log a message read before the language is chosen (module-scope
// reads stay English for good). Installed here, so it is in place before any
// module main.jsx imports after this one runs.
const earlyRead = import.meta.env.DEV ? installEarlyRead(i18n) : null;

// main.jsx calls this when the language is settled, just before it draws.
export function markLocaleDecided() { earlyRead?.markLocaleDecided(); }

export function startLocale({ deadlineMs = 3000 } = {}) {
  let choice = readLocaleChoice();
  let override = false;
  if (import.meta.env.DEV) {
    const q = new URLSearchParams(location.search).get('lang');
    if (q === 'pseudo') { installPseudo(i18n); return null; }
    if (q) { choice = q; override = true; }
  }
  const locale = resolveLocale(choice, navigator.languages || [navigator.language]);
  setBootLocale(override ? null : locale);
  if (locale === 'en') return null;
  return new Promise((resolve) => {
    let late = false;
    const timer = setTimeout(() => { late = true; resolve(); }, deadlineMs);
    loadCatalog(locale).then((messages) => {
      if (late) return;
      clearTimeout(timer);
      activateCatalog(locale, messages);
      document.documentElement.lang = locale;
      resolve();
    }, () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
