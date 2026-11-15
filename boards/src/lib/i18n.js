// The interface's translation state. main.jsx imports this first, so English
// is active before any other module runs; a language's catalog replaces it
// later (lib/i18nBoot.js). English is in the code itself (see
// scripts/linguiCompiledMessages.mjs), so it needs no catalog.
import { i18n } from '@lingui/core';
import { LOCALES, pickLocale, setUiLocale } from './uiLocale.js';

if (!i18n.locale) i18n.loadAndActivate({ locale: 'en', messages: {} });
i18n.on('change', () => setUiLocale(i18n.locale || 'en'));
setUiLocale(i18n.locale);

export { i18n, LOCALES };

// Each language in its own name: a person who can't read the current one
// still finds theirs.
export const LOCALE_NAMES = {
  en: 'English', es: 'Español', fr: 'Français', 'pt-BR': 'Português (Brasil)',
  ru: 'Русский', ja: '日本語', ko: '한국어',
};

export function resolveLocale(choice, languages) {
  return pickLocale(choice, languages || [], LOCALES);
}

// Lives in uiLocale.js (no imports there); re-exported for its importers.
export { readLocaleChoice } from './uiLocale.js';

export function activateCatalog(locale, messages) {
  i18n.loadAndActivate({ locale, messages });
}
