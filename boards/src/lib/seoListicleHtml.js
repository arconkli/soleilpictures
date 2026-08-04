// Server-rendered crawlable HTML + JSON-LD for the /best/* listicle pages.
//
// Pure module (importable by the Worker AND node tests — worker.js is already
// ~1,900 lines, and extracting these builders makes the anti-cloaking parity
// testable without wrangler). The HTML mirrors SeoListiclePage.jsx block-for-
// block from the SAME spec (lib/seoListicles.js): same headings, same section
// ids (TOC jump targets), same visible text. Inline styles only — this renders
// inside <main id="seo-fallback"> in the pre-hydration document.
//
// JSON-LD policy: Article (Organization author) + ItemList of the ranked tool
// NAMES + BreadcrumbList + FAQPage. Deliberately NO Review / AggregateRating /
// per-item ratings anywhere in markup — self-serving review structured data is
// a Google manual-action magnet; the editorial /10 ratings are visible table
// copy only.

import { listicleToc } from './seoListicles.js';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const prettyDate = (iso) => new Date(iso + 'T00:00:00Z')
  .toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

const H2 = 'font-size:1.35rem;font-weight:600;margin:1.6em 0 .4em;';
const H3 = 'font-size:1.15rem;font-weight:600;margin:1.2em 0 .3em;';
const MUTED = 'color:#b7b1a6;';
const GOLD = 'color:#FFA500;';

