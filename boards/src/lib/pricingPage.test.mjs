// pricingPage — the /pricing copy, and the two things about it that can break
// silently.
//
// The page leads with a real published board in a browser frame. That shot is a
// static file in public/landing/ and a link to a live /c/<slug>, and nothing
// connects the two: rename one and the hero renders a broken image, or the
// caption invites you to open a board that 404s. On the one page whose whole
// job is to look like the product works, that is the worst available failure,
// and it is invisible in every other test because a missing <img> still lays
// out and still passes a visibility check.
//
// The second is arithmetic. Every number on the page is injected from the code
// that enforces it — the card cap, the per-file byte ceilings, the prices — so
// a cap change cannot leave a stale promise behind. These assert that the
// injection is actually happening rather than that a literal happens to match.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  PRICING_PAGE, PLAN_COMPARISON, PRICING_FAQ, PRICING, CREATOR_BENEFITS,
  CREATOR_FEATURE_KEYS, CREATOR_STORAGE_LABEL, PLAN_NAME, creatorBenefits,
} from './billingCopy.js';
import { DEMO_CARD_LIMIT } from './demoCardCap.js';
import { FREE_VIDEO_CAP, FREE_AUDIO_CAP, FREE_PDF_CAP, FREE_VIDEO_SECONDS } from './fileIngest.js';

const HERE = new URL('.', import.meta.url).pathname;
const PUBLIC = join(HERE, '..', '..', 'public');

test('the hero shot exists as a file and names a real board', () => {
  const { slug } = PRICING_PAGE.shot;
  assert.match(slug, /^[a-z0-9-]+$/, 'the slug goes into both a URL and a filename');
  assert.ok(existsSync(join(PUBLIC, 'landing', `${slug}.webp`)),
    `public/landing/${slug}.webp is missing — the pricing hero would render a broken image`);
  // The same slug is the href on the frame (/c/<slug>), so the caption's
  // invitation to open it live has to be true. Nothing here can check the
  // board is still published — that is the seo-health prober's job — but the
  // shot must at least be one of the boards we ship a render for.
  assert.ok(PRICING_PAGE.shot.caption.length > 20, 'the frame caption carries the invitation');
});

test('every number on the page is injected from the code that enforces it', () => {
  // The cap, from demoCardCap.
  assert.ok(PRICING_PAGE.subhead.includes(`${DEMO_CARD_LIMIT} cards`),
    'the subhead states the real cap');
  assert.ok(PRICING_PAGE.freeBody.includes(String(DEMO_CARD_LIMIT)));
  assert.equal(PLAN_COMPARISON.find((r) => r.key === 'cards').demo, String(DEMO_CARD_LIMIT));

  // Both prices, from PRICING.
  assert.ok(PRICING_PAGE.subhead.includes(PRICING.monthly.billedLabel));
  assert.ok(PRICING_PAGE.subhead.includes(PRICING.annual.perMonthLabel));

  // The per-file ceilings, from fileIngest — the module the ingest path routes
  // on. A literal here would be a promise nothing keeps.
  const size = PLAN_COMPARISON.find((r) => r.key === 'storage');
  for (const bytes of [FREE_VIDEO_CAP, FREE_AUDIO_CAP, FREE_PDF_CAP]) {
    assert.ok(size.demo.includes(String(Math.round(bytes / (1024 * 1024)))),
      `the free size row must name ${bytes} bytes as MB, from fileIngest`);
  }
  assert.ok(size.creator.includes(CREATOR_STORAGE_LABEL));
});

test('the comparison is the three enforced gates, and nothing else', () => {
  // Three, because three is how many free/paid differences exist in code:
  // enforce_demo_card_cap_trg, fileIngest's blocked route for a free owner,
  // and the per-file byte caps. A fourth row means someone sold something the
  // server does not enforce — the exact failure billingCopy's header describes.
  assert.equal(PLAN_COMPARISON.length, 3);
  for (const row of PLAN_COMPARISON) {
    for (const f of ['key', 'label', 'demo', 'creator']) {
      assert.ok(row[f] && String(row[f]).length, `${row.key}.${f} must be set`);
    }
  }
  // The hover keys have to stay comparable with the modal's, or a feature read
  // on one surface cannot be counted beside a read on the other.
  const keys = [...PLAN_COMPARISON.map((r) => r.key), 'workspace'];
  assert.deepEqual(keys, CREATOR_FEATURE_KEYS,
    'the comparison rows plus the workspace note carry the modal’s feature keys, in order');
});

