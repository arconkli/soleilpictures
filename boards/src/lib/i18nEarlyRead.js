// Development check for a message read before the language is chosen. A page's
// language is fixed at boot (lib/i18nBoot.js startLocale, awaited in main.jsx),
// but module-scope code runs before that, so a message read there (a getter
// like `get label() { return t`Light`; }` read while a module-scope table is
// built) stays English for good. Until markLocaleDecided() is called, each
// read logs once per message. Pure; lib/i18nBoot.js installs it behind
// import.meta.env.DEV, so no production bundle has it.
//
// It installs first (i18nBoot is main.jsx's first module after lib/i18n.js).
// ?lang=pseudo's installPseudo later replaces _ and t outright, which ends the
// check; that is after module scope, and main.jsx marks the locale decided at
// once when there is nothing to wait for.

// A compiled message as the English it was written as: placeholders as {name}.
function englishOf(message) {
  const parts = typeof message === 'string' ? [message] : Array.isArray(message) ? message : [];
  return parts.map((p) => (typeof p === 'string' ? p : Array.isArray(p) ? `{${p[0]}}` : '')).join('');
}

function describe(id, options) {
  if (id && typeof id === 'object') return englishOf(id.message) || String(id.id ?? '');
  return englishOf(options?.message) || String(id);
}

export function installEarlyRead(i18n, report = console.error) {
  let decided = false;
  const seen = new Set();
  const wrap = (orig) => (id, values, options) => {
    if (!decided) {
      const english = describe(id, options);
      if (!seen.has(english)) {
        seen.add(english);
        report(`[i18n] read before the language was chosen: "${english}". Read it inside a function or a getter that runs later.`);
      }
    }
    return orig.call(i18n, id, values, options);
  };
  i18n._ = wrap(i18n._);
  i18n.t = wrap(i18n.t);
  return { markLocaleDecided() { decided = true; } };
}
