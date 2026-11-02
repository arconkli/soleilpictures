// pdfs.mjs — the PDF filed on a board (the owner, 11-01: "as many of our
// features as possible"): a call sheet, a brief, a schedule or a release form
// Claude wrote in Markdown (recipe.mjs, kind "pdf"), set as a real US Letter
// document by Chromium's own print, the way a PDF someone drops on a board was
// made somewhere else.
//
// A PDF card shows page 1 as its picture (PdfCard.jsx; uploads.js
// uploadPdfPageOne draws it 1024 wide as WebP) and is sized to the page's shape
// (pdfThumb.js pdfCardHeight). The page-1 picture here is the same page drawn
// on screen with the print margins as padding, so it matches the PDF's first
// page line for line.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import MarkdownIt from 'markdown-it';
import sharp from 'sharp';
import { pdfCardHeight } from '../../src/lib/pdfThumb.js';

export const PDF = Object.freeze({
  pageW: 612, pageH: 792, // US Letter in points, as pdf.js reports it
  cssW: 816, cssH: 1056, // the same page in CSS pixels
  margin: 64,
  thumbW: 1024, // uploadPdfPageOne's targetWidth
  cardW: 300, // uploadPdf's card width
});

const md = new MarkdownIt({ html: false, linkify: false, typographer: true });

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** The PDF's page, as HTML: the production up top, the title, the body. Pure. */
export function pdfHtml({ title, markdown, production = '', print = true }) {
  const pad = print ? 0 : PDF.margin;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
@page { size: Letter; margin: ${PDF.margin}px; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #fff; }
body { width: ${print ? 'auto' : `${PDF.cssW}px`}; ${print ? '' : `min-height: ${PDF.cssH}px; padding: ${pad}px;`}
  font: 10.5pt/1.5 "Helvetica Neue", Helvetica, Arial, sans-serif; color: #1c1d1f; -webkit-print-color-adjust: exact; }
.top { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #1c1d1f;
  padding-bottom: 6px; margin-bottom: 18px; font-size: 8pt; letter-spacing: .14em; text-transform: uppercase; color: #55585e; }
.top b { color: #1c1d1f; font-weight: 700; }
h1.doc { font-size: 22pt; line-height: 1.15; margin: 0 0 14px; letter-spacing: -.01em; }
h1, h2, h3 { font-weight: 700; }
main h1 { font-size: 15pt; margin: 18px 0 6px; }
main h2 { font-size: 12.5pt; margin: 16px 0 6px; }
main h3 { font-size: 10.5pt; margin: 14px 0 4px; text-transform: uppercase; letter-spacing: .08em; color: #55585e; }
p { margin: 0 0 8px; }
ul, ol { margin: 0 0 10px; padding-left: 20px; }
li { margin: 2px 0; }
table { width: 100%; border-collapse: collapse; margin: 6px 0 14px; font-size: 9.5pt; }
th { text-align: left; font-size: 8pt; letter-spacing: .08em; text-transform: uppercase; color: #55585e; font-weight: 600;
  border-bottom: 1px solid #1c1d1f; padding: 4px 8px 4px 0; }
td { border-bottom: 1px solid #d9dadc; padding: 5px 8px 5px 0; vertical-align: top; }
blockquote { margin: 8px 0; padding: 2px 0 2px 12px; border-left: 3px solid #c9cacd; color: #3d3f43; }
hr { border: 0; border-top: 1px solid #d9dadc; margin: 14px 0; }
strong { font-weight: 700; }
code { font: 9pt "SF Mono", Menlo, monospace; }
</style></head><body>
<div class="top"><b>${esc(production)}</b><span>${esc(title)}</span></div>
<h1 class="doc">${esc(title)}</h1>
<main>${md.render(String(markdown || '').replace(/^#\s+[^\n]*\n+/, (h) => (h.replace(/^#\s+/, '').trim().toLowerCase() === String(title).trim().toLowerCase() ? '' : h)))}</main>
</body></html>`;
}

/** How many pages a PDF holds, read from its bytes (Chromium writes one /Type /Page per page). Pure. */
export function pageCountOf(bytes) {
  const s = Buffer.from(bytes).toString('latin1');
  return (s.match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length || null;
}

export const fileName = (title) => `${String(title || 'Document').replace(/\s*[—–]\s*/g, ' - ').replace(/[^a-z0-9 ,.'()&-]/gi, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Document'}.pdf`;

/**
 * Set each PDF item in the recipe as a real PDF and draw its page 1.
 *   browser: a Playwright chromium Browser; dir: where files are kept
 * → { found: Map(key → pdf), missing: [key] }
 *   pdf: { file, thumb, sha, thumbSha, pageCount, bytes, name, w, h, width, height }
 */
export async function makePdfs(recipe, { browser, dir, log = () => {} }) {
  const found = new Map();
  const missing = [];
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const production = String(recipe.title || '').replace(/\s+[—–-]\s+.*$/, '');
  const items = [];
  (recipe.sections || []).forEach((s, si) => (s.items || []).forEach((it, ii) => {
    if (it?.kind === 'pdf') items.push({ it, key: `${si}.${ii}` });
  }));
  for (const { it, key } of items) {
    const ctx = await browser.newContext({ viewport: { width: PDF.cssW, height: PDF.cssH }, deviceScaleFactor: PDF.thumbW / PDF.cssW });
    try {
      const page = await ctx.newPage();
      const args = { title: String(it.title || 'Document'), markdown: it.markdown, production };
      await page.setContent(pdfHtml({ ...args, print: true }), { waitUntil: 'load' });
      const pdfBuf = await page.pdf({ format: 'Letter', printBackground: true, preferCSSPageSize: true });
      await page.setContent(pdfHtml({ ...args, print: false }), { waitUntil: 'load' });
      const png = await page.screenshot({ clip: { x: 0, y: 0, width: PDF.cssW, height: PDF.cssH } });
      const webp = await sharp(png).resize({ width: PDF.thumbW }).webp({ quality: 86 }).toBuffer();
      const sha = createHash('sha1').update(pdfBuf).digest('hex');
      const thumbSha = createHash('sha1').update(webp).digest('hex');
      const file = join(dir, `${sha}.pdf`);
      const thumb = join(dir, `${thumbSha}.webp`);
      writeFileSync(file, pdfBuf);
      writeFileSync(thumb, webp);
      const pdf = {
        media: 'pdf', file, thumb, sha, thumbSha, pageCount: pageCountOf(readFileSync(file)), bytes: statSync(file).size,
        name: fileName(it.title), w: PDF.cardW, h: pdfCardHeight(PDF.cardW, PDF.pageW, PDF.pageH),
        width: PDF.pageW, height: PDF.pageH,
      };
      found.set(key, pdf);
      log(`pdf: "${it.title}" → ${pdf.pageCount} page${pdf.pageCount === 1 ? '' : 's'}`);
    } catch (e) {
      log(`pdf: "${it.title}" failed (${e.message})`);
      missing.push(key);
    } finally {
      await ctx.close().catch(() => {});
    }
  }
  return { found, missing };
}
