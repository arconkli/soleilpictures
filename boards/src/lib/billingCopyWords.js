// billingCopyWords — billingCopy.js's words, read through Lingui.
//
// App only. billingCopy.js stays exactly as it is, because the Worker's SEO
// pages, gen-docs (the docs), Scout's replies and the Playwright specs read its
// English and cannot use the macros. This module says the same things keyed by
// the same ids with the same English; billingCopyWords.test.mjs holds the two
// together, id by id and case by case.
//
// Every number, price and plan name comes from billingCopy.js and the modules
// it names (demoCardCap, editorLimit, workspaceLimit), as a placeholder, never
// typed into a message. Price labels print exactly as billingCopy's own helpers
// print them.
//
// Tables are getters (or functions), never plain strings: a message read while
// the module loads would freeze the language it loaded in. A getter table must
// not be spread or mapped at module scope; read it at render.

import { t as tr, ph, plural, select } from '@lingui/core/macro';
import {
  PLAN_NAME, PRICING, CREATOR_BENEFITS as BENEFIT_IDS, CREATOR_STORAGE_LABEL, TRIAL_STORAGE_LABEL,
  FREE_STORAGE_LABEL, CREATOR_TRIAL_DAYS, STORAGE_ADDON_HELD, STORAGE_ADDON_BLOCK_LABEL,
  STORAGE_ADDON_MAX_BLOCKS, STORAGE_ADDON_PRICING, PRICING_PAGE as PAGE_IDS, planPerMonth,
  storageAmountLabel as englishStorageAmountLabel,
} from './billingCopy.js';
import { DEMO_CARD_LIMIT } from './demoCardCap.js';
import { EDITOR_LIMIT } from './editorLimit.js';
import { WORKSPACE_LIMIT } from './workspaceLimit.js';
import { formatDate, dollarsText, sizeText } from './intlFormat.js';
import { uiLocale } from './uiLocale.js';

const planName = PLAN_NAME;

// ── billingCopy's labels in the reader's language ───────────────────────────
// billingCopy.js types '$25/mo', '$240/yr' and '1TB' for the docs and the public
// site. In English these return its label exactly; in other languages the
// number is written Intl's way (fr "25 $US", "1 To") inside a whole message.
// Functions, never constants: the language is read when they are called.

const STORAGE_LABEL = /^(\d+)(TB|GB|MB)$/;
const STORAGE_UNITS = { TB: 'terabyte', GB: 'gigabyte', MB: 'megabyte' };

// '1TB' / '5GB' / '100GB' in the reader's language. Unchanged if it doesn't parse.
export function storageLabel(english) {
  const m = STORAGE_LABEL.exec(english);
  if (!m) return english;
  return sizeText(english, Number(m[1]), STORAGE_UNITS[m[2]], 0);
}
export const creatorStorageLabel = () => storageLabel(CREATOR_STORAGE_LABEL);
export const freeStorageLabel = () => storageLabel(FREE_STORAGE_LABEL);
export const trialStorageLabel = () => storageLabel(TRIAL_STORAGE_LABEL);
export const addonBlockLabel = () => storageLabel(STORAGE_ADDON_BLOCK_LABEL);

const pricing = (plan) => (plan === 'annual' ? PRICING.annual : PRICING.monthly);

// '$25/mo' | '$240/yr'
export function billed(plan) {
  const p = pricing(plan);
  if (uiLocale() === 'en') return p.billedLabel;
  const price = dollarsText('', p.billed, 0);
  return plan === 'annual' ? tr`${ph({ price })}/yr` : tr`${ph({ price })}/mo`;
}

// '$25' | '$20', the bare per-month figure.
export function perMonth(plan) {
  const p = pricing(plan);
  return dollarsText(p.perMonthLabel, p.perMonth, 0);
}

// '$60/yr', what the annual plan saves.
export function savings() {
  if (uiLocale() === 'en') return PRICING.annual.savings;
  const amount = PRICING.monthly.perMonth * 12 - PRICING.annual.billed;
  const price = dollarsText('', amount, 0);
  return tr`${ph({ price })}/yr`;
}

