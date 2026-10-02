// /pricing as a crawler, an answer engine or `curl` sees it.
//
// Until 2026-10-01 the Worker only rewrote /pricing's <head>. Its
// <main id="seo-fallback"> kept index.html's homepage body — byte-identical to
// '/' — so every reader that does not run JavaScript (GPTBot, ClaudeBot,
// PerplexityBot, Bing's indexer, an assistant fetching the page for a user) got
// a page called "Pricing" with no price on it, no plans and no answers. The
// one place the price lived was the meta description. A page whose body is
// the homepage's is also, to Google, a duplicate of the homepage, which is a
// plausible reason it had never earned one impression.
//
// Everything here is built from billingCopy — the same objects PricingPageView
// renders — so the server-rendered body and the React page say the same
// things in the same order (anti-cloaking parity, the rule the landing and
// listicle registries are organised around). No number is typed in this file:
// prices, caps and per-file ceilings all arrive through billingCopy, which
// takes them from the code that enforces them.
//
// The trial is absent on purpose, exactly as it is on the React page: it is
// offered in-product to an account with a real body of work, never to a
// signed-out visitor (billingCopy, PRICING_PAGE header; pricingPage.test.mjs).
//
// Pure ESM, no DOM: imported by the Worker (edge injection), by
// scripts/gen-docs.mjs (public/pricing.md + the llms.txt line) and by
// pricingCrawlable.test.mjs.

import {
  PLAN_NAME, PRICING, SAVINGS_PCT_LABEL, PRICING_PAGE, PLAN_COMPARISON,
  PRICING_FAQ, CREATOR_BENEFITS, DEMO_FEATURES,
} from './billingCopy.js';

export const PRICING_PATH = '/pricing';
const SITE_ORIGIN = 'https://clusters.soleilpictures.com';
const SIGNUP = '/?utm_source=pricing&utm_medium=crawlable&utm_campaign=pricing';

// billingCopy marks bold spans with **…** for renderEmphasis in PricingBits.
// Plain text strips them; HTML turns them into <b>.
const plain = (s) => String(s).replace(/\*\*/g, '');
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
const emph = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

// The one sentence an assistant should be able to lift whole: both plans,
// both prices, and the scope that makes the flat price a flat price.
export const PRICING_ANSWER =
  `Soleil Clusters has two plans. ${PRICING_PAGE.freeCardName} is ${PRICING_PAGE.freeCardPrice} ` +
  `${PRICING_PAGE.freeCardUnit} with no credit card. ${PLAN_NAME} is ${PRICING.monthly.billedLabel}, or ` +
  `${PRICING.annual.perMonthLabel}/mo billed annually (${PRICING.annual.billedLabel}), and one ${PLAN_NAME} ` +
  'plan covers the whole workspace: everyone invited builds at its limits, with no per-seat charges.';

// The same model React draws, flattened into one structure.
export function pricingModel() {
  return {
    h1: PRICING_PAGE.h1,
    subhead: PRICING_PAGE.subhead,
    answer: PRICING_ANSWER,
    free: {
      name: PRICING_PAGE.freeCardName,
      price: `${PRICING_PAGE.freeCardPrice} ${PRICING_PAGE.freeCardUnit}`,
      sub: PRICING_PAGE.freeCardSub,
      features: DEMO_FEATURES,
    },
    creator: {
      name: PLAN_NAME,
      price: PRICING.monthly.billedLabel,
      annual: `or ${PRICING.annual.perMonthLabel}/mo billed annually (${PRICING.annual.billedLabel}) — ${SAVINGS_PCT_LABEL.toLowerCase()}`,
      sub: PRICING_PAGE.paidCardSub,
      benefits: CREATOR_BENEFITS.map((b) => ({ title: b.title, body: b.body })),
    },
    comparison: {
      heading: PRICING_PAGE.paidHeading,
      body: PRICING_PAGE.paidBody,
      rows: PLAN_COMPARISON.map((r) => ({ label: r.label, free: r.demo, creator: r.creator })),
      note: PRICING_PAGE.workspaceNote,
    },
    faq: PRICING_FAQ,
    closing: PRICING_PAGE.closing,
    closingSub: PRICING_PAGE.closingSub,
  };
}

