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
