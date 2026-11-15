// The words of every email, by language. Plain ESM (no TypeScript) so Deno
// (the edge functions) and node (the tests, scripts/gen-magic-link.mjs) both
// import it. The tables are in strings/: en.mjs holds the English every email
// is written from, and each other table holds only the keys that have been
// translated. A key a table lacks reads as the English, so a language that is
// half translated sends a half English email rather than a broken one.
//
// Call keys only as literal strings (s.t("workspace_invite.subject", {...}),
// s.n("added.image", count)), never built from parts: emailStrings.test.mjs
// finds every key in the code by reading it.

import en from "./strings/en.mjs";
import es from "./strings/es.mjs";
import fr from "./strings/fr.mjs";
import ptBR from "./strings/pt-BR.mjs";
import ru from "./strings/ru.mjs";
import ja from "./strings/ja.mjs";
import ko from "./strings/ko.mjs";

export const EMAIL_LOCALES = ["en", "es", "fr", "pt-BR", "ru", "ja", "ko"];

const TABLES = { en, es, fr, "pt-BR": ptBR, ru, ja, ko };

// What an account's saved language holds, as one of EMAIL_LOCALES: an exact
// match ignoring case, else the language part (es-MX is es, any pt is pt-BR),
// else English.
export function emailLocale(value) {
  if (typeof value !== "string") return "en";
  const v = value.trim().toLowerCase().replace(/_/g, "-");
  if (!v) return "en";
  const exact = EMAIL_LOCALES.find((l) => l.toLowerCase() === v);
  if (exact) return exact;
  const lang = v.split("-")[0];
  if (lang === "pt") return "pt-BR";
  return EMAIL_LOCALES.find((l) => l.toLowerCase() === lang) ?? "en";
}

// {name} is filled from vars; a placeholder with no var is left as it is.
function fill(text, vars) {
  return text.replace(/\{(\w+)\}/g, (whole, name) =>
    vars && Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole);
}

export function emailStrings(locale) {
  const loc = EMAIL_LOCALES.includes(locale) ? locale : "en";
  const table = TABLES[loc];

  // The entry for a key and the language whose table supplied it (plural rules
  // follow the table the words came from).
  function entry(key) {
    if (!Object.prototype.hasOwnProperty.call(en, key)) throw new Error(`email string "${key}" is not in en.mjs`);
    if (Object.prototype.hasOwnProperty.call(table, key)) return { value: table[key], from: loc };
    return { value: en[key], from: "en" };
  }

  function t(key, vars) {
    const { value } = entry(key);
    if (typeof value !== "string") throw new Error(`email string "${key}" is a plural: use n()`);
    return fill(value, vars);
  }

  function n(key, count, vars) {
    const { value, from } = entry(key);
    const all = { ...(vars || {}), count };
    if (typeof value === "string") return fill(value, all);
    const category = new Intl.PluralRules(from).select(count);
    return fill(value[category] ?? value.other, all);
  }

  // "38 photos, 4 notes and a PDF": English keeps its own plain join, every
  // other language uses what Intl knows about its lists.
  function list(items) {
    if (loc === "en") {
      if (items.length <= 1) return items[0] ?? "";
      return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
    }
    return new Intl.ListFormat(loc, { type: "conjunction" }).format(items);
  }

  return { locale: loc, t, n, list };
}