// The extra-storage price: '$25/month' | '$240/year'.
export function addonBilled(interval) {
  const priced = interval === 'year' ? STORAGE_ADDON_PRICING.annual : STORAGE_ADDON_PRICING.monthly;
  if (uiLocale() === 'en') return priced.perLabel;
  const price = dollarsText('', priced.billed, 0);
  return interval === 'year' ? tr`${ph({ price })}/year` : tr`${ph({ price })}/month`;
}

// ── Short labels ────────────────────────────────────────────────────────────

// "from $20/mo", the one-line price the ambient surfaces carry.
export function priceFromLabel() {
  const price = perMonth('annual');
  return tr`from ${ph({ price })}/mo`;
}

// "14 days free"
export function trialFromLabel() {
  return tr`${ph({ days: CREATOR_TRIAL_DAYS })} days free`;
}

// "Save 20%"
export function savingsPctLabel() {
  const pct = Math.round((1 - PRICING.annual.perMonth / PRICING.monthly.perMonth) * 100);
  return tr`Save ${pct}%`;
}

// The sub-line under the price on a card: { lead, save }.
export function planBilling(plan) {
  if (plan === 'annual') return { lead: tr`billed annually`, save: tr`Save ${ph({ amount: savings() })}` };
  return { lead: tr`billed monthly`, save: null };
}

// CTA labels — one place so "Get Creator" / "Manage billing" stay consistent.
export const CTA = {
  get getCreator() { return tr`Get ${planName}`; },
  get getCreatorBusy() { return tr`Opening checkout…`; },
  get tryCreator() { return tr`Try ${planName} free for ${ph({ days: CREATOR_TRIAL_DAYS })} days`; },
  get tryCreatorShort() { return tr`Try ${planName} free`; },
  get manageBilling() { return tr`Manage billing →`; },
  get manageBillingBusy() { return tr`Opening…`; },
  subscribeShort: (plan) => {
    const n = planPerMonth(plan);
    const price = dollarsText(`$${n}`, n, (String(n).split('.')[1] || '').length);
    return tr`Subscribe — ${ph({ price })}/mo`;
  },
};

// ── Extra storage ───────────────────────────────────────────────────────────

// Minor units to a label: 1840 → "$18.40", 2500 → "$25".
export function centsLabel(cents) {
  const n = Math.max(0, Math.round(Number(cents) || 0));
  const whole = n % 100 === 0;
  return dollarsText(whole ? `$${n / 100}` : `$${(n / 100).toFixed(2)}`, n / 100, whole ? 0 : 2);
}

// billingCopy's compact byte label ("233 MB", "1.4 GB"), the same number and
// decimals in the reader's language. Null for nothing, never "0 B". The
// components that state an amount of storage read this one; billingCopy's own
// stays English for the docs and the Worker.
export function storageAmountLabel(n) {
  const english = englishStorageAmountLabel(n);
  if (!english) return english;
  const b = Number(n);
  for (const [unit, size] of [['terabyte', 1024 ** 4], ['gigabyte', 1024 ** 3], ['megabyte', 1024 ** 2], ['kilobyte', 1024]]) {
    if (b >= size) {
      const v = b / size;
      const shown = v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
      return sizeText(english, shown, unit, Number.isInteger(shown) ? 0 : 1);
    }
  }
  return sizeText(english, Math.round(b), 'byte', 0);
}

// The extra-storage sheet's words, from the storage-addon function's preview.
export function storageAddonCopy({ interval, amountToday = 0, creditNext = 0, removing = false } = {}) {
  const priced = interval === 'year' ? STORAGE_ADDON_PRICING.annual : STORAGE_ADDON_PRICING.monthly;
  const block = addonBlockLabel();
  if (removing) {
    const credit = centsLabel(creditNext);
    let body;
    if (creditNext > 0) {
      body = interval === 'year'
        ? tr`The unused part of this year comes off your next bill (${credit}). Files you already have stay put.`
        : tr`The unused part of this month comes off your next bill (${credit}). Files you already have stay put.`;
    } else {
      body = tr`Files you already have stay put.`;
    }
    return {
      title: tr`Remove ${block} of extra storage?`,
      body,
      cta: tr`Remove ${block}`,
    };
  }
  const today = centsLabel(amountToday);
  const then = addonBilled(interval);
  return {
    title: tr`Add ${block} more storage`,
    body: interval === 'year'
      ? tr`${today} today for the rest of this year, then ${then}, on the card you pay ${planName} with. You can remove it later in Settings → Plan & billing.`
      : tr`${today} today for the rest of this month, then ${then}, on the card you pay ${planName} with. You can remove it later in Settings → Plan & billing.`,
    cta: tr`Add ${block} — ${then}`,
  };
}

