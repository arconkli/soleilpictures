// importCopy — the words of a bulk import (the owner's pick A, 2026-10-19):
// the question asked before anything moves, the tray while it runs, and the
// small chip the tray folds into in the corner. Pure, so every state's sentence
// is tested here rather than found on the preview.
//
// Plan names, prices and drive sizes come from billingCopy, never typed here:
// its rule is that every pricing claim names the code enforcing it, and its
// drive labels are what gen-docs cross-checks against the migrations.
//
// Rules the mockup's critic forced, kept:
//   · a local import runs only in the OPEN TAB — "the rest waits in this tab";
//     a closed tab means dropping it again, and what's in is skipped;
//   · no "Try again" while the plan is full: it picks up by itself;
//   · gold only on the paid step (ImportCapDialog's rule): tone 'primary'. The
//     default action of a question with no paid step is tone 'default';
//   · "card required" wherever the trial is offered;
//   · "bring all" only when buying really would bring all of it;
//   · no pronouns for the person whose workspace it is.
//
// Rich lines are arrays of strings and { b } (bold) pieces, for the view to
// render without building markup from strings.

import {
  CREATOR_STORAGE_LABEL, CREATOR_TRIAL_DAYS, PLAN_NAME,
  STORAGE_ADDON_BLOCK_LABEL, TRIAL_STORAGE_LABEL,
} from './billingCopy.js';
import { CTA, perMonth, addonBilled, creatorStorageLabel, trialStorageLabel, addonBlockLabel } from './billingCopyWords.js';
import { t as tr, ph, plural, select } from '@lingui/core/macro';
import { rich } from './richParts.js';
import { uiLocale } from './uiLocale.js';
import { formatNumber, joinSentences, sizeText } from './intlFormat.js';

export const countLabel = (n) => {
  const v = Math.max(0, Math.round(Number(n) || 0));
  return uiLocale() === 'en' ? v.toLocaleString('en-US') : formatNumber(v);
};
// A count as the whole number `plural` takes (countLabel's own rounding).
export const cnt = (n) => Math.max(0, Math.round(Number(n) || 0));

// A size's number with its decimals in the person's language; English keeps
// the plain digits. `digits`: always one decimal (the column of sizes).
export function sizeNumber(v, digits = false) {
  if (uiLocale() === 'en') return digits ? v.toFixed(1) : String(v);
  return formatNumber(v, digits ? { minimumFractionDigits: 1, maximumFractionDigits: 1 } : undefined);
}

// "26.4 GB", "241 GB", "1.2 TB": one decimal until three digits. `fixed`
// keeps a whole number's ".0", for a column of sizes ("2.0 GB" over "1.9 GB").
export function sizeLabel(bytes, { fixed = false } = {}) {
  const b = Math.max(0, Number(bytes) || 0);
  for (const [u, n, unit] of [['TB', 1024 ** 4, 'terabyte'], ['GB', 1024 ** 3, 'gigabyte'], ['MB', 1024 ** 2, 'megabyte'], ['KB', 1024, 'kilobyte']]) {
    if (b >= n) {
      const v = b / n;
      const big = v >= 100;
      const shown = big ? Math.round(v) : fixed ? v : Math.round(v * 10) / 10;
      const digits = big ? 0 : fixed || !Number.isInteger(shown) ? 1 : 0;
      return sizeText(`${big ? sizeNumber(shown) : sizeNumber(shown, fixed)} ${u}`, shown, unit, digits);
    }
  }
  return sizeText(`${sizeNumber(Math.round(b))} B`, Math.round(b), 'byte');
}

// A drive label as bytes ('100GB' → 100 GiB, binary as the product labels it).
const UNITS = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
export function labelBytes(label) {
  const m = /^(\d+(?:\.\d+)?)\s*(KB|MB|GB|TB)$/i.exec(String(label || '').trim());
  return m ? Number(m[1]) * UNITS[m[2].toUpperCase()] : null;
}

// `lower`: the same words to sit inside a sentence ("…, about 5 min left"),
// written as their own messages so no translated text is lowercased by code.
// `short`: the card's form, lowercase and without "left" ("about 5 min").
export function etaLabel(ms, { lower = false, short = false } = {}) {
  if (!(Number(ms) > 0)) return null;
  const min = Math.round(ms / 60000);
  if (min < 1) return short ? tr`less than a minute` : lower ? tr`less than a minute left` : tr`Less than a minute left`;
  if (min < 60) return short ? tr`about ${min} min` : lower ? tr`about ${min} min left` : tr`About ${min} min left`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (m) return short ? tr`about ${h} hr ${m} min` : lower ? tr`about ${h} hr ${m} min left` : tr`About ${h} hr ${m} min left`;
  return short ? tr`about ${h} hr` : lower ? tr`about ${h} hr left` : tr`About ${h} hr left`;
}

const pctOf = (part, whole) => (whole > 0 ? Math.min(100, Math.round((1000 * part) / whole) / 10) : 0);
// What the person dropped, for "drop the folder again" (an id, never shown).
function thingOf({ source, zips = 0, tops = 1 }) {
  if (source === 'zip') return zips > 1 ? 'zips' : 'zip';
  return tops > 1 ? 'folders' : 'folder';
}

