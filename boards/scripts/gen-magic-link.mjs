// Generates supabase/templates/magic_link.html from the shared email look
// (supabase/functions/_shared/email/theme.ts) and the words in
// supabase/functions/_shared/email/strings/, so the sign-in code email can
// never drift from the rest.
//
//   node scripts/gen-magic-link.mjs           write the template
//   node scripts/gen-magic-link.mjs --check   exit 1 if the committed file differs
//
// Supabase renders this file itself and knows nothing of our code, so the
// languages are written into it: every string is a Go-template chain over the
// seven tables, picked by `.Data.locale` (the app sends the reader's language
// as signInWithOtp data, see AuthGate). A language whose table lacks a string
// is left out of that string's chain and reads the English.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { shell, eyebrow, h1, lead, codeTile, small, footerTx, esc } from "../../supabase/functions/_shared/email/theme.ts";
import { emailStrings, EMAIL_LOCALES } from "../../supabase/functions/_shared/email/i18n.mjs";
import en from "../../supabase/functions/_shared/email/strings/en.mjs";
import es from "../../supabase/functions/_shared/email/strings/es.mjs";
import fr from "../../supabase/functions/_shared/email/strings/fr.mjs";
import ptBR from "../../supabase/functions/_shared/email/strings/pt-BR.mjs";
import ru from "../../supabase/functions/_shared/email/strings/ru.mjs";
import ja from "../../supabase/functions/_shared/email/strings/ja.mjs";
import ko from "../../supabase/functions/_shared/email/strings/ko.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const MAGIC_LINK_PATH = resolve(HERE, "../../supabase/templates/magic_link.html");

const TABLES = { en, es, fr, "pt-BR": ptBR, ru, ja, ko };
const OTHERS = EMAIL_LOCALES.filter((l) => l !== "en");
const TOKEN = "{{ .Token }}";

// A string of the sign-in email, as the Go template writes it: English, or a
// chain with one arm per language that has the string. `fmt` turns the string
// (with {code} already filled) into what the page holds there.
function chain(locales, text, fmt) {
  const arms = locales.map((l) => [l, text(l)]).filter(([, t]) => t !== undefined);
  const english = fmt(text("en"));
  if (!arms.length) return english;
  const body = arms.map(([l, t], i) =>
    `{{ ${i === 0 ? "if" : "else if"} eq .Data.locale "${l}" }}${fmt(t)}`).join("");
  return `${body}{{ else }}${english}{{ end }}`;
}

function entryOf(locale, key) {
  const v = TABLES[locale][key];
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new Error(`${key} must be a plain string`);
  // A translator's text must not be able to write template code.
  if (/\{\{|\}\}|`/.test(v)) throw new Error(`${locale} ${key}: no template syntax or backquotes in a string`);
  return v;
}
const fill = (v) => v.replace(/\{code\}/g, TOKEN);

// The Dashboard's subject field.
export const MAGIC_LINK_SUBJECT = chain(OTHERS, (l) => entryOf(l, "magic_link.subject"), fill);

// The words that appear in the page (HTML-escaped) and the page's language.
const KEYS = ["title", "preheader", "eyebrow", "headline", "lead", "small"];
const LANG = "lang";
const mark = (k) => `${k}`;

function compose() {
  const body = [
    eyebrow(mark("eyebrow"), "center"),
    h1(mark("headline"), "center"),
    lead(mark("lead"), "center"),
    codeTile(TOKEN),
    small(mark("small"), "center"),
  ].join("\n        ");
  return shell({
    title: mark("title"),
    preheader: mark("preheader"),
    body,
    footer: footerTx(),
    lang: mark(LANG),
  });
}

function withWords(pick) {
  return compose().replace(/([a-z]+)/g, (_, k) => pick(k));
}

// The page says it is in a language only when some of its words are: a
// language with no sign-in words yet sends English words under lang="en".
const hasWords = (l) => KEYS.concat(["subject"]).some((x) => entryOf(l, `magic_link.${x}`) !== undefined);
const langFor = (l) => (l === "en" || hasWords(l) ? l : "en");

// The page for one language, written out directly: what the chains must
// evaluate to for that language (the test compares the two).
export function buildMagicLinkFor(locale) {
  const s = emailStrings(locale);
  const words = {
    title: () => s.t("magic_link.title", { code: TOKEN }),
    preheader: () => s.t("magic_link.preheader", { code: TOKEN }),
    eyebrow: () => s.t("magic_link.eyebrow", { code: TOKEN }),
    headline: () => s.t("magic_link.headline", { code: TOKEN }),
    lead: () => s.t("magic_link.lead", { code: TOKEN }),
    small: () => s.t("magic_link.small", { code: TOKEN }),
  };
  return withWords((k) => k === LANG ? langFor(s.locale) : esc(words[k]()));
}

// The subject for one language, as GoTrue would send it for that reader.
export function magicLinkSubjectFor(locale) {
  return emailStrings(locale).t("magic_link.subject", { code: TOKEN });
}

const COMMENT = `<!--
  Soleil Clusters — Magic Link / OTP email template (dark, brand-true).

  GENERATED. The look comes from supabase/functions/_shared/email/theme.ts;
  regenerate with \`node scripts/gen-magic-link.mjs\` from boards/. Do not edit
  this file by hand. After changing it, paste the file into Supabase Dashboard
  → Authentication → Emails → "Magic link".

  Subject (the Dashboard's subject field):
      ${MAGIC_LINK_SUBJECT}
  The code in the subject shows on a phone's lock screen and in the inbox
  list, so it can be read without opening the mail app and finding this
  message. GoTrue renders the subject with the same data as the body; its own
  reauthentication email does exactly this.

  "It works for an hour" below must match Email OTP Expiration in the
  Dashboard (Authentication → Sign In / Providers → Email): 3600 seconds. The
  app remembers the code step for the same hour (boards/src/lib/pendingCode.js).
  Asking for a new code kills the one before it, so the body says so.

  Token renders via {{ .Token }}. We do NOT include the ConfirmationURL field
  on purpose — disposable / corporate email scanners prefetch links and
  consume one-time tokens, blowing up the OTP flow.
-->`;

export function buildMagicLinkHtml() {
  const html = withWords((k) => {
    if (k === LANG) {
      return chain(OTHERS.filter(hasWords), (l) => l, (v) => v);
    }
    if (!KEYS.includes(k)) throw new Error(`unknown magic_link word: ${k}`);
    return chain(OTHERS, (l) => entryOf(l, `magic_link.${k}`), (v) => esc(fill(v)));
  });
  return html.replace("<!DOCTYPE html>\n", `<!DOCTYPE html>\n${COMMENT}\n`) + "\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = buildMagicLinkHtml();
  if (process.argv.includes("--check")) {
    let cur = "";
    try { cur = readFileSync(MAGIC_LINK_PATH, "utf8"); } catch {}
    if (cur !== out) { console.error("magic_link.html is stale: run node scripts/gen-magic-link.mjs"); process.exit(1); }
  } else {
    writeFileSync(MAGIC_LINK_PATH, out);
  }
}
