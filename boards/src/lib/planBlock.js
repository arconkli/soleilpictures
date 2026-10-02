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
// PRE-REGISTERED READ (2026-10-01). Predicate: first lp_view with
// page_kind='compare', user_id null, internal sessions excluded (NOT EXISTS).
// Window: production ship +3d to +31d; floor 120 sessions.
//   Primary: desktop topbar_pricing clickers / desktop sessions falls from the
//     16.2% baseline (21/130, 09-05..09-30) to <=10% — the price was answered
//     in place.
//   Guardrail: /vs/pureref same-device visitor->signup stays >=18% (baseline
//     35/143 = 24.5%). Below it, pull the block.
//   Also read: plan_block / plan_block_pricing / hero_pricing clicks.
//
// Everything here is built from billingCopy, the same objects /pricing renders.
// No number is typed. The trial is never mentioned: it is in-product only.
//
// Pure ESM: imported by SeoLandingPage (React), worker.js (crawlable HTML) and
// scripts/gen-docs.mjs (the .md twins), so the three cannot say different things.

import {
  PLAN_NAME, PRICING, PRICING_PAGE, CREATOR_BENEFITS, DEMO_FEATURES,
} from './billingCopy.js';

export const PLAN_BLOCK_ID = 'what-it-costs';
export const PLAN_BLOCK_HEADING = 'What it costs';

// Which pages carry it. One predicate, shared by every renderer and the tests.
export function hasPlanBlock(spec) {
  return !!spec && !spec.storefront && (spec.kind === 'compare' || spec.planBlock === true);
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
      lines: CREATOR_BENEFITS.map((b) => b.title),
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