// Would buying the offer bring all of it? Only when the drive it buys holds
// everything already there plus the import; unknown → no claim.
function fitsAfter({ budgets, bytes, offer }) {
  const used = Number(budgets?.bytesUsed);
  if (budgets?.bytesUsed == null || !Number.isFinite(used)) return false;
  if (offer === 'trial') return used + bytes <= labelBytes(TRIAL_STORAGE_LABEL);
  if (offer === 'upgrade') return used + bytes <= labelBytes(CREATOR_STORAGE_LABEL);
  if (offer === 'addon') {
    const quota = Number(budgets?.quota);
    return Number.isFinite(quota) && used + bytes <= quota + labelBytes(STORAGE_ADDON_BLOCK_LABEL);
  }
  return false;
}

// The paid step this person can take, if any.
//   plan   'free' | 'trial' | 'paid' — the target owner's plan, as far as known
//   own    the import goes into the person's own plan
//   trialOffer  the person is owed the Creator trial (creatorTrialEligibility)
//   trialAtWall the same, asked at the card limit (a card-limit stop counts the
//               wall itself); falls back to trialOffer where the caller has none
//   addon  extra storage can be bought here (not held, under the maximum)
export function offerFor({ own, plan, stoppedBy, trialOffer = false, trialAtWall, addon = false }) {
  if (!own) return null;
  const owed = stoppedBy === 'storage' ? trialOffer : (trialAtWall ?? trialOffer);
  if (plan === 'free') return owed ? 'trial' : 'upgrade';
  if (plan === 'paid' && stoppedBy === 'storage' && addon) return 'addon';
  return null;
}

