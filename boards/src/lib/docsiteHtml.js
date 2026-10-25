// docsiteHtml — where a /docs page's crawlable HTML is kept in the assets.
//
// scripts/gen-docs.mjs renders each page's body to escaped HTML, from the same
// parse React renders from, and writes it to public/docs-html; the Worker reads
// the one page it is serving through env.ASSETS and injects it into
// <main id="seo-fallback">. Every page's HTML was bundled into the Worker
// (lib/docsiteCrawlable.js) until 2026-10-25, when the docs outgrew the budget
// docsite.test.mjs holds the Worker's docs weight to.
//
// Pure: gen-docs, the Worker and the tests share these.

// '/docs/api/cards' → '/docs-html/docs/api/cards.json'; the hub, '/docs-html/docs.json'.
export const docsHtmlAsset = (path) => `/docs-html${path}.json`;

// A page's file: its path beside its HTML.
export const docsHtmlFile = (path, html) => `${JSON.stringify({ path, html })}\n`;

// The HTML in a file, only when the file is that page's. The assets answer a
// missing file with the app's index.html (the single-page-application
// fallback), which must never become a page's body. Null otherwise.
export function docsHtmlFrom(text, path) {
  try {
    const file = JSON.parse(text);
    return file && file.path === path && typeof file.html === 'string' ? file.html : null;
  } catch (_) {
    return null;
  }
}