test('every gate the code enforces is disclosed, including video LENGTH', () => {
  // The rule in this repo is that every public CLAIM is true. This is its
  // mirror, and the half that was missing: every enforced LIMIT must be stated.
  // uploads.js has capped free video duration at FREE_VIDEO_SECONDS for the
  // product's life, lifted only for a paid owner (CanvasSurface's allowLong),
  // and no page said so — so a free owner's 20 MB, 90-second clip was refused
  // by a rule the pricing page contradicted, since the same page named 30 MB as
  // the wall. An undisclosed limit is a false claim told by omission.
  const publicText = [
    ...CREATOR_BENEFITS.map((b) => `${b.title} ${b.body}`),
    ...PLAN_COMPARISON.map((r) => `${r.label} ${r.demo} ${r.creator}`),
    ...PRICING_FAQ.map((f) => `${f.q} ${f.a}`),
    PRICING_PAGE.paidBody,
  ].join(' ');

  assert.match(publicText, new RegExp(`${FREE_VIDEO_SECONDS}\\s*(seconds|s\\b)`),
    'the free video DURATION cap must be stated somewhere a buyer reads');
  // And in the row that is about per-file limits, whose label has to admit it
  // covers length — "Per-file size" alone is what made the omission readable
  // as a complete statement.
  const sizeRow = PLAN_COMPARISON.find((r) => r.key === 'storage');
  assert.match(sizeRow.label, /length/i, 'the per-file row covers size AND length');
  assert.ok(sizeRow.demo.includes(String(FREE_VIDEO_SECONDS)),
    'the free column names the duration cap beside the byte caps');

  // The byte caps too, so this test covers the whole gate rather than the one
  // clause that happened to be wrong.
  for (const bytes of [FREE_VIDEO_CAP, FREE_AUDIO_CAP, FREE_PDF_CAP]) {
    assert.ok(publicText.includes(String(Math.round(bytes / (1024 * 1024)))),
      `the free ceiling ${bytes} must be disclosed`);
  }
});

test('the in-app benefits can state the READER\'s cap, not a new account\'s', () => {
  // demoCardCap.js: "THE CAP IS PER-USER ... Never render it as a user's actual
  // limit — accounts created before 0229 are grandfathered at
  // LEGACY_DEMO_CARD_LIMIT and would see the wrong number." A referred signup
  // starts higher too. The modal knows effectiveCardLimit; /pricing, which
  // describes what a NEW account gets, correctly does not.
  const generic = creatorBenefits().find((b) => b.key === 'cards').body;
  assert.match(generic, new RegExp(`${DEMO_CARD_LIMIT}-card`), 'the default is the new-account cap');

  for (const cap of [75, 100]) {
    const body = creatorBenefits({ cardLimit: cap }).find((b) => b.key === 'cards').body;
    assert.match(body, new RegExp(`${cap}-card`), `a ${cap}-card account is told ${cap}`);
    assert.doesNotMatch(body, new RegExp(`${DEMO_CARD_LIMIT}-card`),
      'and is never also told the new-account number');
  }

  // A pre-resolution useMyTier placeholder must fall back, never be rendered.
  for (const junk of [undefined, null, 0, -1, NaN, 'x']) {
    const body = creatorBenefits({ cardLimit: junk }).find((b) => b.key === 'cards').body;
    assert.match(body, new RegExp(`${DEMO_CARD_LIMIT}-card`), `junk cap ${junk} falls back`);
  }
});

test('the page never offers the trial', () => {
  // Standing decision: the trial is an invitation extended in-product to
  // someone who has built something, not a banner for anyone passing. It is
  // also structurally impossible here — eligibility needs a real body of work
  // and this page is served to people with no account at all — so any mention
  // would be a promise the server refuses.
  const all = [
    PRICING_PAGE.h1, PRICING_PAGE.subhead, PRICING_PAGE.startFree, PRICING_PAGE.startFreeSub,
    PRICING_PAGE.freeHeading, PRICING_PAGE.freeBody, PRICING_PAGE.paidHeading,
    PRICING_PAGE.paidBody, PRICING_PAGE.workspaceNote, PRICING_PAGE.closing,
    PRICING_PAGE.closingSub, PRICING_PAGE.shot.caption,
    ...PLAN_COMPARISON.flatMap((r) => [r.label, r.demo, r.creator]),
    ...PRICING_FAQ.flatMap((f) => [f.q, f.a]),
  ].join(' ');
  assert.doesNotMatch(all, /\btrial\b(?!\s+clock)/i,
    'the only permitted use of the word is "no trial clock", which is a promise about the FREE plan');
  assert.doesNotMatch(all, /days free|free for \d+ days/i);
});

test('the FAQ answers the questions this page is actually asked', () => {
  assert.ok(PRICING_FAQ.length >= 4);
  const qs = PRICING_FAQ.map((f) => f.q).join(' | ');
  // Not a style check: these four are what the surrounding evidence says the
  // visitor arrives with. They come from comparison pages against a free
  // desktop tool, so "what does free actually get me", "will my collaborators
  // be charged" (we are the only individual plan in the category that does not
  // charge per seat), "what happens at the cap", and "can I get out".
  assert.match(qs, /limited on the free plan/i);
  assert.match(qs, /invite/i);
  assert.match(qs, new RegExp(`${DEMO_CARD_LIMIT} cards`));
  assert.match(qs, /cancel/i);
  for (const f of PRICING_FAQ) {
    assert.ok(f.a.length > 60, `"${f.q}" deserves a real answer, not a word`);
  }
  // The seat answer is the competitive one and the easiest to get wrong: it
  // must say the limits carry, never that editing or invitations are the thing
  // being sold — migration 0188 made both free on every tier.
  const seats = PRICING_FAQ.find((f) => /invite/i.test(f.q));
  assert.match(seats.a, /no per-seat charges/i);
  assert.match(seats.a, new RegExp(`${PLAN_NAME}`));
  assert.doesNotMatch(seats.a, /unlocks? editing|adds? editing|paid seat/i);
});
