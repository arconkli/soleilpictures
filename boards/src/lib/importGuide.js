// importGuide — how to bring files over from another app: the steps the
// import tray shows before anything is dropped (the owner's pick D,
// 2026-10-20). There is no Dropbox or Google Drive connector for now, so this
// is how a Drive, a Dropbox or anything else comes in: download it from there,
// then drop it here. components/ImportTray.jsx draws it; every word is here.
//
// Lines are rich parts, as importCopy's: strings and { b } runs, never markup
// from strings. **x** in a step marks a label the person will see on the
// other app's screen. A cluster's name is never parsed, only placed.
//
// Our own limits come from the code that enforces them (IMPORT_LIMITS,
// CLUSTER_FILE_CEILING). The other apps' numbers can't, so each one names the
// page that states it, to be checked again.

import { IMPORT_LIMITS } from './importTree.js';
import { CLUSTER_FILE_CEILING } from './importPlan.js';
import { sizeLabel } from './importCopy.js';

export const GUIDE_APPS = Object.freeze(['drive', 'photos', 'dropbox', 'onedrive', 'icloud', 'other']);

const n = (v) => Number(v).toLocaleString('en-US');

// 'Open **Takeout**.' → ['Open ', { b: 'Takeout' }, '.']
export function rich(s) {
  return String(s).split('**')
    .map((t, i) => (i % 2 ? { b: t } : t))
    .filter((p) => (typeof p === 'string' ? p : p.b));
}

// Where a step says to drop. With an open cluster the person can edit, the
// whole cluster takes a drop (its canvas, its Files, the tray); without one
// the tray takes it and asks which cluster. A phone or a tablet (no folder
// picker) is told to choose the zip with the picker under the steps instead.
function dropLine(what, target, canFolder) {
  if (!canFolder) {
    const into = target ? ` ${what === 'parts' ? 'They go' : 'It goes'} into ${target}.` : '';
    return (what === 'parts' ? 'Choose all the parts below at once.' : 'Choose the zip below.') + into;
  }
  if (target) {
    return {
      parts: `Drop all the parts anywhere in ${target} at once.`,
      zip: `Drop the zip anywhere in ${target}.`,
      folder: `Drag the folder anywhere into ${target}.`,
      any: `Drop the zip or the folder anywhere in ${target}.`,
    }[what];
  }
  return {
    parts: 'Drop all the parts here at once.',
    zip: 'Drop the zip here.',
    folder: 'Drag the folder here.',
    any: 'Drop the zip or the folder here.',
  }[what];
}

const TAKEOUT = { label: 'Open Google Takeout', href: 'https://takeout.google.com/' };
// Takeout's own choices: a .zip, and its biggest part, so a whole Drive is
// one or two downloads. Every part of one export merges back into one tree
// (zipRead.groupArchives).
const TAKEOUT_STEP = 'Choose **Next step**. Keep **.zip**, set the size to **50 GB**, then choose **Create export**.';
// support.google.com/accounts/answer/3024190: an export can take "a few
// minutes to a few days", and its download link lasts a week.
const TAKEOUT_LINK_NOTE = 'The download link expires after a week.';
// help.dropbox.com/sync/download-entire-folders: a folder downloaded from
// dropbox.com must be "less than 250 GB" and hold "fewer than 10,000 files".
const DROPBOX_ZIP_NOTE = 'Dropbox can zip fewer than 10,000 files and under 250 GB at a time.';
// support.microsoft.com/en-us/onedrive/download-files-and-folders-from-onedrive-or-sharepoint:
// a download is limited to 250GB and 10,000 files in all.
const ONEDRIVE_ZIP_NOTE = 'OneDrive can zip up to 10,000 files and 250 GB at a time.';

const ZIPS = { kind: 'zips', label: 'Choose zip files…' };
const ZIP = { kind: 'zips', label: 'Choose a zip…' };
const FOLDER = { kind: 'folder', label: 'Choose a folder…' };

