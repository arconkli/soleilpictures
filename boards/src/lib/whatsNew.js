// whatsNew.js — the one-time "New" hint on the Files card (the owner's pick B,
// 2026-10-20), for accounts made before the files sidebar: it names the card
// they haven't seen, on the card itself, with a link to the changelog for the
// rest. Accounts made since SETUP_EPOCH get the setup's tips instead
// (setupTips.js), which point at the same card, so nobody gets both.
//
// Pure and node-testable, like setupTips.js: the words, who gets it, what it
// records and where it sits. components/whatsNew/WhatsNewHint.jsx draws it and
// decides when.

import { SETUP_EPOCH } from './workspaceSetup.js';

export const WHATS_NEW_HINT = 'files_card';            // the hint's name; all its event carries besides the action
export const WHATS_NEW_KEY = 'whats_new_files_card';   // profiles.settings key; WhatsNewHint is its one writer
export const WHATS_NEW_ACTIONS = Object.freeze(['shown', 'dismissed', 'changelog']);
export const CHANGELOG_PATH = '/changelog';            // the newest entry is the top of the page
export const whatsNewFlagKey = (uid) => `soleil.whatsnew.${WHATS_NEW_HINT}.${uid}`;  // this device's mark

export const WHATS_NEW_SETTLE_MS = 4_000;   // the app has been open this long before it shows
export const WHATS_NEW_RETRY_MS = 5_000;    // something else was on screen: look again
export const WHATS_NEW_LOOK_MS = 1_000;     // the card isn't on screen yet (a phone's drawer is shut)
export const WHATS_NEW_GONE_MS = 600;       // what it points at has been gone this long: it's over

// What it points at, and where the cluster's name is read from. On a computer
// the Files card's floating heading, its tail on the word Files (the card's
// header where it doesn't float); in the phone drawer, where the cards are
// display: contents, the cluster's tab in the Files header (the header, once
// another tab is on). It shows only with the card's cluster tab on, the one
// its words describe.
export const WHATS_NEW_ANCHORS = Object.freeze({
  desk: {
    scope: '.sbf-card.is-files:not(.is-folded)',
    anchors: ['.sbf-files-heading .sbf-files-heading-label', '.sbf-files-head'],
    frame: '.sbf-frame',
  },
  phone: {
    scope: '.sidebar.is-mobile-open',
    anchors: ['.sbf-files-head .sbf-tab.is-cluster', '.sbf-files-head'],
    frame: '.sidebar.is-mobile-open',
  },
});
export const CLUSTER_TAB = '.sbf-tab.is-cluster.is-on .sbf-tab-label';

// Whether the account was made before the files sidebar. App asks only this
// before loading the hint: it never changes, so the hint is never unmounted
// mid-show by the record it has just written.
export function predatesFilesSidebar(createdAt) {
  const created = Date.parse(createdAt || '');
  return Number.isFinite(created) && created < Date.parse(SETUP_EPOCH);
}

// Whether this account gets it at all: made before the files sidebar, and no
// record that it was shown on this account or this device.
export function whatsNewEligible({ createdAt, record = null, seenHere = false } = {}) {
  if (record || seenHere) return false;
  return predatesFilesSidebar(createdAt);
}

// The words, for the cluster the card is showing: the look is new, and Files
// keeps any file uploaded to it (the owner, 2026-10-21). The phone's bubble
// sits over the drawer's own list, so it says less.
export function whatsNewCopy({ phone = false, cluster = '' } = {}) {
  const name = String(cluster ?? '').trim() || 'Untitled';
  return {
    eyebrow: 'New',
    title: 'A visual refresh, and a home for your files',
    body: phone
      ? 'Upload any file and it stays here in Files. Search it, or open it as a full page.'
      : `Upload any file and it stays here in Files, whether it’s on a board or not. This lists every file in ${name}. Search it, or open it as a full page.`,
    link: 'What else is new',
    ok: 'Got it',
  };
}

// The record kept on the profile when it shows and again when it ends.
export function whatsNewRecord({ action, now }) {
  return { v: 1, hint: WHATS_NEW_HINT, action: WHATS_NEW_ACTIONS.includes(action) ? action : null, at: now || null };
}

const GAP = 12;      // between what it points at and the bubble
const MARGIN = 10;   // the bubble keeps this far inside the window
const INSET = 8;     // on a phone, from the drawer's edges
const TAIL_AT = 17;  // the tail's middle, this far down a bubble beside the sidebar (the mockup's)
const EDGE = 17;     // and never closer than this to a corner, where its 16px base still clears the rounding

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// How wide it is, decided before it is measured: the mockup's 300 on a
// computer, the drawer's width less its inset on a phone.
export function whatsNewWidth({ phone = false, frame = null, vw }) {
  if (!phone) return Math.min(300, vw - 2 * MARGIN);
  return Math.min(360, (frame?.width || vw) - 2 * INSET);
}

// Where it sits. On a computer beside the sidebar's frame, hanging from the
// Files heading by a tail near its top; with no room there, and always on a
// phone, under what it points at (above it, when the screen ends first), the
// tail on the cluster's tab. `vh` is the window's height: on a phone it may
// cover the bar of the drawer's pinned meter, as the mockup's does, rather
// than turn over onto the clusters.
export function whatsNewPlace({ anchor: a, pop: p, frame = null, vw, vh, phone = false }) {
  const right = frame ? Math.max(a.right, frame.right) : a.right;
  if (!phone && right + GAP + p.width <= vw - MARGIN) {
    const aim = a.top + a.height / 2;
    const top = clamp(aim - TAIL_AT, MARGIN, Math.max(MARGIN, vh - p.height - MARGIN));
    return { side: 'right', left: right + GAP, top, tail: clamp(aim - top, EDGE, p.height - EDGE) };
  }
  const aim = a.width > 200 ? a.left + 40 : a.left + a.width / 2;
  const left = phone && frame
    ? frame.left + INSET
    : clamp(a.left, MARGIN, Math.max(MARGIN, vw - p.width - MARGIN));
  const below = a.bottom + GAP;
  const above = a.top - GAP - p.height;
  const side = below + p.height <= vh - MARGIN || above < MARGIN ? 'bottom' : 'top';
  return { side, left, top: side === 'bottom' ? below : above, tail: clamp(aim - left, EDGE, p.width - EDGE) };
}
