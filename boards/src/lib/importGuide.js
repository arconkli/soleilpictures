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
import { rich } from './richParts.js';
import { t as tr, plural } from '@lingui/core/macro';

// Where rich() lives now (importCopy shares it); kept here for its importers.
export { rich };

export const GUIDE_APPS = Object.freeze(['drive', 'photos', 'dropbox', 'onedrive', 'icloud', 'other']);

// Where a step says to drop. With an open cluster the person can edit, the
// whole cluster takes a drop (its canvas, its Files, the tray); without one
// the tray takes it and asks which cluster. A phone or a tablet (no folder
// picker) is told to choose the zip with the picker under the steps instead.
// One whole message per case; a cluster's name is only placed, never parsed.
function dropLine(what, target, canFolder) {
  if (!canFolder) {
    if (what === 'parts') return target ? tr`Choose all the parts below at once. They go into ${target}.` : tr`Choose all the parts below at once.`;
    return target ? tr`Choose the zip below. It goes into ${target}.` : tr`Choose the zip below.`;
  }
  if (target) {
    switch (what) {
      case 'parts': return tr`Drop all the parts anywhere in ${target} at once.`;
      case 'zip': return tr`Drop the zip anywhere in ${target}.`;
      case 'folder': return tr`Drag the folder anywhere into ${target}.`;
      default: return tr`Drop the zip or the folder anywhere in ${target}.`;
    }
  }
  switch (what) {
    case 'parts': return tr`Drop all the parts here at once.`;
    case 'zip': return tr`Drop the zip here.`;
    case 'folder': return tr`Drag the folder here.`;
    default: return tr`Drop the zip or the folder here.`;
  }
}

