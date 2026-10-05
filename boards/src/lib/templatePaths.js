// Template URL shapes, as pure matchers with no registry attached.
//
// This module exists because of a bug that stayed invisible for two shipped
// versions: the Worker recognised /templates/g/<slug> (its own
// TEMPLATE_PUBLIC_PATH_RE) and the React router did not recognise it at all.
// isTemplatePath matches ONE path segment, so a community template fell through
// to a null landing spec and rendered NotFound. A crawler was served a complete
// page — real title, description, box labels, canonical, noindex — while a
// person clicking the template they had just published got "Page not found".
// Neither half was misbehaving on its own terms, which is why nothing failed.
//
// So the matcher lives in ONE place that both halves import. It is deliberately
// NOT in templateIndex.js, where isTemplatePath is generated: that module carries
// every template's metaDescription and answer, and the client route needs a
// regex, not a prose registry. Data-free, so nothing here has to be generated.

// /templates/g/<slug> → the slug, lowercased. null for anything else.
//
// The 120-char bound mirrors the column; the charset mirrors what
// submit_grid_layout_to_public can mint. Case-insensitive with a lowercased
// result so /templates/g/FOO and /templates/g/foo resolve to one template rather
// than two — the same normalization getTemplateSpec does for our own pages.
export function publicTemplateSlug(pathname) {
  const m = String(pathname || '').match(/^\/templates\/g\/([a-z0-9-]{1,120})\/?$/i);
  return m ? m[1].toLowerCase() : null;
}

// ---------------------------------------------------------------------------
// The store hold
//
// The template store is built and reviewable on the preview deploy, and held
// off production (owner, 2026-10-04: "hold the store, ship the rest"). "The
// store" is everything that came with it, not only the pages: /templates, every
// /templates/<slug> and /templates/g/<slug> item, the /t/<token> share links,
// and in the app the grid tool's Templates panel, Save as template and Share in
// the store. Production had none of it before the hold, so held production
// behaves exactly as it did: the grid tool places the default storyboard.
//
// The flag lives HERE rather than in appHost.js because the Worker has to obey
// it too, and the Worker can read neither import.meta.env nor window. appHost's
// templateStoreAllowed() is the client half of the same rule.
//
// Setting this to false launches the store everywhere at once: the Worker
// serves the pages on every host, the sitemap, IndexNow and /explore list them,
// gen-docs writes the .md mirrors and the llms.txt section, and the canvas shows
// the panel. Two things are hand-written and will go red until they are put
// back, deliberately: the /templates link in index.html's crawlable nav
// (seoLanding.test.mjs) and the store's half of docs/canvas/grids.md.
export const TEMPLATE_STORE_HELD = true;

// Every page URL the store owns: the store front, an item of ours, a community
// item, and a private share link (/t/<uuid>, the shape main.jsx's
// templateShareMatch and the Worker's TEMPLATE_SHARE_PATH_RE accept).
export function isTemplateStorePath(pathname) {
  const p = String(pathname || '');
  return /^\/templates(?:\/.*)?$/i.test(p) || /^\/t\/[0-9a-f-]{36}\/?$/i.test(p);
}

// May this host serve the store? While it is held, only the preview deploy
// (*.workers.dev) — the same allowlist shape as appHost's other holds, so a new
// origin is closed until someone opens it on purpose.
export function templateStoreOpenOn(hostname) {
  return !TEMPLATE_STORE_HELD || /\.workers\.dev$/i.test(String(hostname || ''));
}