// ── The benefits ────────────────────────────────────────────────────────────

const cardsBody = (n) => tr`The ${n}-card ceiling comes off. Everything you have already made stays exactly where it is.`;

// Same ids and keys as billingCopy's CREATOR_BENEFITS (the keys are the stable
// up_feature_hover keys, never renamed). A getter table: titles and bodies are
// read at render.
export const CREATOR_BENEFITS = [
  {
    key: BENEFIT_IDS[0].key,
    get title() { return tr`Unlimited cards`; },
    get body() { return cardsBody(DEMO_CARD_LIMIT); },
  },
  {
    key: BENEFIT_IDS[1].key,
    get title() { return tr`A ${ph({ CREATOR_STORAGE_LABEL: creatorStorageLabel() })} drive`; },
    get body() { return tr`Free holds ${ph({ FREE_STORAGE_LABEL: freeStorageLabel() })}. ${planName} holds **${ph({ CREATOR_STORAGE_LABEL: creatorStorageLabel() })}** — room for the footage, the camera originals and the project archives.`; },
  },
  {
    key: BENEFIT_IDS[2].key,
    get title() { return tr`Covers your whole workspace`; },
    get body() { return tr`Everyone you invite builds at your limits: up to ${EDITOR_LIMIT} people who edit, anyone who views, and no per-seat charges.`; },
  },
];

// The same benefits, with the cap stated as THIS viewer's. The SAME array
// identity when there is nothing to substitute.
export function creatorBenefits({ cardLimit } = {}) {
  const n = Number(cardLimit);
  if (!Number.isFinite(n) || n <= 0 || n === DEMO_CARD_LIMIT) return CREATOR_BENEFITS;
  return CREATOR_BENEFITS.map((b) => (
    b.key === 'cards'
      ? { key: b.key, title: b.title, body: cardsBody(n) }
      : { key: b.key, title: b.title, body: b.body }
  ));
}

// What the free tier genuinely is. A function, read at render.
export function demoFeatures() {
  return [
    tr`**${DEMO_CARD_LIMIT} cards** to build with`,
    tr`A **${ph({ FREE_STORAGE_LABEL: freeStorageLabel() })}** drive — any file, any size`,
    tr`Clusters are free — they cost none of your cards`,
    tr`Free collaboration — up to ${EDITOR_LIMIT} people who edit`,
  ];
}

// The free plan's limit in one sentence.
export function freeLimitSentence({ cardLimit } = {}) {
  const n = Number(cardLimit);
  const cards = Number.isFinite(n) && n > 0 ? n : DEMO_CARD_LIMIT;
  return tr`${cards} cards or ${ph({ FREE_STORAGE_LABEL: freeStorageLabel() })} of files, whichever comes first`;
}

// ── The walls and the ambient offer ─────────────────────────────────────────

export function storageFullMessage({ own, paid } = {}) {
  if (!own) return tr`This cluster's owner is out of storage — nothing more can be uploaded here until they make room.`;
  if (paid) return tr`Your storage is full. Delete files or empty the trash to make room.`;
  return tr`You've filled your free storage. ${planName} gives you ${ph({ CREATOR_STORAGE_LABEL: creatorStorageLabel() })}.`;
}

export const STORAGE_FULL_COPY = {
  get title() { return tr`Room for everything you make.`; },
  get sub() { return tr`You've filled your free storage. ${planName} gives you ${ph({ CREATOR_STORAGE_LABEL: creatorStorageLabel() })} and unlimited cards — any file, any size.`; },
};