export function buildListicleCrawlableHtml(spec) {
  const parts = [];

  // ── Hero: eyebrow, h1, subhead, byline + honest date pair ──
  if (spec.eyebrow) parts.push(`<p style="${GOLD}font-size:.8rem;letter-spacing:.16em;text-transform:uppercase;font-weight:700;margin:0 0 .8em;">${escapeHtml(spec.eyebrow)}</p>`);
  parts.push(`<h1 style="font-size:1.9rem;font-weight:700;margin:0 0 .4em;">${escapeHtml(spec.h1)}</h1>`);
  parts.push(`<p style="${MUTED}font-size:1.15rem;margin:0 0 .8em;">${escapeHtml(spec.subhead)}</p>`);
  parts.push(`<p style="color:#8a8a92;font-size:.85rem;margin:0 0 1.4em;">By ${escapeHtml(spec.author.name)} · `
    + `Published <time datetime="${escapeHtml(spec.published)}">${escapeHtml(prettyDate(spec.published))}</time>`
    + (spec.updated !== spec.published ? ` · Updated <time datetime="${escapeHtml(spec.updated)}">${escapeHtml(prettyDate(spec.updated))}</time>` : '')
    + `</p>`);

  // ── Quick answer (the AI-liftable block) + disclosure ──
  parts.push(`<section id="answer"><h2 style="${H2}">${escapeHtml(spec.answerHeading)}</h2>`);
  parts.push(`<p><b>${escapeHtml(spec.answer)}</b></p>`);
  parts.push(`<p style="${MUTED}border-left:3px solid #FFA500;padding-left:.9em;font-size:.95rem;">${escapeHtml(spec.disclosure)}</p>`);
  // Ranked quick-list: every tool name links to its review (jump anchors).
  parts.push(`<ol>`);
  for (const it of spec.items) {
    parts.push(`<li><a href="#${escapeHtml(it.anchor)}" style="${GOLD}">${escapeHtml(it.name)}</a> — ${escapeHtml(it.bestFor)}</li>`);
  }
  parts.push(`</ol></section>`);

  // ── Table of contents (derived — same ids as the React page) ──
  parts.push(`<nav aria-label="Table of contents"><h2 style="${H2}">Table of contents</h2><ol>`);
  for (const t of listicleToc(spec)) {
    parts.push(`<li><a href="#${escapeHtml(t.id)}" style="${GOLD}">${escapeHtml(t.label)}</a></li>`);
  }
  parts.push(`</ol></nav>`);

  // ── Comparison table ──
  parts.push(`<section id="table"><h2 style="${H2}">Comparison table</h2>`);
  if (spec.tableIntro) parts.push(`<p>${escapeHtml(spec.tableIntro)}</p>`);
  parts.push(`<table><thead><tr><th>Tool</th>${spec.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>`);
  for (const it of spec.items) {
    const cells = spec.tableCells[it.anchor] || [];
    parts.push(`<tr><th><a href="#${escapeHtml(it.anchor)}" style="${GOLD}">${escapeHtml(it.name)}</a></th>${cells.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`);
  }
  parts.push(`</tbody></table></section>`);

  // ── Thesis (the branded framework) ──
  parts.push(`<section id="thesis"><h2 style="${H2}">${escapeHtml(spec.thesis.heading)}</h2>`);
  for (const p of spec.thesis.paras) parts.push(`<p>${escapeHtml(p)}</p>`);
  parts.push(`</section>`);

  // ── Methodology ──
  parts.push(`<section id="method"><h2 style="${H2}">${escapeHtml(spec.methodology.heading)}</h2>`);
  parts.push(`<p>${escapeHtml(spec.methodology.intro)}</p><ol>`);
  for (const c of spec.methodology.criteria) {
    parts.push(`<li><b>${escapeHtml(c.name)}.</b> ${escapeHtml(c.why)}</li>`);
  }
  parts.push(`</ol></section>`);

  // ── The ranked reviews ──
  parts.push(`<section id="picks"><h2 style="${H2}">${escapeHtml(spec.itemsHeading)}</h2>`);
  for (const it of spec.items) {
    parts.push(`<section id="${escapeHtml(it.anchor)}"><h3 style="${H3}">${it.rank}. ${escapeHtml(it.name)}</h3>`);
    parts.push(`<p><b>Best for:</b> ${escapeHtml(it.bestFor)}</p>`);
    parts.push(`<p><b>Verdict:</b> ${escapeHtml(it.verdict)}</p>`);
    for (const p of it.paras) parts.push(`<p>${escapeHtml(p)}</p>`);
    if (it.features?.length) {
      parts.push(`<p><b>Key features</b></p><ul>${it.features.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>`);
    }
    parts.push(`<p><b>Pricing:</b> ${escapeHtml(it.pricing.summary)} <span style="color:#8a8a92;">(as of ${escapeHtml(it.pricing.asOf)})</span></p>`);
    parts.push(`<p><b>Pros</b></p><ul>${it.pros.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`);
    parts.push(`<p><b>Cons</b></p><ul>${it.cons.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`);
    if (it.isUs) {
      parts.push(`<p><a href="${escapeHtml(spec.cta.href)}" style="${GOLD}font-weight:600;">${escapeHtml(spec.cta.label)}</a>${spec.cta.sub ? ` <span style="color:#8a8a92;">${escapeHtml(spec.cta.sub)}</span>` : ''}</p>`);
    }
    parts.push(`</section>`);
  }
  parts.push(`</section>`);

  // ── Personas ──
  parts.push(`<section id="personas"><h2 style="${H2}">Which one fits you?</h2><ul>`);
  for (const p of spec.personas) {
    parts.push(`<li><b>${escapeHtml(p.who)}:</b> ${escapeHtml(p.pick)} — ${escapeHtml(p.why)}</li>`);
  }
  parts.push(`</ul></section>`);

  // ── Honorable mentions ──
  parts.push(`<section id="mentions"><h2 style="${H2}">Honorable mentions</h2><ul>`);
  for (const m of spec.honorableMentions) {
    parts.push(`<li><b>${escapeHtml(m.name)}:</b> ${escapeHtml(m.note)}</li>`);
  }
  parts.push(`</ul></section>`);

  // ── Honest accounting (where the incumbent still wins) ──
  parts.push(`<section id="honest"><h2 style="${H2}">${escapeHtml(spec.honestAccounting.heading)}</h2>`);
  for (const p of spec.honestAccounting.paras) parts.push(`<p>${escapeHtml(p)}</p>`);
  if (spec.honestAccounting.points?.length) {
    parts.push(`<ul>${spec.honestAccounting.points.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`);
  }
  parts.push(`</section>`);

  // ── Template strip: real boards to open / copy (conversion path) ──
  if (Array.isArray(spec.exampleSlugs) && spec.exampleSlugs.length) {
    parts.push(`<section><h2 style="${H2}">Steal these boards</h2><p>Real boards published from Clusters — open one live, pan around, and use it as a template.</p><ul>`);
    for (const slug of spec.exampleSlugs) {
      const label = escapeHtml(String(slug).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
      parts.push(`<li><a href="/c/${escapeHtml(slug)}" style="${GOLD}"><img src="/api/public-thumb/${escapeHtml(slug)}" alt="${label} — example board made with Clusters" loading="lazy" width="320" height="180"> ${label}</a></li>`);
    }
    parts.push(`</ul></section>`);
  }

  // ── FAQ ──
  parts.push(`<section id="faq"><h2 style="${H2}">Frequently asked questions</h2>`);
  for (const f of spec.faq) parts.push(`<h3 style="${H3}">${escapeHtml(f.q)}</h3><p>${escapeHtml(f.a)}</p>`);
  parts.push(`</section>`);

  // ── Author box ──
  parts.push(`<section><h2 style="${H2}">About the author</h2>`);
  parts.push(`<p><b>${escapeHtml(spec.author.name)}</b> — ${escapeHtml(spec.author.role)}</p>`);
  parts.push(`<p style="${MUTED}">${escapeHtml(spec.author.bio)}</p></section>`);

  // ── Related nav ──
  if (spec.related?.length) {
    parts.push(`<nav aria-label="Related pages" style="margin-top:1.6em;"><h2 style="font-size:1.1rem;">Keep exploring</h2><ul>`);
    for (const p of spec.related) parts.push(`<li><a href="${escapeHtml(p)}" style="${GOLD}">${escapeHtml(p)}</a></li>`);
    parts.push(`<li><a href="/explore" style="${GOLD}">Explore example boards</a></li>`);
    parts.push(`<li><a href="/pricing" style="${GOLD}">Pricing</a></li></ul></nav>`);
  }

  return `<div style="max-width:800px;margin:0 auto;padding:14vh 24px 24px;"><article>${parts.join('')}</article></div>`;
}

// Article + ItemList + BreadcrumbList + FAQPage. `og` is the absolute OG-card
// URL (the worker builds it, cache-buster included).
export function buildListicleJsonLd(spec, url, og) {
  const org = { '@type': 'Organization', name: spec.author.name, url: 'https://soleilpictures.com' };
  const graph = [
    {
      '@type': 'WebPage',
      '@id': `${url}#webpage`,
      url,
      name: spec.title,
      description: spec.metaDescription,
      datePublished: spec.published,
      dateModified: spec.updated,
      primaryImageOfPage: { '@type': 'ImageObject', url: og, width: 1200, height: 630 },
    },
    {
      '@type': 'Article',
      '@id': `${url}#article`,
      headline: spec.title,
      description: spec.metaDescription,
      author: org,
      publisher: org,
      datePublished: spec.published,
      dateModified: spec.updated,
      image: og,
      mainEntityOfPage: { '@id': `${url}#webpage` },
    },
    {
      '@type': 'ItemList',
      '@id': `${url}#list`,
      name: spec.h1,
      numberOfItems: spec.items.length,
      itemListElement: spec.items.map((it) => ({
        '@type': 'ListItem',
        position: it.rank,
        name: it.name,
        url: `${url}#${it.anchor}`,
      })),
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: url.replace(/\/best\/.*$/, '/') },
        { '@type': 'ListItem', position: 2, name: spec.h1, item: url },
      ],
    },
  ];
  if (spec.faq?.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${url}#faq`,
      mainEntity: spec.faq.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    });
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}