// ── The question ────────────────────────────────────────────────────────────
// Asked only when something would wait: an import that fits starts at once.
export function askCopy({
  title, source = 'folder', zips = 0, tops = 1, folders = null, splits = [],
  totals, fit, waiting, stoppedBy = null, budgets = {}, clusterCost = 0,
  plan = 'free', own = true, ownerName = null, workspaceName = null,
  trialOffer = false, trialAtWall, addon = false, interval = 'month', firstPayment = null,
}) {
  const nFolders = folders ?? totals.clusters;
  const thing = thingOf({ source, zips, tops });
  const fitN = countLabel(fit.files);
  const allN = countLabel(totals.files);
  const left = sizeLabel(budgets?.bytesLeft);
  const offer = offerFor({ own, plan, stoppedBy, trialOffer, trialAtWall, addon });
  const all = fitsAfter({ budgets, bytes: totals.bytes, offer });

  const fileCount = cnt(totals.files);
  const folderCount = cnt(nFolders);
  const bytesText = sizeLabel(totals.bytes);
  const sub = zips > 1
    ? tr`${plural(fileCount, { one: '# file', other: '# files' })} in ${plural(folderCount, { one: '# folder', other: '# folders' })} · ${bytesText} · ${plural(zips, { other: '# zips' })}`
    : tr`${plural(fileCount, { one: '# file', other: '# files' })} in ${plural(folderCount, { one: '# folder', other: '# folders' })} · ${bytesText}`;

  let fitText;
  if (!own) fitText = ownerName ? tr`fit on ${ownerName}’s plan` : tr`fit on the owner’s plan`;
  else if (stoppedBy === 'storage') fitText = plan === 'trial' ? tr`fit in your trial’s ${left} left` : tr`fit in the ${left} you have left`;
  else fitText = tr`fit on your free plan`;

  let lede = '';
  if (!own) {
    if (ownerName) {
      lede = workspaceName
        ? tr`${workspaceName} is ${ownerName}’s workspace, so what you add counts toward ${ownerName}’s plan.`
        : tr`This is ${ownerName}’s workspace, so what you add counts toward ${ownerName}’s plan.`;
    } else {
      lede = workspaceName
        ? tr`${workspaceName} is the owner’s workspace, so what you add counts toward the owner’s plan.`
        : tr`This is the owner’s workspace, so what you add counts toward the owner’s plan.`;
    }
  } else if (plan === 'trial' && stoppedBy === 'storage') {
    lede = firstPayment
      ? tr`While you’re trying ${PLAN_NAME} your drive is ${ph({ TRIAL_STORAGE_LABEL: trialStorageLabel() })}. Your first payment, on ${firstPayment}, makes it ${ph({ CREATOR_STORAGE_LABEL: creatorStorageLabel() })}.`
      : tr`While you’re trying ${PLAN_NAME} your drive is ${ph({ TRIAL_STORAGE_LABEL: trialStorageLabel() })}. Your first payment makes it ${ph({ CREATOR_STORAGE_LABEL: creatorStorageLabel() })}.`;
  } else if (stoppedBy === 'cards') {
    // The split, said for one folder (in words up to nine) or for several.
    let splitText = '';
    if (splits.length === 1) {
      const name = splits[0].name;
      const of = splits[0].of;
      const partCount = cnt(of);
      // Written out to nine ("splits in two"), then the number and "parts".
      splitText = plural(partCount, { 2: `${name} splits in two`, 3: `${name} splits in three`, 4: `${name} splits in four`, 5: `${name} splits in five`, 6: `${name} splits in six`, 7: `${name} splits in seven`, 8: `${name} splits in eight`, 9: `${name} splits in nine`, other: `${name} splits in # parts` });
    } else if (splits.length > 1) {
      const bigFolders = splits.length;
      splitText = plural(bigFolders, { other: '# big folders split into parts' });
    }
    const clusterCount = cnt(totals.clusters);
    let shape;
    if (nFolders === 1 && totals.clusters === 1) shape = tr`It becomes one cluster, and its files go to that cluster’s Files.`;
    else if (splitText) {
      shape = tr`Its ${plural(folderCount, { one: '# folder', other: '# folders' })} become ${plural(clusterCount, { one: '# cluster', other: '# clusters' })} (${splitText}), and each folder’s files go to its cluster’s Files.`;
    } else {
      shape = tr`Its ${plural(folderCount, { one: '# folder', other: '# folders' })} become ${plural(clusterCount, { one: '# cluster', other: '# clusters' })}, and each folder’s files go to its cluster’s Files.`;
    }
    // Three whole sentences, joined.
    lede = joinSentences(shape, clusterCost > 0 ? tr`Each cluster counts as a card.` : tr`Clusters don’t count as cards.`, tr`Nothing is laid out on a board.`);
  }

  let offerBox = null;
  if (offer === 'trial') {
    const price = perMonth('monthly');
    offerBox = {
      name: PLAN_NAME,
      text: all
        ? tr`Unlimited cards and room for all ${bytesText}. Free for ${CREATOR_TRIAL_DAYS} days, then ${price} a month. Card required.`
        : tr`Unlimited cards, and a ${ph({ TRIAL_STORAGE_LABEL: trialStorageLabel() })} drive until the first payment makes it ${ph({ CREATOR_STORAGE_LABEL: creatorStorageLabel() })}. Free for ${CREATOR_TRIAL_DAYS} days, then ${price} a month. Card required.`,
    };
  } else if (offer === 'upgrade') {
    const monthly = perMonth('monthly');
    const yearly = perMonth('annual');
    offerBox = {
      name: PLAN_NAME,
      text: all
        ? tr`Unlimited cards and room for all ${bytesText}. ${monthly} a month, or ${yearly} a month billed yearly.`
        : tr`Unlimited cards and a ${ph({ CREATOR_STORAGE_LABEL: creatorStorageLabel() })} drive. ${monthly} a month, or ${yearly} a month billed yearly.`,
    };
  } else if (offer === 'addon') {
    const per = addonBilled(interval === 'year' ? 'year' : 'month');
    offerBox = { name: tr`Extra storage`, text: tr`Add ${ph({ STORAGE_ADDON_BLOCK_LABEL: addonBlockLabel() })} to your drive for ${per}, on your ${PLAN_NAME} bill.` };
  }

  const dropAgain = tr`Closed the tab? Drop the ${select(thing, { zip: 'zip', zips: 'zips', folder: 'folder', folders: 'folders', other: 'folder' })} again — what’s in is skipped.`;
  let note;
  if (!own) {
    if (fit.files > 0) {
      note = ownerName
        ? tr`Bring ${fitN} now and the rest waits in this tab until ${ownerName} has room.`
        : tr`Bring ${fitN} now and the rest waits in this tab until the owner has room.`;
    } else {
      note = ownerName
        ? tr`Nothing fits yet. It waits in this tab and comes in once ${ownerName} has room.`
        : tr`Nothing fits yet. It waits in this tab and comes in once the owner has room.`;
    }
  } else if (plan === 'trial' && stoppedBy === 'storage') {
    note = firstPayment
      ? tr`After your first payment on ${firstPayment}, drop the ${select(thing, { zip: 'zip', zips: 'zips', folder: 'folder', folders: 'folders', other: 'folder' })} again to bring the rest — what’s in already is skipped.`
      : tr`After your first payment, drop the ${select(thing, { zip: 'zip', zips: 'zips', folder: 'folder', folders: 'folders', other: 'folder' })} again to bring the rest — what’s in already is skipped.`;
  } else if (offer === 'addon') {
    note = fit.files > 0
      ? tr`Bring ${fitN} now and the rest waits in this tab; it comes in as soon as the ${ph({ STORAGE_ADDON_BLOCK_LABEL: addonBlockLabel() })} is added.`
      : tr`It waits in this tab; it comes in as soon as the ${ph({ STORAGE_ADDON_BLOCK_LABEL: addonBlockLabel() })} is added.`;
  } else if (plan === 'paid') {
    note = fit.files > 0
      ? tr`Bring ${fitN} now and the rest waits in this tab, and picks up by itself once deleting files or emptying the trash makes room.`
      : tr`It waits in this tab, and picks up by itself once deleting files or emptying the trash makes room.`;
  } else {
    // Two whole sentences, joined.
    note = joinSentences(fit.files > 0
      ? tr`Bring ${fitN} now and the rest waits in this tab, coming in once there’s room.`
      : tr`Nothing fits yet. It waits in this tab and comes in once there’s room.`, dropAgain);
  }

  const actions = [{ id: 'cancel', label: tr`Cancel`, tone: null }];
  actions.push({ id: 'fit', label: fit.files > 0 ? tr`Bring ${fitN} now` : tr`Keep it waiting`, tone: offer ? null : 'default' });
  if (offer === 'trial') {
    const cta = CTA.tryCreatorShort;
    actions.push({ id: 'all', label: all ? tr`${cta} — bring all ${allN}` : cta, tone: 'primary' });
  } else if (offer === 'upgrade') actions.push({ id: 'all', label: all ? tr`Upgrade — bring all ${allN}` : tr`Upgrade to ${PLAN_NAME}`, tone: 'primary' });
  else if (offer === 'addon') actions.push({ id: 'all', label: all ? tr`Add ${ph({ STORAGE_ADDON_BLOCK_LABEL: addonBlockLabel() })} — bring all ${allN}` : tr`Add ${ph({ STORAGE_ADDON_BLOCK_LABEL: addonBlockLabel() })}`, tone: 'primary' });

  return {
    kicker: tr`Import`, title, sub,
    pct: pctOf(fit.files, totals.files),
    fit: { n: fitN, text: fitText },
    wait: { n: countLabel(waiting.files), text: tr`would wait` },
    lede, offer: offerBox, note, actions, offerKind: offer,
  };
}

