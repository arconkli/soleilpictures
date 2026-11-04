// The old light "note" look, kept for one product_update edition only.
//
// The product_update edition "2026-10-31" was mid-send when every other email
// moved to the dark look, so it must render byte-for-byte as before. These are
// verbatim copies (made before the restyle touched the originals) of exactly
// what that email's HTML used: layout.ts's renderPlainNote, and templates.ts's
// note helpers.
//
// When that edition's send is done, delete the version from
// LEGACY_LOOK_EDITIONS, boards/src/lib/productUpdateLegacy.test.mjs, its
// fixture (productUpdateLegacyFixture.json) and this file.

import { POSTAL_ADDRESS } from "./layout.ts";

export type UpdateItem = string | { lead: string; text: string };

export interface ProductUpdateKit {
  p(text: string): string;                       // one escaped paragraph
  img(src: string, alt: string, href: string): string;
  items(items: UpdateItem[]): string;            // the whole list block, "" when empty
  btn(label: string, url: string): string;       // includes the signed-out caveat when url is not a /resume link
  signoff(lines: string[]): string;              // one paragraph, lines joined by <br>, each escaped
  shell(o: { preheader: string; bodyHtml: string; unsubscribeUrl: string }): string;
}

// ── layout.ts ───────────────────────────────────────────────────────────────

interface RenderPlainNoteOpts {
  preheader: string;
  bodyHtml: string;            // already-escaped <p> paragraphs
  cta?: { label: string; url: string };
  unsubscribeUrl: string;      // required (CAN-SPAM)
}

function renderPlainNote(opts: RenderPlainNoteOpts): string {
  const { preheader, bodyHtml, cta, unsubscribeUrl } = opts;

  const ctaBlock = cta
    ? `
                <p style="margin:4px 0 0; font:600 15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                  <a href="${escapeHtml(cta.url)}" style="color:#1a1a1a; text-decoration:underline;">${escapeHtml(cta.label)} &rarr;</a>
                </p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="light only">
    <meta name="supported-color-schemes" content="light only">
    <style>
      :root { color-scheme: light; supported-color-schemes: light; }
      .preheader { display:none !important; visibility:hidden; opacity:0; color:transparent; height:0; width:0; }
    </style>
  </head>
  <body style="margin:0; padding:0; background:#faf9f7; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#1a1a1a; -webkit-font-smoothing:antialiased;">
    <span class="preheader">${escapeHtml(preheader)}</span>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#faf9f7;">
      <tr>
        <td align="center" style="padding:44px 20px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:480px;">
            <tr>
              <td style="text-align:left;">
                ${bodyHtml}${ctaBlock}
              </td>
            </tr>
            <tr>
              <td style="padding-top:30px;">
                <div style="border-top:1px solid #e7e4df; padding-top:18px; font:400 12px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#8a8780; text-align:left;">
                  ${escapeHtml(POSTAL_ADDRESS)}<br>
                  Not into these? <a href="${escapeHtml(unsubscribeUrl)}" style="color:#8a8780; text-decoration:underline;">Unsubscribe</a>.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// ── templates.ts ────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const NOTE_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const RESUME_URL  = "https://clusters.soleilpictures.com/resume";

function noteP(text: string): string {
  return `<p style="margin:0 0 18px; font:400 15px/1.65 ${NOTE_FONT}; color:#1a1a1a;">${escapeHtml(text)}</p>`;
}

function noteBtn(label: string, url: string): string {
  const walled = !url.startsWith(RESUME_URL);
  const caveat = walled
    ? `\n                <p style="margin:0 0 18px; font:400 12px/1.5 ${NOTE_FONT}; color:#8a8780;">signed out? we'll email you a 6-digit code — no password to dig up.</p>`
    : "";
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:6px 0 ${walled ? "6px" : "18px"};">
                  <tr>
                    <td bgcolor="#1a1a1a" style="background:#1a1a1a; border-radius:8px;">
                      <a href="${escapeHtml(url)}" style="display:inline-block; padding:0 24px; height:46px; line-height:46px; font:600 15px/46px ${NOTE_FONT}; color:#faf9f7; text-decoration:none; border-radius:8px;">${escapeHtml(label)} &rarr;</a>
                    </td>
                  </tr>
                </table>${caveat}`;
}

function noteImg(src: string, alt: string, href: string): string {
  return `<p style="margin:4px 0 18px;"><a href="${escapeHtml(href)}" style="text-decoration:none;"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" width="440" style="width:100%; max-width:440px; height:auto; display:block; border-radius:10px; border:1px solid #e7e4df;"></a></p>`;
}

function productUpdateItemHtml(it: UpdateItem): string {
  const body = typeof it === "string"
    ? escapeHtml(it)
    : `<strong style="font-weight:600;">${escapeHtml(it.lead)}</strong> ${escapeHtml(it.text)}`;
  return `<tr><td style="padding:0 0 9px; font:400 15px/1.6 ${NOTE_FONT}; color:#1a1a1a;"><span style="color:#8a8780;">&middot;</span>&nbsp;&nbsp;${body}</td></tr>`;
}

export const LEGACY_KIT: ProductUpdateKit = {
  p: noteP,
  img: noteImg,
  items: (items) =>
    items.length
      ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 18px;">${items.map(productUpdateItemHtml).join("")}</table>`
      : "",
  btn: noteBtn,
  signoff: (lines) =>
    noteP(lines[0]).replace(/<\/p>$/, lines.slice(1).map((l) => `<br>${escapeHtml(l)}`).join("") + "</p>"),
  shell: ({ preheader, bodyHtml, unsubscribeUrl }) =>
    renderPlainNote({ preheader, bodyHtml, unsubscribeUrl }),
};

// Editions (product_update `version`) that keep the old look.
export const LEGACY_LOOK_EDITIONS: ReadonlySet<string> = new Set(["2026-10-31"]);

export function isLegacyLookEdition(version?: string): boolean {
  return version != null && LEGACY_LOOK_EDITIONS.has(version);
}