export function firstValueSentence(trialOffer) {
  const storage = creatorStorageLabel();
  if (trialOffer) {
    return tr`${planName} is the complete studio — unlimited cards and a ${storage} drive. Yours free for ${ph({ days: CREATOR_TRIAL_DAYS })} days.`;
  }
  const price = priceFromLabel();
  return tr`${planName} is the complete studio — unlimited cards and a ${storage} drive. Everything your work deserves, ${price}.`;
}

// The approaching-limit toast. Keeps the referral alternative on both variants.
export function nearCapSentence({ count, limit, trialOffer } = {}) {
  if (trialOffer) {
    return tr`You're at ${count}/${limit} cards. ${planName} lifts the cap — free for ${ph({ days: CREATOR_TRIAL_DAYS })} days, or invite friends to earn more free ones.`;
  }
  const price = priceFromLabel();
  return tr`You're at ${count}/${limit} cards. ${planName} lifts the cap, ${price} — or invite friends to earn more free ones.`;
}

// Starting another project near the ceiling. Trial-only: it never carries a price.
export function newProjectSentence({ count, limit } = {}) {
  return tr`New project started. Your free plan's ${limit} cards are shared by every project, and you've used ${count}. ${planName} holds them all — free for ${ph({ days: CREATOR_TRIAL_DAYS })} days.`;
}

// ── The /pricing page ───────────────────────────────────────────────────────

// What the pricing offer says after sign-in for someone who pressed "Get
// Creator" on /pricing first.
export const PRICING_INTENT_COPY = {
  get title() { return tr`Here’s ${planName}, as you picked it.`; },
  get sub() { return tr`You chose it on the pricing page before you signed in.`; },
};

// The pricing page's links to the public tool and ranking pages, by path
// (billingCopy.PRICING_PAGE.moreLinks). The pages themselves stay English.
const MORE_LINK_LABELS = {
  '/tools/free-mood-board-maker': () => tr`Free mood board maker`,
  '/tools/mood-board-maker': () => tr`Mood board maker`,
  '/best/mood-board-apps': () => tr`Mood board apps, ranked`,
};

export const PRICING_PAGE = {
  get h1() { return tr`Start free. Pay when you outgrow it.`; },
  get subhead() {
    const price = billed('monthly');
    return tr`The free plan is a real plan, not a countdown. ${planName} lifts its limits for ${ph({ price })}.`;
  },
  get startFree() { return tr`Start free`; },
  get startFreeSub() { return tr`No credit card. Nothing to install.`; },
  get trustLine() { return tr`Built by a film studio, for real productions.`; },
  shot: {
    slug: PAGE_IDS.shot.slug,
    href: PAGE_IDS.shot.href,
    bar: PAGE_IDS.shot.bar,
    get caption() { return tr`Our own brand book, built in Clusters — open it live and pan around.`; },
  },
  get paidHeading() { return tr`Every plan, line by line`; },
  get paidBody() {
    return tr`These are the only differences. Everything absent from this table is on every plan — files of any size, clusters, editing, sharing, exports, version history, the API.`;
  },
  get workspaceNote() { return tr`One ${planName} plan covers the whole workspace — up to ${EDITOR_LIMIT} people who edit build at your limits, and there are no per-seat charges.`; },
  teamSecurity: {
    get lead() { return tr`Wondering how a team’s work is kept safe?`; },
    get label() { return tr`Read how Clusters handles security`; },
    href: PAGE_IDS.teamSecurity.href,
  },
  moreLinks: {
    get lead() { return tr`See what the free plan makes, or how Clusters compares:`; },
    get links() {
      return PAGE_IDS.moreLinks.links.map((l) => ({ label: MORE_LINK_LABELS[l.href]?.() ?? l.label, href: l.href }));
    },
  },
  get freeCardName() { return tr`Free`; },
  freeCardPrice: PAGE_IDS.freeCardPrice,
  get freeCardUnit() { return tr`forever`; },
  get freeCardSub() { return tr`No card, no clock, no expiry.`; },
  get paidCardSub() { return tr`Cancel any time — your cards stay yours.`; },
  get closing() { return tr`Start with the free plan.`; },
  get closingSub() { return tr`Upgrade when the ${ph({ nth: DEMO_CARD_LIMIT })}th card or the ${ph({ FREE_STORAGE_LABEL: freeStorageLabel() })} drive is in your way, not before.`; },
};