// ── The zip question ───────────────────────────────────────────────────────
// Asked when zips are dropped, before anything is read: unpack them into
// clusters, or add them as they are. Built from names and sizes alone, so a
// "keep" costs nothing. zips: [{ name, size }] in drop order; groups:
// zipRead.groupArchives(names) (several parts of one export make one group).
const ZIP_ROWS = 4;

function exportOf(name) {
  if (/^takeout-\d{8}T\d{6}Z-\d{3}\.zip$/i.test(name)) return tr`one Google Takeout export`;
  if (/^drive-download-\d{8}T\d{6}Z-\d{3}\.zip$/i.test(name)) return tr`one Google Drive download`;
  return null;
}

export function zipAskCopy({ zips = [], groups = [] } = {}) {
  const n = zips.length;
  const many = n !== 1;
  const total = zips.reduce((t, z) => t + (Number(z.size) || 0), 0);
  const oneExport = groups.length === 1 && n > 1;
  // n spelled out to nine, as a number after (in each sentence's own plural).
  const zipCount = cnt(n);
  const what = oneExport ? (exportOf(String(zips[0]?.name || '')) || plural(zipCount, { 2: `one export in two parts`, 3: `one export in three parts`, 4: `one export in four parts`, 5: `one export in five parts`, 6: `one export in six parts`, 7: `one export in seven parts`, 8: `one export in eight parts`, 9: `one export in nine parts`, other: `one export in # parts` })) : null;
  let lede;
  if (oneExport) lede = plural(zipCount, { 2: `Unpacked, the two parts become one tree: every folder in it becomes a cluster, and its files go to that cluster’s Files.`, 3: `Unpacked, the three parts become one tree: every folder in it becomes a cluster, and its files go to that cluster’s Files.`, 4: `Unpacked, the four parts become one tree: every folder in it becomes a cluster, and its files go to that cluster’s Files.`, 5: `Unpacked, the five parts become one tree: every folder in it becomes a cluster, and its files go to that cluster’s Files.`, 6: `Unpacked, the six parts become one tree: every folder in it becomes a cluster, and its files go to that cluster’s Files.`, 7: `Unpacked, the seven parts become one tree: every folder in it becomes a cluster, and its files go to that cluster’s Files.`, 8: `Unpacked, the eight parts become one tree: every folder in it becomes a cluster, and its files go to that cluster’s Files.`, 9: `Unpacked, the nine parts become one tree: every folder in it becomes a cluster, and its files go to that cluster’s Files.`, other: `Unpacked, the # parts become one tree: every folder in it becomes a cluster, and its files go to that cluster’s Files.` });
  else if (!many) lede = tr`Unpacked, every folder in it becomes a cluster, and its files go to that cluster’s Files.`;
  else if (groups.length < n) lede = tr`Unpacked, each export becomes a cluster with a cluster for every folder in it, and each file goes to its cluster’s Files.`;
  else lede = tr`Unpacked, each zip becomes a cluster with a cluster for every folder in it, and each file goes to its cluster’s Files.`;
  const restCount = cnt(n - ZIP_ROWS);
  return {
    kicker: many ? tr`Zip files` : tr`Zip file`,
    title: many ? tr`Unpack these into clusters?` : tr`Unpack this into clusters?`,
    sub: [plural(zipCount, { one: '# zip', other: '# zips' }), sizeLabel(total), what].filter(Boolean).join(' · '),
    rows: zips.slice(0, ZIP_ROWS).map((z) => ({ name: String(z.name || ''), size: sizeLabel(z.size, { fixed: true }) })),
    more: n > ZIP_ROWS ? plural(restCount, { one: `and # more`, other: `and # more` }) : null,
    lede,
    note: many ? plural(zipCount, { 2: `Or add them as two zip files, each kept whole in Files.`, 3: `Or add them as three zip files, each kept whole in Files.`, 4: `Or add them as four zip files, each kept whole in Files.`, 5: `Or add them as five zip files, each kept whole in Files.`, 6: `Or add them as six zip files, each kept whole in Files.`, 7: `Or add them as seven zip files, each kept whole in Files.`, 8: `Or add them as eight zip files, each kept whole in Files.`, 9: `Or add them as nine zip files, each kept whole in Files.`, other: `Or add them as # zip files, each kept whole in Files.` }) : tr`Or add it as a zip file, kept whole in Files.`,
    actions: [
      { id: 'keep', label: many ? plural(zipCount, { other: 'Add as # zip files' }) : tr`Add as a zip file`, tone: null },
      { id: 'unpack', label: tr`Unpack into clusters`, tone: 'default' },
    ],
  };
}

