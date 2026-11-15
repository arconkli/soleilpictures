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
import { emailStrings } from "./i18n.mjs";

const APP_URL = "https://clusters.soleilpictures.com/";

export interface TrialEndingEmail {
  subject: string;
  html: string;
  text: string;
}

// Inputs are display strings built by the caller from the subscriptions mirror
// and Stripe's price. Newlines are stripped so nothing can reach a header.
//
// `chargeAt` is the exact moment WITH its zone ("October 15, 2026 at 1:30 AM
// UTC"), never a bare date. Nothing stores the reader's time zone, and a bare
// UTC date names the wrong day for an evening charge anywhere in the Americas:
// someone told "October 15" who cancels that morning has already been charged.
// The headline is relative — "in about three days" is true to within half a
// day for every send, since the job runs daily — and the body gives the moment.
export function renderTrialEnding(
  input: { chargeAt: unknown; amountLabel: unknown },
  locale = "en",
): TrialEndingEmail {
  const s = emailStrings(locale);
  const clean = (v: unknown, fallback: string) =>
    (v == null ? fallback : String(v)).replace(/[\r\n]/g, "").slice(0, 80) || fallback;
  const at = clean(input.chargeAt, s.t("trial_ending.fallback_at"));
  const amount = clean(input.amountLabel, s.t("trial_ending.fallback_amount"));
  const url = `${APP_URL}?settings=billing`;
  const headline = s.t("trial_ending.headline");
  const subtitle = s.t("trial_ending.subtitle", { at, amount });
  const cta = s.t("trial_ending.cta");
  const caveat = s.t("trial_ending.caveat");
  return {
    subject: s.t("trial_ending.subject"),
    html: renderEmail({
      s,
      preheader: s.t("trial_ending.preheader", { at }),
      eyebrow: s.t("trial_ending.eyebrow"),
      headline,
      subtitle,
      cta: { label: cta, url },
      caveat,
    }),
    text: [
      "CLUSTERS",
      headline,
      subtitle,
      s.t("common.label_url", { label: cta, url }),
      caveat,
      "© Soleil Pictures · clusters.soleilpictures.com",
    ].join("\n"),
  };
}

// ── What the cron writes into the email (billing-reconcile-cron) ────────────
// Pure functions, so the cron stays a sender and the words and formats of every
// language live in one place.

// The exact moment the trial ends, with its zone: "October 15, 2026 at 1:30 AM
// UTC". English keeps its own long-standing format; every other language uses
// what Intl writes for it.
export function formatChargeAt(date: Date, locale = "en"): string {
  const s = emailStrings(locale);
  let when: string;
  if (s.locale === "en" || Number.isNaN(date.getTime())) {
    when = date.toLocaleString("en-US", {
      month: "long", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", timeZone: "UTC",
    }).replace(/, (\d{1,2}:\d{2})/, " at $1");
  } else {
    when = new Intl.DateTimeFormat(s.locale, { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(date);
  }
  return s.t("trial_ending.charge_at", { date: when });
}

// What the first charge will be, from Stripe's price: "$12/month", "12 EUR/year"
// in English. `unitAmount` is Stripe's, in hundredths; a whole amount is written
// without decimals. An interval other than month or year is written as Stripe
// names it.
export function formatPriceLabel(
  unitAmount: number, currency: string | undefined, interval: string, locale = "en",
): string {
  const s = emailStrings(locale);
  const whole = unitAmount % 100 === 0;
  const code = (currency || "usd").toUpperCase();
  let price: string | undefined;
  if (s.locale !== "en") {
    try {
      price = new Intl.NumberFormat(s.locale, {
        style: "currency", currency: code,
        minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2,
      }).format(unitAmount / 100);
    } catch { /* an unknown currency code: written the English way below */ }
  }
  if (price === undefined) {
    const amount = whole ? String(unitAmount / 100) : (unitAmount / 100).toFixed(2);
    const symbol = (currency || "usd").toLowerCase() === "usd" ? "$" : "";
    const suffix = symbol ? "" : ` ${(currency || "").toUpperCase()}`;
    price = `${symbol}${amount}${suffix}`;
  }
  if (interval === "month") return s.t("trial_ending.price_month", { price });
  if (interval === "year") return s.t("trial_ending.price_year", { price });
  return `${price}/${interval}`;
}

// When Stripe cannot be reached: the plan's own cadence, never a guessed number.
export function fallbackPriceLabel(cadence: string, locale = "en"): string {
  const s = emailStrings(locale);
  return cadence === "year" ? s.t("trial_ending.fallback_price_year") : s.t("trial_ending.fallback_price_month");
}
