// Shared transactional email layout — mirrors supabase/templates/magic_link.html
// aesthetic exactly. Dark background (#0a0a0c), soleil-gold (#ffa500) accents,
// floating wordmark + content + footer. No big white cards.
//
// Used by every Resend-delivered template (waitlist_submitted, waitlist_accepted,
// workspace_invite, board_shared) so the brand surface stays consistent.

export interface RenderEmailOpts {
  preheader: string;
  eyebrow?: string;
  headline: string;
  subtitle?: string;
  bodyHtml?: string;
  cta?: { label: string; url: string };
  caveat?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderEmail(opts: RenderEmailOpts): string {
  const { preheader, eyebrow, headline, subtitle, bodyHtml, cta, caveat } = opts;

  const eyebrowBlock = eyebrow
    ? `
            <tr>
              <td align="center" style="padding-bottom:14px;">
                <div class="gold" style="font:600 11px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; letter-spacing:0.20em; text-transform:uppercase; color:#ffa500;">
                  ${escapeHtml(eyebrow)}
                </div>
              </td>
            </tr>`
    : "";

  const subtitleBlock = subtitle
    ? `
            <tr>
              <td align="center" style="padding-bottom:28px;">
                <div class="ink-2" style="font:400 14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#b3b3b7;">
                  ${escapeHtml(subtitle)}
                </div>
              </td>
            </tr>`
    : "";

  const bodyBlock = bodyHtml
    ? `
            <tr>
              <td align="center" style="padding-bottom:28px;">
                ${bodyHtml}
              </td>
            </tr>`
    : "";

  // Bulletproof CTA — table-based so Outlook + Apple Mail render the
  // button shape correctly. Matches .pricing-cta-primary in styles.css.
  const ctaBlock = cta
    ? `
            <tr>
              <td align="center" style="padding-bottom:14px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
                  <tr>
                    <td align="center" bgcolor="#ffa500" style="background:#ffa500; border-radius:4px;">
                      <a href="${escapeHtml(cta.url)}"
                         style="display:inline-block; padding:0 18px; height:42px; line-height:42px; font:600 14px/42px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#0a0a0c; text-decoration:none; border-radius:4px;">
                        ${escapeHtml(cta.label)}
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:28px;">
                <div class="ink-3" style="font:400 11px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#8a8a8e;">
                  Or copy this link:<br>
                  <a href="${escapeHtml(cta.url)}" style="color:#8a8a8e; text-decoration:underline;">${escapeHtml(cta.url)}</a>
                </div>
              </td>
            </tr>`
    : "";

  const caveatBlock = caveat
    ? `
            <tr>
              <td align="center" style="padding-bottom:8px;">
                <div class="ink-3" style="font:400 12px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#8a8a8e;">
                  ${escapeHtml(caveat)}
                </div>
              </td>
            </tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="dark only">
    <meta name="supported-color-schemes" content="dark only">
    <title>${escapeHtml(headline)}</title>
    <style>
      :root { color-scheme: dark; supported-color-schemes: dark; }
      [data-ogsc] body, [data-ogsb] body { background:#0a0a0c !important; }
      [data-ogsc] .ink-0  { color:#f5f5f7 !important; }
      [data-ogsc] .ink-2  { color:#b3b3b7 !important; }
      [data-ogsc] .ink-3  { color:#8a8a8e !important; }
      [data-ogsc] .gold   { color:#ffa500 !important; }
      .preheader { display:none !important; visibility:hidden; opacity:0; color:transparent; height:0; width:0; }
    </style>
  </head>
  <body class="bg" style="margin:0; padding:0; background:#0a0a0c; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#f5f5f7; -webkit-font-smoothing:antialiased;">
    <span class="preheader">${escapeHtml(preheader)}</span>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0a0a0c;">
      <tr>
        <td align="center" style="padding:64px 20px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:440px;">

            <tr>
              <td align="center" style="padding-bottom:48px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td valign="middle" style="padding-right:12px;">
                      <img
                        src="https://clusters.soleilpictures.com/clusters-logo-dark.png"
                        width="36" height="36" alt=""
                        style="display:block; border:0; outline:none; width:36px; height:36px;">
                    </td>
                    <td valign="middle">
                      <div class="ink-0" style="font:700 22px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; letter-spacing:0.18em; text-transform:uppercase; color:#f5f5f7;">
                        Clusters
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
${eyebrowBlock}
            <tr>
              <td align="center" style="padding-bottom:14px;">
                <div class="ink-0" style="font:600 26px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#f5f5f7; letter-spacing:-0.01em;">
                  ${escapeHtml(headline)}
                </div>
              </td>
            </tr>
${subtitleBlock}${bodyBlock}${ctaBlock}${caveatBlock}
            <tr>
              <td align="center" style="padding-top:40px;">
                <div class="ink-3" style="font:400 11px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#8a8a8e; letter-spacing:0.04em;">
                  © Soleil Pictures · clusters.soleilpictures.com
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

// ── Plain founder-note layout ───────────────────────────────────────────────
// A deliberately un-designed, light, almost-text-only shell for lifecycle email
// (activation nudges + re-engagement). Reads like a note from a person, not a
// marketing blast — left-aligned paragraphs, an inline text-link CTA (no gold
// button), and a small required footer with the postal address + unsubscribe.
//
// bodyHtml is TRUSTED HTML the caller has already escaped (see noteBody in
// templates.ts). cta + unsubscribeUrl are escaped here.

// CAN-SPAM requires a physical mailing address on every marketing email.
export const POSTAL_ADDRESS = "Soleil Pictures · 903 Peachtree St NE, Apt 2709, Atlanta, GA 30309";

export interface RenderPlainNoteOpts {
  preheader: string;
  bodyHtml: string;            // already-escaped <p> paragraphs
  cta?: { label: string; url: string };
  unsubscribeUrl: string;      // required (CAN-SPAM)
}

export function renderPlainNote(opts: RenderPlainNoteOpts): string {
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
