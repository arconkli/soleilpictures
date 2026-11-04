// The email look: "Darkroom". Near-black page, a softly lifted card with a
// hairline, the mark centred above it, one white button. It is the same dark
// look as the website and the app, built as real email HTML (tables, inline
// styles, a small <style> for phones).
//
// Only the look lives here. The words of an email (its text part, its copy)
// never change when the look does.
//
// Gold (--soleil) is reserved for active / focus states in the app. It is never
// used in email, so no gold appears in this file.
//
// Trusted-html convention: every piece returns an HTML string and escapes what
// it is given, except the ones documented as taking TRUSTED html (`p`, and the
// `body` / `footer` of `shell`). Trusted html is html the caller has already
// built from these pieces or escaped itself.

export const T = {
  page: "#0a0a0c",
  card: "#121215",
  cardLine: "#222227",
  panel: "#1a1a1e",
  line: "#2a2a30",
  ink0: "#f5f5f7",
  ink1: "#d0d0d4",
  ink2: "#a0a0a8",
  ink3: "#80808a",
  btn: "#f5f5f7",
  btnInk: "#0a0a0c",
  avatar: "#2a2a30",
  avatarInk: "#d0d0d4",
} as const;

export const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
export const MONO = "ui-monospace,'SF Mono',SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

export const MARK_URL = "https://clusters.soleilpictures.com/email/mark-dark-84.png";
export const SITE_URL = "https://clusters.soleilpictures.com/";

export function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Transactional emails are centred, notes are left.
export type Align = "center" | "left";

export function eyebrow(text: string, align: Align): string {
  return `<div class="ink2" style="margin:0 0 12px;font:600 11px/1.4 ${SANS};letter-spacing:0.16em;text-transform:uppercase;color:${T.ink2};text-align:${align};">${esc(text)}</div>`;
}

export function h1(text: string, align: Align): string {
  return `<h1 class="ink0 h1" style="margin:0 0 12px;font:700 ${align === "center" ? 28 : 26}px/1.22 ${SANS};letter-spacing:-0.02em;color:${T.ink0};text-align:${align};">${esc(text)}</h1>`;
}

export function lead(text: string, align: Align): string {
  return `<p class="ink1" style="margin:0 0 28px;font:400 16px/1.6 ${SANS};color:${T.ink1};text-align:${align};">${esc(text)}</p>`;
}

// TRUSTED html.
export function p(html: string, align: Align): string {
  return `<p class="ink1" style="margin:0 0 18px;font:400 16px/1.6 ${SANS};color:${T.ink1};text-align:${align};">${html}</p>`;
}

export function pText(text: string, align: Align): string {
  return p(esc(text), align);
}

export function small(text: string, align: Align): string {
  return `<p class="ink2" style="margin:20px 0 0;font:400 13px/1.55 ${SANS};color:${T.ink2};text-align:${align};">${esc(text)}</p>`;
}

export function button(label: string, url: string, align: Align, caveat?: string): string {
  const note = align === "left";
  const bottom = caveat ? "8px" : "22px";
  const margin = note
    ? `margin:0;margin-top:4px;margin-bottom:${bottom};`
    : caveat
      ? "margin:0 auto 8px;"
      : "margin:0 auto;";
  const btn = `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="${margin}"><tr><td class="btn" bgcolor="${T.btn}" style="background:${T.btn};border-radius:8px;mso-padding-alt:13px 22px;">
        <a class="btnt" href="${esc(url)}" style="display:inline-block;padding:13px 22px;font:600 15px/20px ${SANS};color:${T.btnInk};text-decoration:none;border-radius:8px;">${esc(label)}</a>
      </td></tr></table>`;
  if (!caveat) return btn;
  return `${btn}<p class="ink2" style="margin:0 0 18px;font:400 13px/1.55 ${SANS};color:${T.ink2};text-align:${align};">${esc(caveat)}</p>`;
}

export function codeTile(code: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:0 0 16px;"><tr><td class="panel" align="center" style="background:${T.panel};border-radius:12px;padding:22px 12px;">
        <span class="ink0" style="font:600 34px/1 ${MONO};letter-spacing:0.32em;color:${T.ink0};padding-left:0.32em;">${esc(code)}</span>
      </td></tr></table>`;
}

// The line above the quote (the subtitle) already says where it was written,
// so the quote names only who wrote it.
export function quote(o: { who?: string; text: string }): string {
  const text = `<p class="ink1" style="margin:${o.who ? "10px" : "0"} 0 0;font:400 15px/1.6 ${SANS};color:${T.ink1};">${esc(o.text)}</p>`;
  let head = "";
  if (o.who) {
    const initials = o.who.split(/\s+/).filter(Boolean).map((w) => Array.from(w)[0]).slice(0, 2).join("").toUpperCase();
    head = `<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
          <td class="avatar" width="28" height="28" align="center" valign="middle" style="width:28px;height:28px;border-radius:14px;background:${T.avatar};font:600 11px/28px ${SANS};color:${T.avatarInk};">${esc(initials)}</td>
          <td style="padding-left:10px;font:600 14px/1.3 ${SANS};"><span class="ink0" style="color:${T.ink0};">${esc(o.who)}</span></td>
        </tr></table>
        `;
  }
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:0 0 28px;"><tr><td class="panel" style="background:${T.panel};border-radius:12px;padding:16px 18px;text-align:left;">
        ${head}${text}
      </td></tr></table>`;
}

