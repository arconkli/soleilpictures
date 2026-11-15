import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildMagicLinkHtml, buildMagicLinkFor, magicLinkSubjectFor, MAGIC_LINK_PATH, MAGIC_LINK_SUBJECT,
} from "../../scripts/gen-magic-link.mjs";
import { EMAIL_LOCALES } from "../../../supabase/functions/_shared/email/i18n.mjs";

const html = buildMagicLinkHtml();

test("magic_link.html is exactly what theme.ts generates", () => {
  assert.equal(readFileSync(MAGIC_LINK_PATH, "utf8"), html, "run: node scripts/gen-magic-link.mjs");
});

test("Token is in the subject note, the preheader and the code tile", () => {
  assert.match(html, /<title>[^<]*Your Clusters sign-in code(\{\{ end \}\})?<\/title>/);
  assert.match(html, />[^<>]*Your Clusters sign-in code: \{\{ \.Token \}\}/);
  assert.match(html, /letter-spacing:0\.32em[^>]*>\{\{ \.Token \}\}<\/span>/);
  assert.match(html, /\{\{ \.Token \}\}[^\n]*is your Clusters sign-in code/);
});

test("no ConfirmationURL, no gold, dark only", () => {
  assert.ok(!html.includes("{{ .ConfirmationURL"));
  assert.ok(!/ConfirmationURL\s*\}\}/.test(html));
  assert.ok(!html.toLowerCase().includes("#ffa500"));
  assert.ok(html.includes("dark only"));
});

// The one construct set the generator writes: {{ if eq .Data.locale "x" }},
// {{ else if eq .Data.locale "x" }}, {{ else }}, {{ end }} and {{ .Token }}.
// Anything else in the file is a mistake this evaluator refuses.
function evaluate(template, locale, token) {
  const parts = template.split(/(\{\{.*?\}\})/s);
  // Each frame: whether its text is being written, whether an arm has been taken.
  const stack = [];
  const writing = () => stack.every((f) => f.on);
  let out = "";
  const eq = (expr) => {
    const m = expr.match(/^eq \.Data\.locale "([A-Za-z-]+)"$/);
    assert.ok(m, `unsupported condition: ${expr}`);
    return locale !== undefined && locale === m[1];
  };
  for (const part of parts) {
    const m = part.match(/^\{\{ (.*) \}\}$/s);
    if (!m) { if (writing()) out += part; continue; }
    const action = m[1];
    if (action === ".Token") { if (writing()) out += token; }
    else if (action.startsWith("if ")) {
      const on = eq(action.slice(3));
      stack.push({ on, taken: on });
    } else if (action.startsWith("else if ")) {
      const f = stack[stack.length - 1];
      assert.ok(f, "else if outside if");
      f.on = !f.taken && eq(action.slice(8));
      f.taken ||= f.on;
    } else if (action === "else") {
      const f = stack[stack.length - 1];
      assert.ok(f, "else outside if");
      f.on = !f.taken;
      f.taken = true;
    } else if (action === "end") {
      assert.ok(stack.pop(), "end outside if");
    } else assert.fail(`unsupported action: {{ ${action} }}`);
  }
  assert.equal(stack.length, 0, "an if is never closed");
  return out;
}

const TOKEN = "123456";
const withoutComment = (s) => s.replace(/<!--\n[\s\S]*?\n-->\n/, "");
const direct = (locale) => withoutComment(buildMagicLinkFor(locale)).split("{{ .Token }}").join(TOKEN) + "\n";

test("the file, read for each language, is the page built from that language's words", () => {
  const file = readFileSync(MAGIC_LINK_PATH, "utf8");
  for (const locale of EMAIL_LOCALES) {
    assert.equal(withoutComment(evaluate(file, locale, TOKEN)), direct(locale), locale);
  }
});

test("a language the file does not know, or none at all, reads English", () => {
  const file = readFileSync(MAGIC_LINK_PATH, "utf8");
  for (const locale of ["de", "", undefined]) {
    assert.equal(withoutComment(evaluate(file, locale, TOKEN)), direct("en"), String(locale));
  }
});

test("the subject for the Dashboard reads the same way, and sits in the file's comment", () => {
  const file = readFileSync(MAGIC_LINK_PATH, "utf8");
  assert.ok(file.includes(`      ${MAGIC_LINK_SUBJECT}\n`), "the subject is in the comment");
  for (const locale of EMAIL_LOCALES) {
    assert.equal(evaluate(MAGIC_LINK_SUBJECT, locale, TOKEN), magicLinkSubjectFor(locale).split("{{ .Token }}").join(TOKEN), locale);
  }
  assert.equal(evaluate(MAGIC_LINK_SUBJECT, "xx", TOKEN), `${TOKEN} is your Clusters sign-in code`);
});

test("the page names its language: the reader's once it has words in it, else English", () => {
  assert.match(direct("en"), /<html lang="en"/);
  for (const locale of EMAIL_LOCALES) {
    const lang = direct(locale).match(/<html lang="([^"]+)"/)[1];
    assert.ok(lang === locale || lang === "en", `${locale} wrote lang="${lang}"`);
  }
});
