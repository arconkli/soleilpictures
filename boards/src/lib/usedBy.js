// "Used by" — the companies our users make their work with, shown as plain
// text under the hero of the homepage and the search pages.
//
// THE RULE: companies only. Never the film, never the people on it. A name
// goes on this list only when a real user's production is made with that
// company, and plain text names only — never a logo (a logo reads as an
// endorsement; a name is a fact). Keep it SHORT: the most recognisable few
// (owner, 2026-10-29). Confirmed by the owner that day: Soleil Pictures, the
// studio that makes Clusters and works in it, leads; Universal Pictures and
// Blumhouse are from one user's feature film (its other producers left off
// to keep the line short); NYU is a user who signed up with an nyu.edu
// address and made a board. Only add a name whose user actually made work
// here, not one who only signed up.
//
// One list, three renderers: the React line (components/public/UsedBy.jsx),
// the Worker's crawlable <main id="seo-fallback"> HTML (worker.js landing +
// lib/seoListicleHtml.js, and the static homepage fallback in index.html),
// and the .md mirrors (scripts/gen-docs.mjs). Same names, same order, same
// pages — that is the anti-cloaking parity, pinned by usedBy.test.mjs.

export const USED_BY_LABEL = 'Used by';

export const USED_BY = Object.freeze([
  'Soleil Pictures',
  'Universal Pictures',
  'Blumhouse',
  'NYU',
]);

// Which landing specs show the line. Storefronts are shops (dated by their
// stock, no studio furniture); /scout is in the registry but has its own
// renderer, which doesn't carry it. Every /best/* listicle shows it.
export function showsUsedBy(spec) {
  return !!spec && !spec.storefront && spec.path !== '/scout';
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// "Used by: Universal Pictures · Blumhouse · …" — the .md mirrors' line and
// the visible text of every renderer.
export function usedByText() {
  return `${USED_BY_LABEL}: ${USED_BY.join(' · ')}`;
}

// The Worker's crawlable copy: one muted paragraph, inline styles only (it
// renders in the pre-hydration document, before any stylesheet).
export function usedByHtml() {
  return `<p style="color:#8a8a92;font-size:.85rem;margin:0 0 1.4em;">${esc(usedByText())}</p>`;
}