// ── The tray ────────────────────────────────────────────────────────────────
// A failure in words a person can act on. The zip reader's own failures come
// first: "more than its declared size" is a damaged entry, not a plan limit.
export function failReason(message) {
  const m = String(message || '');
  if (/to unpack here/i.test(m)) return tr`Too large to unpack here — unzip it on your computer`;
  if (/cannot decompress/i.test(m)) return tr`This browser can’t unpack it`;
  if (/declared size|checksum|damaged|incomplete|past the end/i.test(m)) return tr`Damaged inside the zip`;
  if (/NotReadable|NotFound|could not be read|couldn.t be read|permission/i.test(m)) return tr`Couldn’t be read from the folder`;
  if (/changed|modified/i.test(m)) return tr`It changed while it was uploading`;
  if (/too large|too big|size limit|exceeds/i.test(m)) return tr`Too large for this plan`;
  if (/fetch|network|connection|offline/i.test(m)) return tr`The connection dropped`;
  return tr`Couldn’t be uploaded`;
}

const FAILS_SHOWN = 5;

// entry: { phase: 'reading'|'job', title, reading: { files, folders, bytes },
//          snap (importJob state), offer, plan, own, ownerName, source, zips,
//          targetName }
// touch: a phone or a tablet, where a locked screen or another app in front
// suspends the page (ImportTray keeps the screen awake while it uploads).
// online: false while the browser says it is offline. A tray that is making
// clusters or uploading then says so, instead of a bar and an ETA that look
// stuck (importJob.js waits for the connection; nothing is spent).
export function trayCopy(entry, { touch = false, online = true } = {}) {
  const t = trayCopyBase(entry, { touch });
  const s = entry.snap || {};
  const moving = !['queued', 'stopped', 'reading'].includes(entry.phase)
    && (s.status === 'idle' || s.status === 'creating' || s.status === 'running');
  if (online !== false || !moving) return t;
  const title = entry.title || tr`Import`;
  return {
    ...t,
    meta: tr`Offline · it continues when you’re back online`,
    bar: t.bar ? { ...t.bar, still: true } : t.bar,
    chip: { kind: 'glyph', icon: 'clock', text: tr`Offline`, label: tr`${title} is offline and continues when you’re back online. Open the import` },
  };
}

