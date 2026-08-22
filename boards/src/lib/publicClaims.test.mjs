// publicClaims.test.mjs — truth-in-advertising lint over every public copy
// surface, not just billingCopy.
//
// billingCopy.js carries the rule ("EVERY LINE HERE MUST BE TRUE AND ENFORCED
// IN CODE") and billingCopy.test.mjs enforces it — but only for the strings
// that live IN that module. The SEO landing registry, the listicle family, the
// Worker's edge-injected meta and the docs pages all make plan claims of their
// own, and nothing checked them. That gap shipped two retired claims for
// months: "Edit Mode" (migration 0188 made editing free for every tier) and
// "unlimited boards" as a Creator feature (boards were never capped on any
// tier). Both were found by grepping a production bundle, which is not a
// process.
//
// The enforced free/paid differences are exactly three (see billingCopy.js):
// cards, file types, per-file size on a 100GB drive. Anything else sold as a
// paid unlock is false.
//
// SCOPE NOTE: these files legitimately describe COMPETITORS' plans, which do
// cap boards and do gate editing. Every rule below is therefore scoped to
// sentences that talk about OUR plan (they name Creator, or our Demo tier), so
// a sentence about Milanote's free tier can say whatever is true of Milanote.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BOARDS = resolve(HERE, '../..');

function walk(dir, match, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, match, out);
    else if (match.test(name)) out.push(p);
  }
  return out;
}

const FILES = [
  resolve(BOARDS, 'src/lib/seoLanding.js'),
  resolve(BOARDS, 'src/lib/seoListicles.js'),
  resolve(BOARDS, 'src/worker.js'),
  ...walk(resolve(BOARDS, 'content/docs'), /\.md$/),
].map((p) => ({ path: p, rel: relative(BOARDS, p), text: readFileSync(p, 'utf8') }));

// Split into sentence-ish spans so a rule can require two terms to co-occur in
// ONE claim. Newlines end a span too: adjacent bullets are separate claims.
function sentences(text) {
  return text.split(/(?<=[.!?])\s+|\n/g);
}

// A span is about OUR plan if it names Creator or our Demo tier. Competitor
// prose in these files names the competitor instead, so it falls out of scope.
function aboutOurPlan(s) {
  return /\bCreator\b/.test(s) || /\bDemo tier\b/i.test(s) || /\bfree Demo\b/i.test(s);
}

// An FAQ *question* restates the phrase a searcher typed; it asserts nothing,
// and the answer beneath it is what has to be true. "Is there a free Milanote
// alternative without item caps?" is a legitimate question to answer honestly
// ("Both free tiers cap items…") — flagging the question would push us toward
// not answering it at all.
// Both key styles appear: bare `q:` in the landing registry, quoted `"q":` in
// the listicle JSON blocks.
function isFaqQuestion(s) {
  return /["']?\bq["']?:\s*['"`]/.test(s) && /\?/.test(s);
}

const RULES = [
  {
    name: 'Edit Mode is a retired feature name (0188 made editing free for every tier)',
    // Capitalized, it is the retired product noun and always wrong. Lowercase
    // "edit mode" is ordinary UI vocabulary — a note leaves edit mode when you
    // click away — so that form is only an error inside a plan claim.
    scoped: false,
    pattern: /Edit Mode/,
  },
  {
    name: 'editing is not part of what a plan unlocks',
    scoped: true,
    pattern: /edit mode/i,
  },
  {
    name: 'boards/clusters are not a paid unlock — they were never capped',
    scoped: true,
    pattern: /unlimited (boards|clusters)/i,
    // ...but only when sold AS the upgrade. "The free tier covers N cards
    // across unlimited boards" is true and must keep passing.
    unless: (s) => !/\bCreator\b/.test(s),
  },
  {
    name: 'invited collaborators edit free on every tier (a public LINK is read-only, a collaborator is not)',
    scoped: true,
    pattern: /collaborators?[^.!?]*\bread-only\b|\bread-only\b[^.!?]*collaborators?/i,
  },
  {
    name: 'editing is not sold per seat and is not a paid unlock',
    scoped: true,
    pattern: /(unlocks?|turns on|adds?|enables?) (shared )?editing|paid seat to edit/i,
  },
  {
    // The most expensive claim found in this sweep: a whole landing page was
    // titled "No Item Caps" and its answer paragraph — the block AI engines
    // quote — promised "no hard item cap on the free tier", while
    // enforce_demo_card_cap_trg stops that tier at 50 cards (100
    // grandfathered). Uploads are not metered SEPARATELY, which is the true
    // and still-good claim; every file simply lands as a card under the cap.
    name: 'the free tier IS card-capped — never advertise it as uncapped',
    scoped: false,
    pattern: /no (hard )?(item|card) (cap|wall)|without (the )?item (caps?|wall)|no upload ceiling|no ceiling on (image )?uploads|does not meter uploads/i,
  },
];

for (const rule of RULES) {
  test(`no public copy claims: ${rule.name}`, () => {
    const hits = [];
    for (const f of FILES) {
      sentences(f.text).forEach((s) => {
        if (!rule.pattern.test(s)) return;
        if (isFaqQuestion(s)) return;
        if (rule.scoped && !aboutOurPlan(s)) return;
        if (rule.unless && rule.unless(s)) return;
        hits.push(`${f.rel}: ${s.trim().slice(0, 160)}`);
      });
    }
    assert.deepEqual(hits, [],
      `these public claims are false — see billingCopy.js for the three enforced differences:\n  ${hits.join('\n  ')}`);
  });
}

// A lint that scans nothing passes everything. Prove the corpus is real and
// that the scan can actually see plan claims inside it.
test('the public copy corpus is actually being scanned', () => {
  assert.ok(FILES.length > 20, `expected the docs + SEO registries, found ${FILES.length} files`);
  const creatorClaims = FILES.filter((f) => /\bCreator\b/.test(f.text)).length;
  assert.ok(creatorClaims >= 4, `only ${creatorClaims} files mention Creator — the scan is looking in the wrong place`);
});
