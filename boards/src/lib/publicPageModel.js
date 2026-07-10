// Shared page model for the /c/<slug> editorial article.
//
// Imported by BOTH the Cloudflare worker (crawlable HTML injected into
// #seo-fallback) and the React PublicBoardView article — one source of
// structure and ordering means the crawler and the human see the same
// content in the same order (anti-cloaking parity by construction, same
// pattern as seoLanding.js). Pure data-in/data-out; no DOM, no React.
//
// Input cards come from get_public_board_page (migration 0181): flat,
// spatially ordered, all kinds, with `section_header`/`sub` marking section
// starts and `legacy_i` giving image cards their frozen /api/public-img index.

import { matchToolPath } from './seoLanding.js';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const SAFE_HREF = /^https?:\/\//i;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
// 'YYYY-MM-DD' → 'July 8, 2026'. Shared by both renderers so the crawlable
// text and the React article show the identical string.
export function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return iso || '';
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

// Group the flat spatial card array into titled sections. Cards before the
// first header form an untitled lead section. The generator's credits note
// becomes model.credits (rendered as a footer, not an item).
export function buildPageModel(meta, cards, related) {
  const m = meta || {};
  const sections = [];
  let current = { id: 'lead', heading: null, sub: null, items: [] };
  let credits = null;
  for (const c of (cards || [])) {
    if (!c || c.kind === 'art') continue; // art canvases have no article form
    if (c.card_id === 'note-credits') { credits = c.body || null; continue; }
    if (c.section_header) {
      if (current.items.length || current.heading) sections.push(current);
      // Header notes carry "TITLE\nsub" in body; title field is empty. Use the
      // first body line as the heading, meta.sub as the deck.
      const headText = (c.title || (c.body || '').split('\n')[0] || '').trim();
      current = { id: c.card_id, heading: headText || null, sub: c.sub || null, items: [] };
      continue;
    }
    // Skip content-free items (an image without media never renders anywhere).
    if (c.kind === 'image' && c.legacy_i == null) continue;
    if (c.kind === 'note' && !(c.body || '').trim()) continue;
    current.items.push(c);
  }
  if (current.items.length || current.heading) sections.push(current);

  const faq = Array.isArray(m.faq) ? m.faq.filter((f) => f && f.q && f.a) : [];
  return {
    slug: m.slug || '',
    h1: m.seo_title || m.name || '',
    description: m.seo_description || '',
    answer: m.answer || '',
    body: m.seo_body || '',
    updated: (m.updated_at || '').slice(0, 10),
    updatedText: formatDate((m.updated_at || '').slice(0, 10)),
    published: (m.published_at || '').slice(0, 10),
    toolPath: matchToolPath(`${m.name || ''} ${m.target_keyword || ''}`),
    isTemplate: !!m.is_template,
    faq,
    credits,
    sections,
    related: Array.isArray(related)
      ? related.map((r) => ({ slug: r.slug, title: r.seo_title || r.slug })).filter((r) => r.slug)
      : [],
  };
}

// ── Worker-side HTML ────────────────────────────────────────────────────────
// Rendered into <main id="seo-fallback"> — what crawlers, AI agents, and no-JS
// visitors read. The React article renders the SAME model in the same order.