function trayCopyBase(entry, { touch = false } = {}) {
  const title = entry.title || tr`Import`;
  if (entry.phase === 'queued') {
    const r = entry.reading || {};
    const fileCount = cnt(r.files);
    const folderCount = cnt(r.folders || 0);
    return {
      title, close: 'collapse',
      line: rich(tr`${plural(fileCount, { one: '**#** file', other: '**#** files' })} in ${plural(folderCount, { one: '# folder', other: '# folders' })}`),
      bar: null, meta: tr`Starts when the import before it has finished.`,
      rows: [], wait: null, finished: null, fails: null,
      foot: { meta: null, actions: [{ id: 'cancel', label: tr`Cancel` }] },
      chip: { kind: 'glyph', icon: 'clock', text: tr`Queued`, label: tr`${title} starts when the import before it has finished. Open the import` },
    };
  }
  // Stopped by a reload or a closed tab (mockup r4-Tray-Reload / Tray-Drop):
  // where this browser kept the folder, Resume; elsewhere, drop it again.
  if (entry.phase === 'stopped') {
    const landedN = Number(entry.landed) || 0;
    const total = Number(entry.total) || 0;
    const landedText = countLabel(landedN);
    const totalCount = cnt(total);
    const st = entry.stopped || {};
    const tops = st.tops || [];
    const zips = st.zips || [];
    let what;
    if (st.source === 'zip') {
      const zipCount = zips.length;
      if (zipCount === 1) what = String(zips[0]);
      else if (zipCount) what = plural(zipCount, { other: 'the # zips' });
      else what = title;
    } else if (tops.length > 1) {
      const folderCount = tops.length;
      what = plural(folderCount, { other: 'the # folders' });
    } else what = title;
    const targetName = entry.targetName;
    return {
      title: tr`${title} stopped`, close: 'collapse',
      line: rich(plural(totalCount, { one: `**${landedText}** of # files are in`, other: `**${landedText}** of # files are in` })),
      bar: { pct: pctOf(landedN, total) },
      meta: entry.canResume
        ? tr`The page reloaded, so the upload stopped. Resume picks up where it left off; your browser asks to read the folder again first.`
        : targetName
          ? tr`The page reloaded, so the upload stopped. Drop ${what} on ${targetName} again to bring the rest — files already in are skipped.`
          : tr`The page reloaded, so the upload stopped. Drop ${what} again to bring the rest — files already in are skipped.`,
      rows: [], wait: null, fails: null, foot: null,
      finished: { open: null, remove: true, resume: !!entry.canResume },
      chip: { kind: 'glyph', icon: 'x', text: tr`Stopped`, label: plural(totalCount, { one: `${title} stopped at ${landedText} of # files. Open the import`, other: `${title} stopped at ${landedText} of # files. Open the import` }) },
    };
  }
  if (entry.phase === 'reading') {
    const r = entry.reading || {};
    const fileCount = cnt(r.files);
    const folderCount = cnt(r.folders || 0);
    return {
      title: tr`Reading ${title}…`, close: 'collapse',
      line: r.bytes
        ? rich(tr`${plural(fileCount, { one: '**#** file', other: '**#** files' })} in ${plural(folderCount, { one: '# folder', other: '# folders' })} · ${ph({ size: sizeLabel(r.bytes) })} so far`)
        : rich(tr`${plural(fileCount, { one: '**#** file', other: '**#** files' })} in ${plural(folderCount, { one: '# folder', other: '# folders' })}`),
      bar: { reading: true },
      meta: tr`Counting first, so you see what fits before anything moves. Nothing has uploaded yet.`,
      rows: [], wait: null, finished: null, fails: null,
      foot: { meta: null, actions: [{ id: 'cancel', label: tr`Cancel` }] },
      chip: { kind: 'ring', pct: null, text: tr`Reading`, label: plural(fileCount, { one: `Reading ${title}: # files so far. Open the import`, other: `Reading ${title}: # files so far. Open the import` }) },
    };
  }

  const s = entry.snap || {};
  const total = s.totals?.files || 0;
  const landedN = s.landed?.files || 0;
  const landedText = countLabel(landedN);
  const totalCount = cnt(total);
  const filesPct = pctOf(landedN, total);
  const bytesPct = s.totals?.bytes > 0 ? pctOf(s.sentBytes || 0, s.totals.bytes) : filesPct;
  const thing = thingOf({ source: entry.source, zips: entry.zips, tops: (s.tops || []).length });
  const eta = etaLabel(s.etaMs);
  const failed = s.failed || [];
  const soleTop = (s.tops || []).length === 1 ? s.tops[0] : null;
  const sentSize = sizeLabel(s.sentBytes || 0);
  const totalSize = sizeLabel(s.totals?.bytes);
  const progressLine = s.totals?.bytes
    ? rich(plural(totalCount, { one: `**${landedText}** of # files · ${sentSize} of ${totalSize}`, other: `**${landedText}** of # files · ${sentSize} of ${totalSize}` }))
    : rich(plural(totalCount, { one: `**${landedText}** of # files`, other: `**${landedText}** of # files` }));
  const clusterCount = cnt(s.totals?.clusters || 0);

  const rows = (s.rows || []).length > 1 ? s.rows.map((r) => {
    const landedRow = countLabel(r.landed);
    const filesRow = countLabel(r.files);
    if (r.landed >= r.files) return { key: r.key, name: r.name, state: 'done', count: filesRow, pct: 100 };
    if (r.key === s.currentRow && s.status === 'running') return { key: r.key, name: r.name, state: 'now', count: tr`${landedRow} of ${filesRow}`, pct: pctOf(r.landed, r.files) };
    if (r.landed > 0) return { key: r.key, name: r.name, state: 'part', count: tr`${landedRow} of ${filesRow}`, pct: pctOf(r.landed, r.files) };
    return { key: r.key, name: r.name, state: 'later', count: filesRow, pct: 0 };
  }) : [];

  const base = { close: 'collapse', rows: [], wait: null, finished: null, fails: null, foot: null, meta: null, bar: null };
  const open = soleTop?.boardId ? { boardId: soleTop.boardId, label: tr`Open ${ph({ name: soleTop.name })}` } : null;

  switch (s.status) {
    case 'idle':
    case 'creating':
      return {
        ...base, title: tr`Importing ${title}`,
        line: [tr`Making ${plural(clusterCount, { one: '# cluster', other: '# clusters' })}…`],
        bar: { pct: 0 }, meta: touch ? tr`Keep this tab on screen` : tr`Keep this tab open`,
        foot: { meta: null, actions: [{ id: 'cancel', label: tr`Cancel` }] },
        chip: { kind: 'ring', pct: 0, text: '0%', label: tr`Importing ${title}: making its clusters. Open the import` },
      };
    case 'running': {
      let meta;
      if (eta) meta = touch ? tr`${eta} · keep this tab on screen` : tr`${eta} · keep this tab open`;
      else meta = touch ? tr`Keep this tab on screen` : tr`Keep this tab open`;
      const etaInline = etaLabel(s.etaMs, { lower: true });
      return {
        ...base, title: tr`Importing ${title}`, line: progressLine, bar: { pct: bytesPct },
        meta, rows,
        foot: { meta: null, actions: [{ id: 'pause', label: tr`Pause`, icon: 'pause' }, { id: 'cancel', label: tr`Cancel` }] },
        chip: { kind: 'ring', pct: bytesPct, text: `${Math.floor(bytesPct)}%`, label: etaInline ? plural(totalCount, { one: `Importing ${title}: ${landedText} of # files, ${etaInline}. Open the import`, other: `Importing ${title}: ${landedText} of # files, ${etaInline}. Open the import` }) : plural(totalCount, { one: `Importing ${title}: ${landedText} of # files. Open the import`, other: `Importing ${title}: ${landedText} of # files. Open the import` }) },
      };
    }
    case 'paused':
      return {
        ...base, title: tr`${title} is paused`, line: progressLine, bar: { pct: bytesPct },
        meta: tr`Nothing is uploading. Resume picks up where it left off.`, rows,
        foot: { meta: null, actions: [{ id: 'resume', label: tr`Resume`, icon: 'play' }, { id: 'cancel', label: tr`Cancel` }] },
        chip: { kind: 'glyph', icon: 'pause', text: tr`Paused`, label: plural(totalCount, { one: `${title} is paused at ${landedText} of # files. Open the import`, other: `${title} is paused at ${landedText} of # files. Open the import` }) },
      };
    case 'waiting': {
      const waitingCount = cnt(s.waiting?.files || 0);
      return {
        ...base, title,
        // No folder list here (the owner's pick): the wait box and its one step are the point.
        line: rich(plural(waitingCount, { one: `**${landedText}** in · **#** waiting for room`, other: `**${landedText}** in · **#** waiting for room` })),
        bar: { pct: filesPct },
        wait: waitBox({
          ...entry, reason: s.waitingReason, thing,
          offer: entry.offer !== undefined ? entry.offer
            : offerFor({ own: entry.own, plan: entry.plan, stoppedBy: s.waitingReason, trialOffer: entry.trialOffer, trialAtWall: entry.trialAtWall, addon: entry.addon }),
        }),
        foot: { meta: tr`They wait in this tab — keep it open.`, actions: [{ id: 'cancel', label: tr`Stop` }] },
        chip: { kind: 'glyph', icon: 'clock', text: tr`Waiting`, label: plural(waitingCount, { one: `${title}: ${landedText} in, # waiting for room. Open the import`, other: `${title}: ${landedText} in, # waiting for room. Open the import` }) },
      };
    }
    case 'done': {
      const targetName = entry.targetName;
      const failedCount = cnt(failed.length);
      const moreCount = cnt(failed.length - FAILS_SHOWN);
      return {
        ...base, title: tr`${title} is in`, close: 'close',
        line: targetName
          ? rich(tr`${plural(landedN, { one: '**#** file', other: '**#** files' })} in ${plural(clusterCount, { one: '# cluster', other: '# clusters' })}, inside ${targetName}`)
          : rich(tr`${plural(landedN, { one: '**#** file', other: '**#** files' })} in ${plural(clusterCount, { one: '# cluster', other: '# clusters' })}`),
        finished: { open, remove: true },
        fails: failed.length ? {
          head: plural(failedCount, { one: '# file couldn’t be brought in', other: '# files couldn’t be brought in' }),
          list: failed.slice(0, FAILS_SHOWN).map((f) => ({ path: f.relPath, why: failReason(f.message) })),
          more: failed.length > FAILS_SHOWN ? plural(moreCount, { one: `and # more`, other: `and # more` }) : null,
          retry: true,
        } : null,
        chip: failed.length
          ? { kind: 'glyph', icon: 'warning', text: plural(failedCount, { one: `# failed`, other: `# failed` }), label: tr`${title} is in; ${plural(failedCount, { one: '# file couldn’t be brought in', other: '# files couldn’t be brought in' })}. Open the import` }
          : { kind: 'glyph', icon: 'check', text: tr`Done`, label: tr`${title} is in. Open the import` },
      };
    }
    case 'cancelled':
      return {
        ...base, title: tr`${title} stopped`, close: 'close',
        line: rich(plural(totalCount, { one: `**${landedText}** of # files are in`, other: `**${landedText}** of # files are in` })),
        finished: { open: landedN > 0 ? open : null, remove: landedN > 0 || (s.tops || []).some((t) => t.boardId) },
        chip: { kind: 'glyph', icon: 'x', text: tr`Stopped`, label: plural(totalCount, { one: `${title} stopped at ${landedText} of # files. Open the import`, other: `${title} stopped at ${landedText} of # files. Open the import` }) },
      };
    case 'failed':
    default: {
      // Closing keeps what is in and lets the rest go, as Stop does.
      const error = s.error;
      return {
        ...base, title: tr`${title} stopped`, close: 'close',
        line: rich(plural(totalCount, { one: `**${landedText}** of # files are in`, other: `**${landedText}** of # files are in` })),
        bar: { pct: filesPct },
        meta: error
          ? tr`Something went wrong — ${error}. Resume picks up where it left off.`
          : tr`Something went wrong. Resume picks up where it left off.`,
        finished: { open: null, remove: true, resume: true },
        chip: { kind: 'glyph', icon: 'warning', text: tr`Stopped`, label: plural(totalCount, { one: `${title} stopped at ${landedText} of # files. Open the import`, other: `${title} stopped at ${landedText} of # files. Open the import` }) },
      };
    }
  }
}

