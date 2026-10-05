// planBlock — the "What it costs" section on comparison and professional pages.
//
// WHY IT EXISTS (research 2026-10-01, read before moving it). The owner asked
// whether more pages should send people to /pricing. The data said: not as a
// detour. Nobody outside the company has ever pressed "Get Creator"; visitors
// who leave a comparison page for /pricing sign up no better than those who
// stay; assistants' visitors almost never go there. But price curiosity is real
// exactly where the comparison is the argument — about one desktop visitor in
// six on /vs/* clicked the quiet topbar "Pricing" link, and on a phone that
// link is hidden entirely (display:none at <=480px), so a phone reader had no
// price on the page at all. So the price comes to the reader, on the page that
// already converts, beside the free start rather than instead of it.
//
// WHERE: every kind:'compare' page, and any spec flagged `planBlock: true` (the
// professional pages, written for crews — the case where one owner-paid plan
// covering everyone is the true and differentiating claim). NOT the hobbyist
// tool pages, the listicles or '/': solo readers lose to per-seat competitors'
// single-seat prices, and nothing there shows price-seeking.
//
// PRE-REGISTERED READ (rewritten 2026-10-02 — the first version measured the
// wrong thing). The block carries its own "Compare plans" link, so counting
// only topbar "Pricing" clicks would score clicks the block DIVERTED as a
// question the block ANSWERED. The measure is any path to /pricing.
//   Population: first lp_view with page_kind='compare', user_id null,
//     device_type 'desktop', internal sessions excluded with NOT EXISTS (a NOT
//     IN over a list containing a NULL session_id returns nothing).
//   Primary: the share of those sessions with a later /pricing view in the same
//     session — pricing_view surface 'public_page', or an lp_view of /pricing —
//     whichever link got them there (topbar, footer, hero, block). Prediction:
//     it FALLS, because the price is answered on the page.
//   Guardrail: same-session visitor -> ps_signup on the same pages. Pull the
//     block if the point estimate falls by more than a third — deliberately
//     trigger-happy, because the test cannot confirm a fall that size.
//   Two phases. /vs/pureref carries roughly nine in ten compare sessions and is
//     held without the block (planBlock: false) until two weeks after its
//     corrected copy is live on production. Until then the block runs on pages
//     too quiet to read anything from: collect, do not grade. The read starts
//     the day /vs/pureref gets the block — window +3d to +31d from that
//     production deploy, never inside 3 days of it.
//   Power, stated now so nobody over-reads it later: at this page family's
//     traffic only a fall of about three-quarters is distinguishable from noise
//     (80% power, alpha 0.05). A smaller effect reports as "not detected",
//     never as "no effect".
//   Baselines are in the project notes, not in this public file.
//   Also read: plan_block / plan_block_pricing / hero_pricing / footer_pricing.
//
// Everything here is built from billingCopy, the same objects /pricing renders.
// No number is typed. The trial is never mentioned: it is in-product only.
//
// Pure ESM: imported by SeoLandingPage (React), worker.js (crawlable HTML) and
// scripts/gen-docs.mjs (the .md twins), so the three cannot say different things.

import {
  PLAN_NAME, PRICING, PRICING_PAGE, CREATOR_BENEFITS, DEMO_FEATURES, CREATOR_STORAGE_LABEL,
} from './billingCopy.js';

export const PLAN_BLOCK_ID = 'what-it-costs';
export const PLAN_BLOCK_HEADING = 'What it costs';

// Which pages carry it. One predicate, shared by every renderer and the tests.
// An explicit `planBlock: false` wins over kind:'compare' — that is how a
// comparison page is held back (see /vs/pureref).
export function hasPlanBlock(spec) {
  if (!spec || spec.storefront || spec.planBlock === false) return false;
  return spec.kind === 'compare' || spec.planBlock === true;
}

// The Creator lines the block shows. Titles only, with two corrections:
// "No size limits" alone read as no limit at all, when there is a drive behind
// it — so the line names the drive. And the workspace benefit is dropped,
// because the block's closing note says the same thing in full one line later.
function creatorLines() {
  return CREATOR_BENEFITS
    .filter((b) => b.key !== 'workspace')
    .map((b) => (b.key === 'storage' ? `${b.title}, on a ${CREATOR_STORAGE_LABEL} drive` : b.title));
}

export function planBlockModel() {
  return {
    id: PLAN_BLOCK_ID,
    heading: PLAN_BLOCK_HEADING,
    lead: PRICING_PAGE.h1,
    free: {
      name: PRICING_PAGE.freeCardName,
      price: PRICING_PAGE.freeCardPrice,
      unit: PRICING_PAGE.freeCardUnit,
      // **bold** markers kept; each renderer decides how to draw them.
      lines: DEMO_FEATURES,
    },
    creator: {
      name: PLAN_NAME,
      price: PRICING.monthly.billedLabel,
      annual: `or ${PRICING.annual.perMonthLabel}/mo billed annually`,
      lines: creatorLines(),
    },
    note: PRICING_PAGE.workspaceNote,
    compareLabel: 'Compare plans',
    compareHref: '/pricing',
  };
}

const plain = (s) => String(s).replace(/\*\*/g, '');
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
const emph = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

// The Worker's crawlable twin of the React section. `signupHref` is the page's
// own CTA href, so the block's free start attributes to the page it is on.
export function planBlockHtml(signupHref = '/') {
  const m = planBlockModel();
  const H2 = 'font-size:1.35rem;font-weight:600;margin:1.4em 0 .4em;';
  return [
    `<section id="${m.id}"><h2 style="${H2}">${esc(m.heading)}</h2><p>${esc(m.lead)}</p>`,
    `<h3>${esc(m.free.name)} — ${esc(m.free.price)} ${esc(m.free.unit)}</h3><ul>`,
    ...m.free.lines.map((l) => `<li>${emph(l)}</li>`),
    `</ul><h3>${esc(m.creator.name)} — ${esc(m.creator.price)}, ${esc(m.creator.annual)}</h3><ul>`,
    ...m.creator.lines.map((l) => `<li>${esc(l)}</li>`),
    `</ul><p>${esc(m.note)}</p>`,
    `<p><a href="${esc(signupHref)}" style="color:#FFA500;">Start free</a> · <a href="${m.compareHref}" style="color:#FFA500;">${esc(m.compareLabel)}</a></p></section>`,
  ].join('');
}

// The .md twins' version.
export function planBlockMarkdown() {
  const m = planBlockModel();
  return [
    `## ${m.heading}`, '',
    m.lead, '',
    `**${m.free.name} — ${m.free.price} ${m.free.unit}**`, '',
    ...m.free.lines.map((l) => `- ${l}`), '',
    `**${m.creator.name} — ${m.creator.price}, ${m.creator.annual}**`, '',
    ...m.creator.lines.map((l) => `- ${plain(l)}`), '',
    m.note, '',
    `Compare the plans side by side: https://clusters.soleilpictures.com${m.compareHref}`, '',
  ];
}
