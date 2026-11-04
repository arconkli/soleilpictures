// Shared transactional email layout. One shared dark look ("Darkroom") lives in
// theme.ts: near-black page, a lifted card with a hairline, the mark centred
// above it, one white button. No gold anywhere in email.
//
// Used by every Resend-delivered transactional template (waitlist, workspace
// invite, cluster shared, mentions, ...) so the brand surface stays consistent.
// Only the look is here: the words of an email come from the builder.

import { button, eyebrow as eyebrowPiece, footerNote, footerTx, h1, lead, shell, small } from "./theme.ts";

export interface RenderEmailOpts {
  preheader: string;
  eyebrow?: string;
  headline: string;
  subtitle?: string;
  bodyHtml?: string;
  cta?: { label: string; url: string };
  caveat?: string;
  // A one-click link that turns this kind of email off (mentions, replies).
  // Escaped here, like the CTA.
  unsubscribeUrl?: string;
}

export function renderEmail(opts: RenderEmailOpts): string {
  const { preheader, eyebrow, headline, subtitle, bodyHtml, cta, caveat, unsubscribeUrl } = opts;

  let body = "";
  if (eyebrow) body += eyebrowPiece(eyebrow, "center");
  body += h1(headline, "center");
  if (subtitle) body += lead(subtitle, "center");
  if (bodyHtml) body += bodyHtml;
  if (cta) {
    const btn = button(cta.label, cta.url, "center");
    // Every piece before the button ends 28px above it, except the h1 (12px):
    // add the missing 16px as padding on a wrapper.
    body += !subtitle && !bodyHtml
      ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding-top:16px;">${btn}</td></tr></table>`
      : btn;
  }
  if (caveat) body += small(caveat, "center");

  return shell({ title: headline, preheader, body, footer: footerTx(unsubscribeUrl) });
}

// ── Founder-note layout ─────────────────────────────────────────────────────
// Lifecycle email (activation nudges, re-engagement, product updates) and the
// share-activity note. Notes now share the dark card with every other email and
// keep their own voice: left-aligned paragraphs and a left-aligned button, and
// a small required footer with the postal address + unsubscribe.
//
// bodyHtml is TRUSTED HTML the caller has already escaped (see noteBody in
// templates.ts). cta + unsubscribeUrl are escaped here.

// CAN-SPAM requires a physical mailing address on every marketing email.
export const POSTAL_ADDRESS = "Soleil Pictures · 800 Peachtree St NE, Apt 8210, Atlanta, GA 30308";

export interface RenderPlainNoteOpts {
  preheader: string;
  bodyHtml: string;            // already-escaped <p> paragraphs
  cta?: { label: string; url: string };
  unsubscribeUrl: string;      // required (CAN-SPAM)
}

export function renderPlainNote(opts: RenderPlainNoteOpts): string {
  const { preheader, bodyHtml, cta, unsubscribeUrl } = opts;
  const body = cta ? bodyHtml + button(`${cta.label} →`, cta.url, "left") : bodyHtml;
  return shell({ preheader, body, footer: footerNote(POSTAL_ADDRESS, unsubscribeUrl) });
}