// Waiting for room: what it waits for, and the one step that brings the rest.
function waitBox({ reason, offer, plan, own, ownerName, thing }) {
  const aside = tr`Or free up room — it picks up by itself.`;
  if (!own) {
    return {
      text: [ownerName
        ? tr`${ownerName}’s plan is full. It picks up by itself when ${ownerName} makes room.`
        : tr`The owner’s plan is full. It picks up by itself when the owner makes room.`],
      action: null, aside: null,
    };
  }
  if (plan === 'trial' && reason === 'storage') {
    return { text: [tr`Your trial’s ${ph({ TRIAL_STORAGE_LABEL: trialStorageLabel() })} drive is full. Your first payment makes it ${ph({ CREATOR_STORAGE_LABEL: creatorStorageLabel() })}; drop the ${select(thing, { zip: 'zip', zips: 'zips', folder: 'folder', folders: 'folders', other: 'folder' })} again then to bring the rest.`], action: null, aside: null };
  }
  if (offer === 'trial' || offer === 'upgrade') {
    let text;
    if (offer === 'trial') {
      text = reason === 'storage'
        ? rich(tr`Your free storage is full. **${PLAN_NAME}** brings in the rest — more room, free for ${CREATOR_TRIAL_DAYS} days, card required.`)
        : rich(tr`Your free plan is full. **${PLAN_NAME}** brings in the rest — unlimited cards, free for ${CREATOR_TRIAL_DAYS} days, card required.`);
    } else {
      text = reason === 'storage'
        ? rich(tr`Your free storage is full. **${PLAN_NAME}** brings in the rest — a ${ph({ CREATOR_STORAGE_LABEL: creatorStorageLabel() })} drive.`)
        : rich(tr`Your free plan is full. **${PLAN_NAME}** brings in the rest — unlimited cards.`);
    }
    return {
      text,
      action: { id: 'upgrade', label: offer === 'trial' ? CTA.tryCreatorShort : tr`Upgrade` },
      aside,
    };
  }
  if (offer === 'addon') {
    return { text: rich(tr`Your drive is full. Adding **${ph({ STORAGE_ADDON_BLOCK_LABEL: addonBlockLabel() })}** brings in the rest.`), action: { id: 'addon', label: tr`Add ${ph({ STORAGE_ADDON_BLOCK_LABEL: addonBlockLabel() })}` }, aside };
  }
  return { text: [tr`Your drive is full. It picks up by itself once deleting files or emptying the trash makes room.`], action: null, aside: null };
}

