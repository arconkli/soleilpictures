import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildMagicLinkHtml, MAGIC_LINK_PATH } from "../../scripts/gen-magic-link.mjs";

const html = buildMagicLinkHtml();

test("magic_link.html is exactly what theme.ts generates", () => {
  assert.equal(readFileSync(MAGIC_LINK_PATH, "utf8"), html, "run: node scripts/gen-magic-link.mjs");
});

test("Token is in the subject note, the preheader and the code tile", () => {
  assert.match(html, /<title>Your Clusters sign-in code<\/title>/);
  assert.match(html, />Your Clusters sign-in code: \{\{ \.Token \}\}/);
  assert.match(html, /letter-spacing:0\.32em[^>]*>\{\{ \.Token \}\}<\/span>/);
});

test("no ConfirmationURL, no gold, dark only", () => {
  assert.ok(!html.includes("{{ .ConfirmationURL"));
  assert.ok(!/ConfirmationURL\s*\}\}/.test(html));
  assert.ok(!html.toLowerCase().includes("#ffa500"));
  assert.ok(html.includes("dark only"));
});