// 478 = the card's inner width: 560 - 2 border - 80 padding.
export function picture(src: string, alt: string, href: string): string {
  return `<p style="margin:2px 0 20px;"><a href="${esc(href)}" style="text-decoration:none;"><img class="line" src="${esc(src)}" width="478" alt="${esc(alt)}" style="display:block;width:100%;max-width:478px;height:auto;border:1px solid ${T.line};border-radius:12px;"></a></p>`;
}

export function list(items: Array<string | { lead: string; text: string }>): string {
  const rows = items.map((it) => {
    const body = typeof it === "string"
      ? esc(it)
      : `<strong class="ink0" style="font-weight:600;color:${T.ink0};">${esc(it.lead)}</strong> ${esc(it.text)}`;
    return `<tr>
          <td class="ink3" valign="top" width="18" style="width:18px;padding:0 0 12px;font:400 16px/1.6 ${SANS};color:${T.ink3};">&bull;</td>
          <td class="ink1" valign="top" style="padding:0 0 12px;font:400 16px/1.6 ${SANS};color:${T.ink1};">${body}</td>
        </tr>`;
  }).join("");
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:4px 0 14px;">${rows}</table>`;
}

export function signoff(lines: string[]): string {
  return `<p class="ink1" style="margin:4px 0 0;font:400 16px/1.6 ${SANS};color:${T.ink1};">${lines.map(esc).join("<br>")}</p>`;
}

export interface StripTile { url?: string; w?: number; h?: number; kind: string; label?: string; alt?: string }

// Contain-fit a photo into the 110x136 inside of a tile box.
function fitPhoto(w?: number, h?: number): { w: number; h?: number } {
  if (w && h && w > 0 && h > 0) {
    const s = Math.min(110 / w, 136 / h);
    // Width rounds DOWN: the photo's height follows its width (height:auto), so
    // a width rounded up would draw it a pixel or two taller than the box.
    return { w: Math.max(1, Math.floor(w * s + 1e-9)), h: Math.max(1, Math.round(h * s)) };
  }
  return { w: 110 };
}

export function strip(tiles: StripTile[], href: string): string {
  const cells = tiles.map((tile) => {
    let inner: string;
    if (tile.url) {
      const f = fitPhoto(tile.w, tile.h);
      inner = `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:112px;"><tr><td class="panel line tbox" valign="middle" align="center" height="136" style="height:136px;background:${T.panel};border:1px solid ${T.line};border-radius:10px;padding:0;">
            <img class="pimg" src="${esc(tile.url)}" alt="${esc(tile.alt ?? "")}" width="${f.w}"${f.h ? ` height="${f.h}"` : ""} style="display:block;margin:0 auto;${f.h ? `width:${f.w}px;max-width:100%;height:auto;` : `width:auto;max-width:100%;height:auto;max-height:136px;`}border:0;border-radius:9px;">
          </td></tr></table>`;
    } else {
      inner = `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:112px;"><tr><td class="panel line tbox" valign="top" align="left" height="136" style="height:136px;background:${T.panel};border:1px solid ${T.line};border-radius:10px;padding:0;text-align:left;word-break:break-word;">
            <div class="tpad" style="padding:10px;"><div class="ink2" style="font:600 10px/1.3 ${SANS};letter-spacing:0.08em;text-transform:uppercase;color:${T.ink2};margin:0 0 6px;">${esc(tile.kind)}</div>
            <div class="ink0 ttxt" style="font:500 13px/1.35 ${SANS};color:${T.ink0};max-height:88px;overflow:hidden;">${esc(tile.label ?? "")}</div></div>
          </td></tr></table>`;
    }
    return `<td width="25%" valign="top" style="padding:0 8px 0 0;"><a href="${esc(href)}" style="text-decoration:none;">${inner}</a></td>`;
  }).join("");
  // Fewer than four tiles: empty cells hold the rest of the row, so a table
  // never stretches two or three tiles across the whole card.
  const fill = `<td class="fill" width="25%" style="padding:0 8px 0 0;"></td>`.repeat(Math.max(0, 4 - tiles.length));
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:0 0 20px;"><tr>${cells}${fill}</tr></table>`;
}