// The comparison, one row per enforced difference. Same keys as billingCopy's.
export const PLAN_COMPARISON = [
  {
    key: 'cards',
    get label() { return tr`Cards`; },
    demo: `${DEMO_CARD_LIMIT}`,
    get creator() { return tr`Unlimited`; },
  },
  {
    key: 'storage',
    get label() { return tr`Storage`; },
    get demo() { return tr`${ph({ FREE_STORAGE_LABEL: freeStorageLabel() })} — any file, any size`; },
    get creator() { return tr`${ph({ CREATOR_STORAGE_LABEL: creatorStorageLabel() })} — any file, any size`; },
  },
  {
    key: 'workspaces',
    get label() { return tr`Workspaces`; },
    demo: String(WORKSPACE_LIMIT),
    creator: String(WORKSPACE_LIMIT),
  },
];

// The questions people actually arrive with. Each answer is one whole message.
export const PRICING_FAQ = [
  {
    get q() { return tr`What is actually limited on the free plan?`; },
    get a() {
      const limit = freeLimitSentence();
      return tr`Two things — how many cards you can have and how much you can store: ${limit}. Any file of any size is welcome on every plan, and clusters are free — they cost none of your cards. People are the same on Free and ${planName}: up to ${EDITOR_LIMIT} who edit, and as many as you like who view.`;
    },
  },
  {
    get q() { return tr`How many workspaces can I have?`; },
    get a() { return tr`Up to ${WORKSPACE_LIMIT} of your own on Free and ${planName}. Workspaces that belong to a team don't count, and Team has no limit.`; },
  },
  {
    get q() { return tr`Do the people I invite need to pay?`; },
    get a() {
      return tr`No. On Free and ${planName}, up to ${EDITOR_LIMIT} people can edit at no cost to them, and anyone can view. What ${planName} does is carry YOUR limits to them: everything they add counts against the workspace owner, so one plan raises the ceiling for everyone working in that workspace. There are no per-seat charges. More than ${EDITOR_LIMIT} people who edit is what Team is for, priced per seat.`;
    },
  },
  {
    get q() { return tr`What happens when I reach ${DEMO_CARD_LIMIT} cards or fill ${ph({ FREE_STORAGE_LABEL: freeStorageLabel() })}?`; },
    get a() {
      return tr`You are told, and asked to upgrade. Nothing you have already made is removed, hidden or locked — you simply cannot add more until you free some room or upgrade. Deleting a file gives its space back within a few minutes, and emptying the trash gives back everything in it at once.`;
    },
  },
  ...(STORAGE_ADDON_HELD ? [] : [{
    get q() { return tr`Can I get more storage?`; },
    get a() {
      const block = addonBlockLabel();
      const max = STORAGE_ADDON_MAX_BLOCKS;
      const monthly = addonBilled('month');
      const annual = addonBilled('year');
      return tr`Yes. On ${planName}, add ${block} at a time, up to ${max} more: ${monthly} on the monthly plan or ${annual} on the annual one, from Settings → Plan & billing, on the card you already pay with. The first charge covers only the rest of your billing period, and while your plan is active you can remove a block again, as long as your files still fit.`;
    },
  }]),
  {
    get q() { return tr`Can I cancel?`; },
    get a() {
      return tr`Any time, from Settings → Billing, and you keep access until the end of the period you have paid for. Afterwards everything over the free allowance stays exactly where it is; you just cannot add more.`;
    },
  },
  {
    get q() { return tr`Do I need to install anything?`; },
    get a() {
      return tr`No. Clusters runs in the browser on desktop, laptop and tablet, and the same board opens on all of them. You can add it to a phone home screen as a web app.`;
    },
  },
];

// ── The offer modal ─────────────────────────────────────────────────────────

// The "what you're on now" row, with the reader's own numbers.
export function currentPlanRow({ cards, limit } = {}) {
  const n = Number(cards);
  const cap = Number(limit);
  const known = Number.isFinite(n) && n >= 0 && Number.isFinite(cap) && cap > 0;
  return {
    name: tr`Free`,
    label: tr`Your plan today`,
    detail: known ? tr`${n} of ${cap} cards` : null,
  };
}