// Each app: its name, a line saying what its download is, the steps (a
// `drop` step is the drop line, then `then`), a link to it, notes, and the
// pickers for what its download is. A note with `computer` is a computer's
// way (a right-click, a desktop app) and stays off a phone; `phone` is an
// app's own way there, in place of its lede, steps, link and notes.
const APPS = {
  drive: {
    name: 'Google Drive',
    lede: 'Google Takeout packs your whole Drive, folders and all, into zip files.',
    steps: [
      'Open **Google Takeout**, choose **Deselect all**, then select **Drive**.',
      TAKEOUT_STEP,
      'Google emails you a link. A big Drive can take a few days. Download every part.',
      { drop: 'parts', then: 'Each folder becomes a cluster.' },
    ],
    link: TAKEOUT,
    notes: [
      { computer: 'Only a few folders? In Drive, right-click one and choose **Download**. You get a zip, which comes in the same way.' },
      TAKEOUT_LINK_NOTE,
    ],
    picks: [ZIPS],
  },
  photos: {
    name: 'Google Photos',
    lede: 'Google Takeout packs your library into zip files, with a folder for each album and each year.',
    steps: [
      'Open **Google Takeout**, choose **Deselect all**, then select **Google Photos**.',
      TAKEOUT_STEP,
      'When Google emails you, download every part.',
      { drop: 'parts', then: 'Each album and each year becomes a cluster.' },
    ],
    link: TAKEOUT,
    notes: [
      'A photo in an album can come out twice: in the album and in its year.',
      // zipRead's isSidecar: every .json under Google Photos stays out.
      'The .json files Google adds beside each photo are left out.',
    ],
    picks: [ZIPS],
  },
  dropbox: {
    name: 'Dropbox',
    lede: 'Dropbox downloads the folders you pick as one zip.',
    steps: [
      'On **dropbox.com**, open **All files** and select the folders you want.',
      'Choose **Download**. Dropbox makes one zip of them.',
      { drop: 'zip', then: 'Each folder becomes a cluster.' },
    ],
    link: { label: 'Open Dropbox', href: 'https://www.dropbox.com/home' },
    notes: [
      DROPBOX_ZIP_NOTE,
      { computer: 'More than that? In the Dropbox app on your computer, right-click the folder and choose **Make available offline**. Once it shows a green check, drag the folder in.' },
    ],
    picks: [ZIP, FOLDER],
  },
  onedrive: {
    name: 'OneDrive',
    lede: 'OneDrive downloads what you select as one zip.',
    steps: [
      'On **onedrive.com**, open **My files** and select the folders you want.',
      'Choose **Download**. OneDrive makes one zip of them.',
      { drop: 'zip', then: 'Each folder becomes a cluster.' },
    ],
    link: { label: 'Open OneDrive', href: 'https://onedrive.live.com/' },
    notes: [
      ONEDRIVE_ZIP_NOTE,
      { computer: 'More than that? In the OneDrive app on your computer, right-click the folder and choose **Always keep on this device**, then drag the folder in.' },
    ],
    picks: [ZIP, FOLDER],
  },
  icloud: {
    name: 'iCloud Drive',
    lede: 'On a Mac, iCloud Drive is already a folder.',
    steps: [
      'In **Finder**, choose **iCloud Drive** in the sidebar.',
      'Control-click the folder you want and choose **Download Now**. Wait until it has finished.',
      { drop: 'folder', then: 'Each folder becomes a cluster.' },
    ],
    link: { label: 'Open iCloud.com', href: 'https://www.icloud.com/iclouddrive/' },
    notes: [
      'No Mac? On **icloud.com**, open **Drive**, select what you want and choose **Download**. What it saves comes in the same way.',
    ],
    picks: [FOLDER, ZIP],
    // support.apple.com/guide/iphone/iphc61044c11: "Touch and hold the file
    // or folder, then tap Compress."
    phone: {
      lede: 'On an iPhone or iPad, the Files app zips a folder for you.',
      steps: [
        'In the **Files** app, open **iCloud Drive**.',
        'Touch and hold the folder you want, then tap **Compress**.',
        { drop: 'zip', then: 'Each folder becomes a cluster.' },
      ],
      link: null,
      notes: [],
    },
  },
  other: {
    name: 'Anything else',
    lede: 'If it downloads as a zip, or sits in a folder on your computer, it comes in the same way.',
    steps: [
      'Download it as a zip, or copy it into a folder on your computer.',
      { drop: 'any', then: 'Each folder becomes a cluster, nested the way it was.' },
    ],
    link: null,
    notes: [
      'Box, Notion, an old hard drive and a camera card all work this way.',
      `Up to ${n(IMPORT_LIMITS.maxFiles)} files at a time. A folder with more than ${n(CLUSTER_FILE_CEILING)} files is split into parts.`,
    ],
    picks: [ZIPS, FOLDER],
  },
};

