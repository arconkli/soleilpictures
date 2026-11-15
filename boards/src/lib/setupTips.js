// setupTips.js — the three tips a new account gets in its workspace, once it
// has put something down: where its clusters are, that Files takes any file
// and a pasted link becomes a card, and how to bring work over from Google
// Drive or Dropbox. Every new account gets them, in both arms of
// workspace_setup, so the test isolates the setup steps; the steps' one re-ask
// (workspaceSetup.js reaskDue) goes first when both are due.
//
// Pure and node-testable, like workspaceSetup.js: the host passes the gates,
// the clock and what is on screen. components/setup/SetupTips.jsx draws them.

import { SETUP_EPOCH } from './workspaceSetup.js';
import { t } from '@lingui/core/macro';

export const TIPS_KEY = 'setup_tips';     // profiles.settings key; SetupInWorkspace is its one writer
export const TIPS_QUIET_MS = 15_000;      // nothing added or uploading for this long
export const TIPS_RETRY_MS = 5_000;       // something was in the way: look again

// What each tip points at. On a computer the sidebar's cards and its Upload
// button; in the phone drawer the first tip points at the button that opens
// it (the drawer opens on Next), and its cards are display: contents there,
// so the files tip points at the Files header instead.
export const TIP_ANCHORS = Object.freeze({
  desk: {
    clusters: '.sbf-card.is-tree',
    files: '.sbf-card.is-files',
    import: '.sbf-upload',
  },
  phone: {
    clusters: '.topbar .tb-left .tb-icon[aria-label="Open menu"]',
    files: '.sidebar.is-mobile-open .sbf-files-head',
    import: '.sidebar.is-mobile-open .sbf-upload',
  },
});

// Day one is for putting things down. Tip 1 points at the clusters without
// asking for one yet (nested clusters on the first day go with fewer returns);
// tip 2 names the paste-a-link habit, the one day-one behavior that still goes
// with coming back once depth is accounted for.
// Getters, so the words are read in the current language when a tip is shown, not at load.
const COPY = {
  desk: {
    clusters: { get title() { return t`Your clusters live here`; }, get body() { return t`Each cluster is its own board. Once you’ve added a few things, start one for each project, scene or client.`; } },
    files: { get title() { return t`Drop any file, or paste a link`; }, get body() { return t`Scripts, PDFs, video and photos wait in Files until you put them on a board. Paste a link from any tab onto the board and it becomes a card.`; } },
    import: { get title() { return t`Coming from Google Drive or Dropbox?`; }, get body() { return t`Download the folder as a zip and drop it here. Its folders come in as clusters, with their files.`; } },
    importPlain: { get title() { return t`Coming from Google Drive or Dropbox?`; }, get body() { return t`Download the folder, unzip it, and drop its files here. They land in Files.`; } },
  },
  phone: {
    clusters: { get title() { return t`Your clusters and files live here`; }, get body() { return t`Tap to see every cluster, and the files in each one.`; } },
    files: { get title() { return t`Every file lands in Files`; }, get body() { return t`Photos, video, PDFs, scripts. Tap Upload to add from your phone. Paste a link onto a board and it becomes a card.`; } },
    import: { get title() { return t`Coming from Google Drive or Dropbox?`; }, get body() { return t`Bring a whole folder in from a computer: download it as a zip and drop it on Clusters.`; } },
    importPlain: { get title() { return t`Coming from Google Drive or Dropbox?`; }, get body() { return t`Bring files in from a computer: download them, unzip, and drop them on Clusters.`; } },
  },
};

export const TIP_IDS = Object.freeze(['clusters', 'files', 'import']);

// The three tips, in order. `canImport` is whether the import guide exists
// here (appHost.js bulkImportAllowed): with it the last tip offers "See how",
// without it the tip says to unzip first.
export function tipsFor({ phone = false, canImport = false } = {}) {
  const shell = phone ? 'phone' : 'desk';
  const c = COPY[shell];
  return TIP_IDS.map((id, i) => {
    const copy = id === 'import' && !canImport ? c.importPlain : c[id];
    return {
      id,
      n: i + 1,
      of: TIP_IDS.length,
      title: copy.title,
      body: copy.body,
      anchor: TIP_ANCHORS[shell][id],
      placement: phone ? (id === 'import' ? 'top' : 'bottom') : 'right',
      how: id === 'import' && canImport,
      last: i === TIP_IDS.length - 1,
    };
  });
}

// Whether this account gets the tips at all: the host's gate (the setup's,
// which needs the files sidebar), an account made since the setup began, and
// no record that they were shown on this account or this device.
export function tipsEligible({ allowed, createdAt, record, seenHere } = {}) {
  if (!allowed || seenHere) return false;
  if (record && record.done) return false;
  const created = Date.parse(createdAt || '');
  return Number.isFinite(created) && created >= Date.parse(SETUP_EPOCH);
}

// Whether to start them now: something is on the board, the person has been
// quiet long enough, and nothing else is on screen. `quietFor` is ms since the
// last card was added or the last upload ended.
export function tipsDue({ eligible, hasCards, uploading, quietFor, blocked, sidebarShown = true } = {}) {
  if (!eligible || !hasCards || uploading || blocked || !sidebarShown) return false;
  return Number(quietFor) >= TIPS_QUIET_MS;
}

// The record kept when the tips end, however they end.
export function tipsRecord({ last, action, now }) {
  return { v: 1, done: true, last: TIP_IDS.includes(last) ? last : null, action: action || null, at: now || null };
}
