// Where pdf.js finds its character maps and standard fonts. PURE.
//
// Without them pdf.js cannot read the text of a PDF that names a CJK font it
// does not embed (a Japanese PDF with a non-embedded KozMinPro reads as ''),
// and falls back to a generic face for the standard 14. They come from the
// installed pdfjs-dist (Apache-2.0), copied at build by vite.config.js
// (pdfjsAssets) to /pdfjs/<version>/, so a stale copy cannot be served.
export const PDFJS_ASSET_DIRS = ['cmaps', 'standard_fonts'];
export const pdfjsAssetBase = (version) => `/pdfjs/${version}/`;

// The URL must be absolute: getDocument hands cMapUrl to the worker as-is, and
// the worker would resolve a relative one against /assets/pdf.worker...
export function pdfAssetParams(href, version) {
  const base = new URL(pdfjsAssetBase(version), href).href;
  return { cMapUrl: `${base}cmaps/`, cMapPacked: true, standardFontDataUrl: `${base}standard_fonts/` };
}