// The price when the trial is on offer.
export function trialPrice(plan) {
  return {
    now: '$0',
    nowUnit: tr`for ${ph({ days: CREATOR_TRIAL_DAYS })} days`,
    then: tr`then ${ph({ price: billed(plan) })}`,
  };
}

export function trialNote(plan) {
  const trialStorage = trialStorageLabel();
  const storage = creatorStorageLabel();
  const price = billed(plan);
  return tr`Card required, nothing charged for ${ph({ days: CREATOR_TRIAL_DAYS })} days, with a ${trialStorage} drive until the first payment unlocks ${storage}. Then ${price} — cancel before the trial ends and you pay nothing.`;
}

// What this person has actually built, in their own numbers.
export function ownWorkSummary({ cards, clusters, storageBytes } = {}) {
  const parts = [];
  const n = Number(cards);
  if (Number.isFinite(n) && n > 0) parts.push(tr`${plural(n, { one: '# card', other: '# cards' })}`);
  const c = Number(clusters);
  if (Number.isFinite(c) && c > 0) parts.push(tr`${plural(c, { one: '# cluster', other: '# clusters' })}`);
  const bytes = storageAmountLabel(storageBytes);
  if (bytes) parts.push(tr`${bytes} of files`);
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} · ${parts[parts.length - 1]}`;
}

// ── The Billing tab ─────────────────────────────────────────────────────────

export function planLabel({ tier, plan, demoCardCount, grantBacked, cardLimit, subscriptionStatus } = {}) {
  if (tier === 'admin') return tr`Admin · Unlimited`;
  if (tier === 'paid') {
    if (grantBacked) return tr`${planName} · Complimentary`;
    if (subscriptionStatus === 'trialing') return tr`${planName} · Trial`;
    const price = billed(plan === 'annual' ? 'annual' : 'monthly');
    return plan === 'annual'
      ? tr`${planName} · Annual (${ph({ price })})`
      : tr`${planName} · Monthly (${ph({ price })})`;
  }
  if (tier === 'demo') {
    const n = Number.isFinite(demoCardCount) ? demoCardCount : 0;
    const cap = Number.isFinite(cardLimit) && cardLimit > 0 ? cardLimit : DEMO_CARD_LIMIT;
    return tr`Free Demo · ${n}/${cap} cards`;
  }
  if (tier === 'waitlist') return tr`Waitlist · not yet active`;
  return '—';
}

// Copy for a complimentary (admin-granted) Creator pass.
export function grantCopy({ grantActive, grantExpiresAt } = {}) {
  if (!grantActive) return null;
  if (!grantExpiresAt) return tr`Complimentary Creator access — granted by Soleil, no end date.`;
  const d = new Date(grantExpiresAt);
  if (Number.isNaN(d.getTime())) return tr`Complimentary Creator access — granted by Soleil.`;
  const when = formatDate(d, { month: 'long', day: 'numeric', year: 'numeric' });
  return tr`Complimentary Creator access — granted by Soleil, through ${when}.`;
}

// `trial` matters: during a trial this date is the FIRST CHARGE, not a renewal.
export function formatPeriodEnd(dateLike, { cancel, trial } = {}) {
  if (!dateLike) return null;
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  return {
    label: cancel ? tr`Ends` : trial ? tr`First charge` : tr`Renews`,
    value: formatDate(d, { month: 'long', day: 'numeric', year: 'numeric' }),
  };
}

// What a subscription status means to the person holding it.
export function statusLabel(status) {
  switch (status) {
    case 'trialing': return tr`On trial`;
    case 'active': return tr`Active`;
    case 'past_due': return tr`Payment failed`;
    case 'unpaid': return tr`Unpaid`;
    case 'paused': return tr`Paused`;
    case 'canceled': return tr`Canceled`;
    case 'incomplete': return tr`Awaiting payment`;
    case 'incomplete_expired': return tr`Expired`;
    default: return status || '—';
  }
}