// Each app: its name (the other app's own name, never translated), a line
// saying what its download is, the steps (a `drop` step is the drop line, then
// `then`), a link to it, notes, and the pickers for what its download is. A
// note with `computer` is a computer's way (a right-click, a desktop app) and
// stays off a phone; `phone` is an app's own way there, in place of its lede,
// steps, link and notes. A table of messages, so a function: it is read at
// render, in the person's language, never at load.
// **x** in a step marks a label the person will see on the other app's
// screen: it stays as that app words it, inside the message.
function apps() {
  const TAKEOUT = { label: tr`Open Google Takeout`, href: 'https://takeout.google.com/' };
  // Takeout's own choices: a .zip, and its biggest part, so a whole Drive is
  // one or two downloads. Every part of one export merges back into one tree
  // (zipRead.groupArchives).
  const TAKEOUT_STEP = tr`Choose **Next step**. Keep **.zip**, set the size to **50 GB**, then choose **Create export**.`;
  // support.google.com/accounts/answer/3024190: an export can take "a few
  // minutes to a few days", and its download link lasts a week.
  const TAKEOUT_LINK_NOTE = tr`The download link expires after a week.`;
  // help.dropbox.com/sync/download-entire-folders: a folder downloaded from
  // dropbox.com must be "less than 250 GB" and hold "fewer than 10,000 files".
  const DROPBOX_ZIP_NOTE = tr`Dropbox can zip fewer than 10,000 files and under 250 GB at a time.`;
  // support.microsoft.com/en-us/onedrive/download-files-and-folders-from-onedrive-or-sharepoint:
  // a download is limited to 250GB and 10,000 files in all.
  const ONEDRIVE_ZIP_NOTE = tr`OneDrive can zip up to 10,000 files and 250 GB at a time.`;

  const ZIPS = { kind: 'zips', label: tr`Choose zip files…` };
  const ZIP = { kind: 'zips', label: tr`Choose a zip…` };
  const FOLDER = { kind: 'folder', label: tr`Choose a folder…` };

  return {
    drive: {
      name: 'Google Drive',
      lede: tr`Google Takeout packs your whole Drive, folders and all, into zip files.`,
      steps: [
        tr`Open **Google Takeout**, choose **Deselect all**, then select **Drive**.`,
        TAKEOUT_STEP,
        tr`Google emails you a link. A big Drive can take a few days. Download every part.`,
        { drop: 'parts', then: tr`Each folder becomes a cluster.` },
      ],
      link: TAKEOUT,
      notes: [
        { computer: tr`Only a few folders? In Drive, right-click one and choose **Download**. You get a zip, which comes in the same way.` },
        TAKEOUT_LINK_NOTE,
      ],
      picks: [ZIPS],
    },
    photos: {
      name: 'Google Photos',
      lede: tr`Google Takeout packs your library into zip files, with a folder for each album and each year.`,
      steps: [
        tr`Open **Google Takeout**, choose **Deselect all**, then select **Google Photos**.`,
        TAKEOUT_STEP,
        tr`When Google emails you, download every part.`,
        { drop: 'parts', then: tr`Each album and each year becomes a cluster.` },
      ],
      link: TAKEOUT,
      notes: [
        tr`A photo in an album can come out twice: in the album and in its year.`,
        // zipRead's isSidecar: every .json under Google Photos stays out.
        tr`The .json files Google adds beside each photo are left out.`,
      ],
      picks: [ZIPS],
    },
    dropbox: {
      name: 'Dropbox',
      lede: tr`Dropbox downloads the folders you pick as one zip.`,
      steps: [
        tr`On **dropbox.com**, open **All files** and select the folders you want.`,
        tr`Choose **Download**. Dropbox makes one zip of them.`,
        { drop: 'zip', then: tr`Each folder becomes a cluster.` },
      ],
      link: { label: tr`Open Dropbox`, href: 'https://www.dropbox.com/home' },
      notes: [
        DROPBOX_ZIP_NOTE,
        { computer: tr`More than that? In the Dropbox app on your computer, right-click the folder and choose **Make available offline**. Once it shows a green check, drag the folder in.` },
      ],
      picks: [ZIP, FOLDER],
    },
    onedrive: {
      name: 'OneDrive',
      lede: tr`OneDrive downloads what you select as one zip.`,
      steps: [
        tr`On **onedrive.com**, open **My files** and select the folders you want.`,
        tr`Choose **Download**. OneDrive makes one zip of them.`,
        { drop: 'zip', then: tr`Each folder becomes a cluster.` },
      ],
      link: { label: tr`Open OneDrive`, href: 'https://onedrive.live.com/' },
      notes: [
        ONEDRIVE_ZIP_NOTE,
        { computer: tr`More than that? In the OneDrive app on your computer, right-click the folder and choose **Always keep on this device**, then drag the folder in.` },
      ],
      picks: [ZIP, FOLDER],
    },
    icloud: {
      name: 'iCloud Drive',
      lede: tr`On a Mac, iCloud Drive is already a folder.`,
      steps: [
        tr`In **Finder**, choose **iCloud Drive** in the sidebar.`,
        tr`Control-click the folder you want and choose **Download Now**. Wait until it has finished.`,
        { drop: 'folder', then: tr`Each folder becomes a cluster.` },
      ],
      link: { label: tr`Open iCloud.com`, href: 'https://www.icloud.com/iclouddrive/' },
      notes: [
        tr`No Mac? On **icloud.com**, open **Drive**, select what you want and choose **Download**. What it saves comes in the same way.`,
      ],
      picks: [FOLDER, ZIP],
      // support.apple.com/guide/iphone/iphc61044c11: "Touch and hold the file
      // or folder, then tap Compress."
      phone: {
        lede: tr`On an iPhone or iPad, the Files app zips a folder for you.`,
        steps: [
          tr`In the **Files** app, open **iCloud Drive**.`,
          tr`Touch and hold the folder you want, then tap **Compress**.`,
          { drop: 'zip', then: tr`Each folder becomes a cluster.` },
        ],
        link: null,
        notes: [],
      },
    },
    other: {
      name: tr`Anything else`,
      lede: tr`If it downloads as a zip, or sits in a folder on your computer, it comes in the same way.`,
      steps: [
        tr`Download it as a zip, or copy it into a folder on your computer.`,
        { drop: 'any', then: tr`Each folder becomes a cluster, nested the way it was.` },
      ],
      link: null,
      notes: [
        tr`Box, Notion, an old hard drive and a camera card all work this way.`,
        // The two limits are the code's own: two sentences, one message each.
        [
          plural(IMPORT_LIMITS.maxFiles, { one: 'Up to # file at a time.', other: 'Up to # files at a time.' }),
          plural(CLUSTER_FILE_CEILING, { one: 'A folder with more than # file is split into parts.', other: 'A folder with more than # files is split into parts.' }),
        ].join(' '),
      ],
      picks: [ZIPS, FOLDER],
    },
  };
}

// The guide for one app. target: the name of the cluster a drop goes into,
// or null. canFolder: false where the browser can't pick a folder (phones
// and tablets), which drops that picker and says the phone's way.
export function guideApp(id, { target = null, canFolder = true } = {}) {
  const APPS = apps();
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
  const APPS = apps();
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
    if (cardsLeft <= 0) return [tr`Your free plan is full; what you bring waits for room.`];
    return rich(plural(cardsLeft, { one: 'Free plan: **# more file** fits now; the rest waits for room.', other: 'Free plan: **# more files** fit now; the rest waits for room.' }));
  }
  if (typeof bytesLeft !== 'number' || !Number.isFinite(bytesLeft)) return null;
  const left = sizeLabel(Math.max(0, bytesLeft));
  if (plan === 'trial') return rich(tr`**${left}** free on your Creator trial.`);
  if (plan === 'paid') return rich(tr`**${left}** free in your drive.`);
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