function itemHtml(item, slug) {
  const t = item.title ? esc(item.title) : '';
  switch (item.kind) {
    case 'image': {
      const alt = esc(item.media?.alt || item.title || '');
      const cap = item.body ? `<figcaption>${t ? `<b>${t}</b> — ` : ''}${esc(item.body)}</figcaption>`
                            : (t ? `<figcaption><b>${t}</b></figcaption>` : '');
      return `<figure><img src="/api/public-img/${esc(slug)}?i=${Number(item.legacy_i)}" alt="${alt}" loading="lazy" width="640" height="480">${cap}</figure>`;
    }
    case 'palette': {
      const sw = (item.swatches || []).map((s) =>
        `<li>${esc(s.name || '')}${s.name ? ' — ' : ''}<code>${esc(s.hex || '')}</code></li>`).join('');
      return `<div class="pa-palette">${t ? `<h3>${t}</h3>` : ''}<ul>${sw}</ul></div>`;
    }
    case 'schedule': {
      const rows = (item.rows || []).map((r) =>
        `<tr><td>${esc(r.day || '')}</td><td>${esc(r.what || '')}</td><td>${esc(r.loc || '')}</td></tr>`).join('');
      return `<div class="pa-table">${t ? `<h3>${t}</h3>` : ''}<table><tbody>${rows}</tbody></table></div>`;
    }
    case 'grid': {
      const texts = (item.cells || []).filter((c) => c && c.type === 'text' && (c.text || '').trim());
      const imgs = (item.cells || []).filter((c) => c && c.type === 'image').length;
      const list = texts.map((c) => `<li>${esc(c.text)}</li>`).join('');
      const note = imgs ? `<p>A ${esc(String(item.grid_dims?.rows ?? ''))}×${esc(String(item.grid_dims?.cols ?? ''))} visual grid${t ? ` — ${t}` : ''} (${imgs} images${texts.length ? ` and ${texts.length} notes` : ''}) — view it on the board above.</p>` : '';
      return `<div class="pa-grid">${t && !imgs ? `<h3>${t}</h3>` : ''}${note}${list ? `<ul>${list}</ul>` : ''}</div>`;
    }
    case 'link': {
      const href = SAFE_HREF.test(item.href || '') ? item.href : null;
      const label = t || esc(item.href || '');
      const body = item.body ? `<p>${esc(item.body)}</p>` : '';
      return href
        ? `<div class="pa-link"><a href="${esc(href)}" rel="noopener nofollow">${label}</a>${body}</div>`
        : `<div class="pa-link">${label}${body}</div>`;
    }
    case 'doc':
      return `<div class="pa-doc">${t ? `<h3>${t}</h3>` : ''}${(item.body || '').split('\n').filter(Boolean)
        .map((l) => `<p>${esc(l)}</p>`).join('')}</div>`;
    case 'video':
      return `<p class="pa-video">▶ ${t ? `<b>${t}</b>` : 'Video'}${item.body ? ` — ${esc(item.body)}` : ''} (plays on the board above)</p>`;
    case 'shape':
      return item.label ? `<p class="pa-shape">${esc(item.label)}</p>` : '';
    case 'board':
    case 'boardlink':
      return `<p class="pa-board">Includes a nested board${t ? `: <b>${t}</b>` : ''}${item.body ? ` — ${esc(item.body)}` : ''} (open it from the canvas above)</p>`;
    case 'note':
    default: {
      const bodyHtml = (item.body || '').split('\n').filter(Boolean).map((l) => esc(l)).join('<br>');
      if (!bodyHtml) return '';
      return `<div class="pa-note">${t ? `<h3>${t}</h3>` : ''}<p>${bodyHtml}</p></div>`;
    }
  }
}

export function renderArticleHtml(model) {
  const s = [];
  s.push(`<h1>${esc(model.h1)}</h1>`);
  if (model.answer) s.push(`<p class="pa-answer"><b>${esc(model.answer)}</b></p>`);
  else if (model.description) s.push(`<p>${esc(model.description)}</p>`);
  if (model.updated) s.push(`<p class="pa-updated">Updated <time datetime="${esc(model.updated)}">${esc(model.updatedText || model.updated)}</time></p>`);
  if (model.body) s.push(`<section class="pa-body">${esc(model.body)}</section>`);

  model.sections.forEach((sec, i) => {
    s.push('<section class="pa-section">');
    if (sec.heading) s.push(`<h2>${esc(sec.heading)}</h2>`);
    if (sec.sub) s.push(`<p class="pa-deck">${esc(sec.sub)}</p>`);
    for (const item of sec.items) s.push(itemHtml(item, model.slug));
    s.push('</section>');
    // One quiet mid-read ask after the first section (mirrored in
    // PublicArticle.jsx — parity by construction).
    if (i === 0 && model.sections.length > 1) {
      s.push('<aside class="pa-midcta"><span><b>Make a board like this — free.</b> Images, notes, palettes, and connections on one canvas.</span> <a href="/">Start a board</a></aside>');
    }
  });

  if (model.faq.length) {
    s.push('<section class="pa-faq"><h2>Frequently asked questions</h2>');
    for (const f of model.faq) s.push(`<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`);
    s.push('</section>');
  }
  if (model.credits) s.push(`<p class="pa-credits">${esc(model.credits)}</p>`);

  if (model.related.length) {
    s.push('<nav aria-label="Related boards"><h2>Related boards</h2><ul>');
    for (const r of model.related) s.push(`<li><a href="/c/${esc(r.slug)}">${esc(r.title)}</a></li>`);
    s.push('</ul></nav>');
  }
  s.push('<nav aria-label="Make it with Clusters">');
  if (model.toolPath) s.push(`<a href="${esc(model.toolPath)}">Make your own — free</a> `);
  s.push('<a href="/use-cases">What you can make with Clusters</a> <a href="/explore">Explore more boards</a></nav>');
  // Inline sizing so no-JS readers get a sane column even without the app CSS.
  return `<div class="pa-wrap" style="max-width:880px;margin:0 auto;padding:24px;"><article class="public-article">${s.join('\n')}</article></div>`;
}
