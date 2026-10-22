// A PDF card's page-1 picture (PdfCard.jsx shows it; `src` holds it, the PDF
// itself is `pdfSrc`). uploadPdf draws page 1 as the PDF arrives; when that
// step fails, or the PDF came another way, the card shows the PDF glyph until
// usePdfThumbBackfill draws it for the next writer who opens the board. These
// are that hook's rules, pure so node tests them.
//
// The ways a card ends up without its picture: a tab still running a build
// that has since been replaced can't load pdf.js (its chunk is gone), so the
// upload lands with no picture; a message attachment, an /api/v1 or MCP card
// and a Scout card carry the PDF and never had one.

// pdf.js's names for a file no session will ever draw: locked with a
// password, or not a PDF. Anything else (the network, a stale chunk, memory)
// may go through next time.
const UNREADABLE = new Set(['PasswordException', 'InvalidPDFException']);
export const pdfUnreadable = (err) => UNREADABLE.has(err?.name);

// A card that has its PDF but no picture, isn't still uploading, and hasn't
// been found unreadable (`thumbFailed`). The PDF must be fetchable: R2, or the
// public message-attachments bucket — never a blob: URL from ?local=1.
export function needsPdfThumb(c) {
  return c?.kind === 'pdf' && !c.src && !c.pending && !c.thumbFailed
    && typeof c.pdfSrc === 'string' && /^(r2:|https:)/.test(c.pdfSrc);
}

// A card's height for its page's shape at the card's width, as uploadPdf
// sizes a new card. Null when the page's size isn't known.
export function pdfCardHeight(w, pageW, pageH) {
  if (!(w > 0) || !(pageW > 0) || !(pageH > 0)) return null;
  return Math.max(80, Math.round(w * (pageH / pageW)));
}

// What a finished backfill writes onto the card: the picture, the page count,
// and the page's shape. The picture fills the card (object-fit: cover), so a
// landscape page on the portrait placeholder showed only its middle third.
// A height within 2% of the page's is left alone.
export function pdfThumbPatch(card, { src = null, pageCount = null, width = null, height = null } = {}) {
  const patch = {};
  if (src) patch.src = src;
  if (Number.isFinite(pageCount) && pageCount > 0 && pageCount !== card?.pageCount) patch.pageCount = pageCount;
  const h = src ? pdfCardHeight(card?.w, width, height) : null;
  if (h && !(Math.abs(h - card.h) <= card.h * 0.02)) patch.h = h;
  return patch;
}
