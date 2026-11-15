// Pseudo-locale for development: open the app with ?lang=pseudo and every
// message shows accented and bracketed, so text that skipped translation and a
// layout that can't take longer words both stand out. Pure; lib/i18nBoot.js
// installs it behind import.meta.env.DEV, so no production bundle has it.
const MAP = {
  a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', c: 'ç', n: 'ñ',
  A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', C: 'Ç', N: 'Ñ',
};

// Letters accented; <0>, </0>, <1/> and # left alone.
function pseudoText(s) {
  return s.split(/(<[^>]*>|#)/).map((part, i) => (i % 2 ? part : part.replace(/[a-zA-Z]/g, (c) => MAP[c] || c))).join('');
}

function pseudoPart(part) {
  if (typeof part === 'string') return pseudoText(part);
  if (!Array.isArray(part)) return part;
  const [name, type, options, ...rest] = part;
  if (!options || typeof options !== 'object' || Array.isArray(options)) return part;
  const out = {};
  for (const [k, v] of Object.entries(options)) {
    out[k] = Array.isArray(v) ? v.map(pseudoPart) : typeof v === 'string' ? pseudoText(v) : v;
  }
  return [name, type, out, ...rest];
}

export function pseudoMessage(compiled) {
  const parts = typeof compiled === 'string' ? [compiled] : compiled;
  return ['⟦', ...parts.map(pseudoPart), '⟧'];
}

export function installPseudo(i18n) {
  const orig = Object.getPrototypeOf(i18n)._;
  const call = (id, values, options) => {
    if (id && typeof id === 'object') return orig.call(i18n, { ...id, message: pseudoMessage(id.message) }, values, options);
    if (options?.message) return orig.call(i18n, id, values, { ...options, message: pseudoMessage(options.message) });
    return orig.call(i18n, id, values, options);
  };
  i18n._ = call;
  i18n.t = call;
}