function footerRow(lines: string[]): string {
  return `<tr><td align="center" style="padding:24px 8px 0;">
    <div class="ink3" style="font:400 12px/1.7 ${SANS};color:${T.ink3};text-align:center;">${lines.join("<br>")}</div>
  </td></tr>`;
}

function footerLink(href: string, label: string): string {
  return `<a class="ink3" href="${esc(href)}" style="color:${T.ink3};text-decoration:underline;">${esc(label)}</a>`;
}

export function footerTx(unsubscribeUrl?: string): string {
  const lines = [`Clusters by Soleil Pictures · ${footerLink(SITE_URL, "clusters.soleilpictures.com")}`];
  if (unsubscribeUrl) lines.push(footerLink(unsubscribeUrl, "Turn these emails off"));
  return footerRow(lines);
}

export function footerNote(postalAddress: string, unsubscribeUrl: string): string {
  return footerRow([esc(postalAddress), `Not into these? ${footerLink(unsubscribeUrl, "Unsubscribe")}.`]);
}

const PREHEADER_PAD = "&zwnj;&nbsp;".repeat(30);

// `body` and `footer` are TRUSTED html (built from the pieces above).
export function shell(o: { title?: string; preheader: string; body: string; footer: string }): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="dark only">
<meta name="supported-color-schemes" content="dark only">
${o.title ? `<title>${esc(o.title)}</title>\n` : ""}<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  body { margin:0; padding:0; }
  h1 { margin:0; }
  @media (max-width: 480px) {
    .outer { padding:28px 16px 36px !important; }
    .cardpad { padding:28px 22px 26px !important; }
    .h1 { font-size:24px !important; }
    .ttxt { font-size:11px !important; max-height:45px !important; }
    .tpad { padding:7px !important; }
    .tbox { height:82px !important; }
    .pimg { width:auto !important; max-width:100% !important; height:auto !important; max-height:80px !important; }
  }
</style>
<!-- Three style blocks on purpose: Gmail drops a whole block it does not
     accept, so the phone rules above never share one with :root or the
     attribute selectors below. -->
<style>
  :root { color-scheme: dark; supported-color-schemes: dark; }
</style>
<style>
  /* Dark-mode hardening. Outlook.com and the Outlook apps mark what their dark
     mode recoloured with data-ogsc (text) / data-ogsb (backgrounds); these put
     back our own colours, so the white button stays white. Nothing else is
     added on purpose: Gmail ignores color-scheme, and the background-image and
     blend-mode tricks for Gmail iOS can protect a background while its text is
     still inverted, which is worse than Gmail's own consistent inversion. */
  [data-ogsc] .ink0 { color:${T.ink0} !important; }
  [data-ogsc] .ink1 { color:${T.ink1} !important; }
  [data-ogsc] .ink2 { color:${T.ink2} !important; }
  [data-ogsc] .ink3 { color:${T.ink3} !important; }
  [data-ogsc] .btnt { color:${T.btnInk} !important; }
  [data-ogsc] .avatar { color:${T.avatarInk} !important; }
  [data-ogsb] .bg { background:${T.page} !important; }
  [data-ogsb] .card { background:${T.card} !important; }
  [data-ogsb] .panel { background:${T.panel} !important; }
  [data-ogsb] .btn { background:${T.btn} !important; }
  [data-ogsb] .avatar { background:${T.avatar} !important; }
</style>
</head>
<body class="bg" bgcolor="${T.page}" style="margin:0;padding:0;background:${T.page};-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(o.preheader)}${PREHEADER_PAD}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="bg" bgcolor="${T.page}" style="background:${T.page};">
  <tr><td align="center" class="outer" style="padding:44px 20px 48px;">
    <!--[if mso]><table role="presentation" width="560" align="center" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;">
      <tr><td align="center" style="padding:0 0 24px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;"><tr>
          <td valign="middle" style="padding-right:10px;"><img src="${MARK_URL}" width="28" height="28" alt="" style="display:block;width:28px;height:28px;border:0;"></td>
          <td valign="middle"><span class="ink0" style="font:700 13px/1 ${SANS};letter-spacing:0.2em;text-transform:uppercase;color:${T.ink0};">Clusters</span></td>
        </tr></table>
      </td></tr>
      <tr><td class="card cardpad" bgcolor="${T.card}" style="background:${T.card};border:1px solid ${T.cardLine};border-radius:16px;padding:40px 40px 36px;">
        ${o.body}
      </td></tr>
      ${o.footer}
    </table>
    <!--[if mso]></td></tr></table><![endif]-->
  </td></tr>
</table>
</body>
</html>`;
}