export function buildPricingCrawlableHtml() {
  const m = pricingModel();
  const H2 = 'font-size:1.35rem;font-weight:600;margin:1.4em 0 .4em;';
  const parts = [];
  parts.push('<p style="color:#FFA500;font-size:.8rem;letter-spacing:.16em;text-transform:uppercase;font-weight:700;margin:0 0 .8em;">Pricing</p>');
  parts.push(`<h1 style="font-size:1.9rem;font-weight:700;margin:0 0 .4em;">${esc(m.h1)}</h1>`);
  parts.push(`<p style="color:#b7b1a6;font-size:1.15rem;margin:0 0 1.4em;">${esc(m.subhead)}</p>`);
  parts.push(`<p><b>${esc(m.answer)}</b></p>`);

  parts.push(`<section><h2 style="${H2}">${esc(m.free.name)} — ${esc(m.free.price)}</h2><p>${esc(m.free.sub)}</p><ul>`);
  for (const f of m.free.features) parts.push(`<li>${emph(f)}</li>`);
  parts.push('</ul></section>');

  parts.push(`<section><h2 style="${H2}">${esc(m.creator.name)} — ${esc(m.creator.price)}</h2>`);
  parts.push(`<p>${esc(m.creator.annual)}. ${esc(m.creator.sub)}</p><ul>`);
  for (const b of m.creator.benefits) parts.push(`<li><b>${esc(b.title)}</b> — ${emph(b.body)}</li>`);
  parts.push('</ul></section>');

  parts.push(`<section><h2 style="${H2}">${esc(m.comparison.heading)}</h2><p>${esc(m.comparison.body)}</p>`);
  parts.push(`<table><thead><tr><th></th><th>${esc(m.free.name)}</th><th>${esc(m.creator.name)}</th></tr></thead><tbody>`);
  for (const r of m.comparison.rows) {
    parts.push(`<tr><th>${esc(r.label)}</th><td>${esc(r.free)}</td><td>${esc(r.creator)}</td></tr>`);
  }
  parts.push(`</tbody></table><p>${esc(m.comparison.note)}</p></section>`);

  parts.push(`<section><h2 style="${H2}">Frequently asked questions</h2>`);
  for (const f of m.faq) parts.push(`<h3 style="font-size:1.05rem;margin:1em 0 .3em;">${esc(f.q)}</h3><p>${esc(f.a)}</p>`);
  parts.push('</section>');

  parts.push(`<section><h2 style="${H2}">${esc(m.closing)}</h2><p>${esc(m.closingSub)}</p>`);
  parts.push(`<p><a href="${SIGNUP}" style="color:#FFA500;">Start free</a> · <a href="/docs/account/plans" style="color:#FFA500;">Plans, limits and billing in the docs</a></p></section>`);
  parts.push('<p style="color:#8a8a92;font-size:.85rem;margin-top:2em;">Machine-readable: <a href="/pricing.md" style="color:#FFA500;">/pricing.md</a> · <a href="/llms.txt" style="color:#FFA500;">/llms.txt</a></p>');
  return parts.join('');
}

// public/pricing.md — the raw twin assistants and `curl` read.
export function pricingMarkdown() {
  const m = pricingModel();
  const out = [
    `# ${m.h1}`, '',
    `URL: ${SITE_ORIGIN}${PRICING_PATH}`, '',
    m.subhead, '',
    m.answer, '',
    `## ${m.free.name} — ${m.free.price}`, '',
    m.free.sub, '',
    ...m.free.features.map((f) => `- ${f}`), '',
    `## ${m.creator.name} — ${m.creator.price}`, '',
    `${m.creator.annual[0].toUpperCase()}${m.creator.annual.slice(1)}. ${m.creator.sub}`, '',
    ...m.creator.benefits.map((b) => `- **${b.title}** — ${b.body}`), '',
    `## ${m.comparison.heading}`, '',
    m.comparison.body, '',
    `| | ${m.free.name} | ${m.creator.name} |`,
    '|---|---|---|',
    ...m.comparison.rows.map((r) => `| ${r.label} | ${r.free} | ${r.creator} |`), '',
    m.comparison.note, '',
    '## Frequently asked questions', '',
  ];
  for (const f of m.faq) out.push(`### ${f.q}`, '', f.a, '');
  out.push(`Full plan and billing documentation: ${SITE_ORIGIN}/docs/account/plans`, '');
  return out.join('\n');
}

// The machine-readable price. One Offer per real way to buy —
// the free plan, Creator monthly, Creator annual — each from billingCopy. The
// site-wide SoftwareApplication in index.html deliberately carries NO offers
// (a static price there would be a hand-typed literal); this graph gets its
// own @id so the two never assert two prices for one node.
export function buildPricingJsonLd() {
  const url = `${SITE_ORIGIN}${PRICING_PATH}`;
  const m = pricingModel();
  const offer = (name, price, unitCode, description) => ({
    '@type': 'Offer',
    name,
    price: String(price),
    priceCurrency: 'USD',
    url,
    description,
    ...(unitCode ? {
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price: String(price),
        priceCurrency: 'USD',
        billingDuration: 1,
        billingIncrement: 1,
        unitCode,
      },
    } : {}),
  });
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: `Pricing — Soleil Clusters`,
        description: PRICING_ANSWER,
        isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
        mainEntity: { '@id': `${url}#plans` },
      },
      {
        // SoftwareApplication, the type every landing page already uses for
        // the product — so the site describes one kind of thing everywhere.
        '@type': 'SoftwareApplication',
        '@id': `${url}#plans`,
        name: 'Soleil Clusters',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        description: PRICING_ANSWER,
        offers: [
          offer(m.free.name, 0, null, plain(m.free.features.join('; '))),
          offer(`${PLAN_NAME} — monthly`, PRICING.monthly.billed, 'MON', PRICING_PAGE.workspaceNote),
          offer(`${PLAN_NAME} — annual`, PRICING.annual.billed, 'ANN', PRICING_PAGE.workspaceNote),
        ],
      },
      {
        '@type': 'FAQPage',
        '@id': `${url}#faq`,
        mainEntity: m.faq.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_ORIGIN}/` },
          { '@type': 'ListItem', position: 2, name: 'Pricing', item: url },
        ],
      },
    ],
  };
}
