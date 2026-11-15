// The person's language beyond this page: on this device, and on the account.
//
// This device: soleil.ui → lang, which the boot reads before the first paint
// (lib/i18nBoot.js). App.jsx mirrors the account's settings there, and
// followAccountLocale() reloads once when this page was drawn in a language
// the account no longer has: a new device, a change made on another one, or
// one made in Settings just now. Save, then reload, because text drawn outside
// React's reach would otherwise stay in the old language.
//
// The account: the auth user's metadata, user_metadata.locale. Supabase's own
// emails read it as {{ .Data.locale }}, and ours read it too. It is written at
// sign-up (AuthGate's signInWithOtp data) and by syncAccountLocale() when it
// changes. Missing means English, so English speakers are never written to.
import { LOCALES, bootLocale } from './uiLocale.js';
import { resolveLocale, readLocaleChoice } from './i18n.js';

const RELOADED = 'soleil.langReload';

function browserLanguages() {
  try {
    if (navigator.languages && navigator.languages.length) return navigator.languages;
    return navigator.language ? [navigator.language] : [];
  } catch (_) { return []; }
}

// What a choice (null for Automatic, or a locale) comes to in this browser.
export function effectiveLocale(choice, languages = browserLanguages()) {
  return resolveLocale(choice, languages);
}

// The locale to reload into, or null: only when the page was drawn in another
// language than `want`, and this tab hasn't already reloaded for `want`
// (`last`), which is what stops a loop if the boot can't read the choice.
export function reloadTarget({ booted, want, last }) {
  if (!booted || !want || want === booted || want === last) return null;
  return want;
}

// The metadata patch that records `want` on the account, or null when the
// account already says so.
export function accountLocalePatch(user, want) {
  if (!user || !want) return null;
  const have = user.user_metadata && user.user_metadata.locale;
  if ((LOCALES.includes(have) ? have : 'en') === want) return null;
  return { locale: want };
}

// Keeps `choice` on this device and reloads into it when this page is in
// another language. Never throws.
export function followAccountLocale(choice) {
  const lang = LOCALES.includes(choice) ? choice : null;
  try {
    const ui = JSON.parse(localStorage.getItem('soleil.ui') || '{}') || {};
    if ((ui.lang ?? null) !== lang) localStorage.setItem('soleil.ui', JSON.stringify({ ...ui, lang }));
  } catch (_) { /* the read-back below then finds what the boot found */ }
  // Read back rather than trust `choice`: reload only into what the next boot will read.
  const want = effectiveLocale(readLocaleChoice());
  let last = null;
  try { last = sessionStorage.getItem(RELOADED); } catch (_) { return; }
  const target = reloadTarget({ booted: bootLocale(), want, last });
  if (!target) return;
  try { sessionStorage.setItem(RELOADED, target); } catch (_) { return; }
  window.location.reload();
}

// Records the language on the account when it changed. `auth` is
// supabase.auth. Never throws; a failed write is tried again on the next load.
export async function syncAccountLocale(auth, choice) {
  try {
    const lang = LOCALES.includes(choice) ? choice : null;
    const { data } = await auth.getSession();
    const patch = accountLocalePatch(data && data.session && data.session.user, effectiveLocale(lang));
    if (patch) await auth.updateUser({ data: patch });
  } catch (_) { /* next load */ }
}
