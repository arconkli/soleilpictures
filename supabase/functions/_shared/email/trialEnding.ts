// The Creator trial ends soon and the card on file will be charged.
//
// Billing, not marketing: it goes to everyone on a trial whatever their email
// preferences, carries no unsubscribe link, and sends from the inbox a person
// reads. Sent once, about three days ahead, by billing-reconcile-cron off the
// subscriptions mirror (migration 0345) — so it does not depend on which events
// the Stripe webhook endpoint happens to be subscribed to. A charge nobody saw
// coming is the worst outcome a trial can have, and the success page and
// Settings already promise the date.
//
// Its own module rather than an entry in templates.ts on purpose: the shared
// sender (send-transactional-email) carries every other email the product
// sends, and a billing reminder is not a reason to redeploy all of them.

import { renderEmail } from "./layout.ts";

const APP_URL = "https://clusters.soleilpictures.com/";

export interface TrialEndingEmail {
  subject: string;
  html: string;
  text: string;
}

// Inputs are display strings built by the caller from the subscriptions mirror
// and Stripe's price. Newlines are stripped so nothing can reach a header.
export function renderTrialEnding(input: { firstChargeDate: unknown; amountLabel: unknown }): TrialEndingEmail {
  const clean = (v: unknown, fallback: string) =>
    (v == null ? fallback : String(v)).replace(/[\r\n]/g, "").slice(0, 40) || fallback;
  const date = clean(input.firstChargeDate, "soon");
  const amount = clean(input.amountLabel, "the Creator price");
  const url = `${APP_URL}?settings=billing`;
  const headline = `Your Creator trial ends ${date}.`;
  const subtitle = `If you keep Creator, your card will be charged ${amount} that day. ` +
    `To stop it, cancel before then in Settings → Plan & billing — you won't be charged, ` +
    `and everything you've made stays exactly where it is.`;
  return {
    subject: `Your Creator trial ends ${date}`,
    html: renderEmail({
      preheader: `Nothing has been charged yet. Your first charge is ${date}.`,
      eyebrow: "Creator trial",
      headline,
      subtitle,
      cta: { label: "Manage billing", url },
      caveat: "Questions? Reply to this email — a person reads it.",
    }),
    text: [
      "CLUSTERS",
      headline,
      subtitle,
      "Manage billing: " + url,
      "Questions? Reply to this email — a person reads it.",
      "© Soleil Pictures · clusters.soleilpictures.com",
    ].join("\n"),
  };
}