// The guide for one app. target: the name of the cluster a drop goes into,
// or null. canFolder: false where the browser can't pick a folder (phones
// and tablets), which drops that picker and says the phone's way.
export function guideApp(id, { target = null, canFolder = true } = {}) {
  const app = APPS[id] || APPS.drive;
  const way = (!canFolder && app.phone) || app;
  return {
    id: APPS[id] ? id : 'drive',
    name: app.name,
    lede: way.lede,
    steps: way.steps.map((s) => (typeof s === 'string' ? rich(s) : [dropLine(s.drop, target, canFolder), ` ${s.then}`])),
    link: 'link' in way ? way.link : app.link,
    notes: way.notes
      .filter((t) => canFolder || typeof t === 'string')
      .map((t) => rich(typeof t === 'string' ? t : t.computer)),
    picks: app.picks.filter((p) => canFolder || p.kind !== 'folder'),
  };
}

export function guideAppName(id) {
  return (APPS[id] || APPS.drive).name;
}

// The line under the steps: how much comes in now, on the person's own plan,
// in the tray's own sizes (importCopy).
// Someone else's workspace counts toward its owner's plan, which the import's
// own question says; an unknown number says nothing.
export function guideRoom({ own = true, plan = null, cardsLeft = null, bytesLeft = null } = {}) {
  if (!own) return null;
  if (plan === 'free') {
    if (typeof cardsLeft !== 'number' || !Number.isFinite(cardsLeft)) return null;
    if (cardsLeft <= 0) return ['Your free plan is full; what you bring waits for room.'];
    const one = cardsLeft === 1;
    return ['Free plan: ', { b: `${n(cardsLeft)} more ${one ? 'file' : 'files'}` }, `${one ? ' fits' : ' fit'} now; the rest waits for room.`];
  }
  if (typeof bytesLeft !== 'number' || !Number.isFinite(bytesLeft)) return null;
  const left = sizeLabel(Math.max(0, bytesLeft));
  if (plan === 'trial') return [{ b: left }, ' free on your Creator trial.'];
  if (plan === 'paid') return [{ b: left }, ' free in your drive.'];
  return null;
}

// ── Open or not, and on which app ──────────────────────────────────────────
// A module store, as importJobs is: the Upload menu (through App) opens it and
// the tray draws it, neither knowing about the other. The app last chosen is
// remembered in this browser, so coming back once Google's email arrives
// opens on Google Drive again.
const KEY = 'soleil.importGuide.app';
let state = { open: false, app: 'drive' };
const listeners = new Set();

function set(next) {
  state = { ...state, ...next };
  for (const fn of [...listeners]) {
    try { fn(); } catch (_) { /* a listener must not break the store */ }
  }
}

function remembered() {
  try {
    const v = globalThis.localStorage?.getItem(KEY);
    return GUIDE_APPS.includes(v) ? v : null;
  } catch (_) { return null; }
}

export function subscribeImportGuide(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function importGuideSnapshot() {
  return state;
}

export function isImportGuideOpen() {
  return state.open;
}

export function openImportGuide(app = null) {
  set({ open: true, app: GUIDE_APPS.includes(app) ? app : remembered() || state.app });
}

export function closeImportGuide() {
  if (state.open) set({ open: false });
}

export function chooseGuideApp(app) {
  if (!GUIDE_APPS.includes(app) || app === state.app) return;
  try { globalThis.localStorage?.setItem(KEY, app); } catch (_) { /* private mode */ }
  set({ app });
}

// Tests only.
export function __resetImportGuideForTests() {
  state = { open: false, app: 'drive' };
  listeners.clear();
}