// ── The Files row of a cluster whose files wait for room (r5-Land-Wait) ─────
// At the top of the cluster's Files while its import waits: how many, why,
// and the tray's one step (waitBox's action, so the two never disagree).
// name: the cluster's own name; the rest as trayCopy's entry. → null when
// nothing of it waits.
export function waitRowCopy({ waiting = 0, name = '', reason = null, offer, plan, own, ownerName, trialOffer, trialAtWall, addon, source, zips, tops } = {}) {
  if (!(Number(waiting) > 0)) return null;
  const pick = offer !== undefined ? offer : offerFor({ own, plan, stoppedBy: reason, trialOffer, trialAtWall, addon });
  const box = waitBox({ reason, offer: pick, plan, own, ownerName, thing: thingOf({ source, zips, tops }) });
  let why;
  if (!own) {
    why = ownerName
      ? tr`${ownerName}’s plan is full; with this tab open they come in by themselves once there’s room.`
      : tr`The owner’s plan is full; with this tab open they come in by themselves once there’s room.`;
  } else if (plan === 'trial' && reason === 'storage') why = box.text.join('');
  else if (pick === 'trial' || pick === 'upgrade') {
    why = reason === 'storage'
      ? tr`Your free storage is full; with this tab open they come in by themselves once there’s room.`
      : tr`Your free plan is full; with this tab open they come in by themselves once there’s room.`;
  } else if (box.action) why = tr`Your drive is full; with this tab open they come in by themselves once there’s room.`;
  else why = tr`Your drive is full; with this tab open they come in by themselves once deleting files or emptying the trash makes room.`;
  const waitingCount = cnt(waiting);
  // Two whole sentences, joined.
  return { title: plural(waitingCount, { one: `# waiting for room`, other: `# waiting for room` }), sub: name ? joinSentences(tr`The rest of ${name}.`, why) : why, action: box.action };
}

// ── Where the files land (r5-Land-*) ────────────────────────────────────────
// The empty canvas of a cluster whose files are in Files. `total` files are in
// Files, `ready` of them finished (the rest still coming in: they can't go on
// the board yet, because their finished size would undo the layout); `kind`
// 'image' or 'video' when they all are one; `waiting` and `path` from the
// import that made the cluster (importJobs.importForBoard), when this tab ran
// it; `cap` the most one Put places. → { title, sub, put (null: nothing
// ready), choose }.
function landTitle(kind, total, ready) {
  const count = cnt(total);
  if (ready > 0) {
    if (kind === 'image') return plural(count, { one: '# photo is in Files', other: '# photos are in Files' });
    if (kind === 'video') return plural(count, { one: '# video is in Files', other: '# videos are in Files' });
    return plural(count, { one: '# file is in Files', other: '# files are in Files' });
  }
  if (kind === 'image') return plural(count, { one: '# photo is coming in', other: '# photos are coming in' });
  if (kind === 'video') return plural(count, { one: '# video is coming in', other: '# videos are coming in' });
  return plural(count, { one: '# file is coming in', other: '# files are coming in' });
}

export function landingCopy({ total = 0, ready = 0, kind = null, waiting = 0, path = null, cap = Infinity } = {}) {
  const coming = Math.max(0, total - ready);
  const title = landTitle(kind, total, ready);
  const sub = [];
  if (path) sub.push(tr`From ${path}.`);
  const comingCount = cnt(coming);
  const waitingCount = cnt(waiting);
  if (ready > 0 && coming > 0 && waiting > 0) {
    sub.push(tr`${plural(comingCount, { one: '# is', other: '# are' })} still coming in, and ${plural(waitingCount, { one: '# more is', other: '# more are' })} waiting for room.`);
  } else if (ready > 0 && coming > 0) sub.push(plural(comingCount, { one: '# of them is still coming in.', other: '# of them are still coming in.' }));
  else if (waiting > 0) sub.push(plural(waitingCount, { one: '# more is waiting for room.', other: '# more are waiting for room.' }));
  if (coming > 0 || waiting > 0) sub.push(tr`Nothing goes on the board until you put it there.`);
  else sub.push(total === 1 ? tr`It stays off the board until you put it there.` : tr`They stay off the board until you put them on it — all of them, or the ones you choose.`);
  const n = Math.min(ready, cap);
  const firstCount = cnt(n);
  const readyCount = cnt(ready);
  const put = ready <= 0 ? null
    : n < ready ? plural(firstCount, { one: `Put the first # on the board`, other: `Put the first # on the board` })
    : ready < total ? plural(readyCount, { one: `Put # on the board`, other: `Put # on the board` })
    : total === 1 ? tr`Put it on the board` : tr`Put them on the board`;
  return { title, sub: joinSentences(sub), put, choose: tr`Choose in Files` };
}
