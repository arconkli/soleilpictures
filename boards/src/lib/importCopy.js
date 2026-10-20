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
  CTA, CREATOR_STORAGE_LABEL, CREATOR_TRIAL_DAYS, PLAN_NAME, PRICING,
  STORAGE_ADDON_BLOCK_LABEL, STORAGE_ADDON_PRICING, TRIAL_STORAGE_LABEL,
} from './billingCopy.js';

export const countLabel = (n) => Math.max(0, Math.round(Number(n) || 0)).toLocaleString('en-US');
const nOf = (n, one, many = `${one}s`) => `${countLabel(n)} ${Number(n) === 1 ? one : many}`;

// "26.4 GB", "241 GB", "1.2 TB": one decimal until three digits. `fixed`
// keeps a whole number's ".0", for a column of sizes ("2.0 GB" over "1.9 GB").
export function sizeLabel(bytes, { fixed = false } = {}) {
  const b = Math.max(0, Number(bytes) || 0);
  for (const [u, n] of [['TB', 1024 ** 4], ['GB', 1024 ** 3], ['MB', 1024 ** 2], ['KB', 1024]]) {
    if (b >= n) {
      const v = b / n;
      return `${v >= 100 ? Math.round(v) : fixed ? v.toFixed(1) : Math.round(v * 10) / 10} ${u}`;
    }
  }
  return `${Math.round(b)} B`;
}

// A drive label as bytes ('100GB' → 100 GiB, binary as the product labels it).
const UNITS = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
export function labelBytes(label) {
  const m = /^(\d+(?:\.\d+)?)\s*(KB|MB|GB|TB)$/i.exec(String(label || '').trim());
  return m ? Number(m[1]) * UNITS[m[2].toUpperCase()] : null;
}

export function etaLabel(ms) {
  if (!(Number(ms) > 0)) return null;
  const min = Math.round(ms / 60000);
  if (min < 1) return 'Less than a minute left';
  if (min < 60) return `About ${min} min left`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `About ${h} hr${m ? ` ${m} min` : ''} left`;
}

const pctOf = (part, whole) => (whole > 0 ? Math.min(100, Math.round((1000 * part) / whole) / 10) : 0);
const WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const possessive = (name) => (name ? `${name}’s` : 'the owner’s');

// What the person dropped, for "drop the folder again".
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
//   addon  extra storage can be bought here (not held, under the maximum)
export function offerFor({ own, plan, stoppedBy, trialOffer = false, addon = false }) {
  if (!own) return null;
  if (plan === 'free') return trialOffer ? 'trial' : 'upgrade';
  if (plan === 'paid' && stoppedBy === 'storage' && addon) return 'addon';
  return null;
}

// ── The question ────────────────────────────────────────────────────────────
// Asked only when something would wait: an import that fits starts at once.
export function askCopy({
  title, source = 'folder', zips = 0, tops = 1, folders = null, splits = [],
  totals, fit, waiting, stoppedBy = null, budgets = {}, clusterCost = 0,
  plan = 'free', own = true, ownerName = null, workspaceName = null,
  trialOffer = false, addon = false, interval = 'month', firstPayment = null,
}) {
  const nFolders = folders ?? totals.clusters;
  const thing = thingOf({ source, zips, tops });
  const fitN = countLabel(fit.files);
  const allN = countLabel(totals.files);
  const left = sizeLabel(budgets?.bytesLeft);
  const offer = offerFor({ own, plan, stoppedBy, trialOffer, addon });
  const all = fitsAfter({ budgets, bytes: totals.bytes, offer });

  const sub = `${nOf(totals.files, 'file')} in ${nOf(nFolders, 'folder')} · ${sizeLabel(totals.bytes)}${zips > 1 ? ` · ${zips} zips` : ''}`;

  let fitText;
  if (!own) fitText = `fit on ${possessive(ownerName)} plan`;
  else if (stoppedBy === 'storage') fitText = plan === 'trial' ? `fit in your trial’s ${left} left` : `fit in the ${left} you have left`;
  else fitText = 'fit on your free plan';

  let lede = '';
  if (!own) {
    lede = `${workspaceName ? `${workspaceName} is` : 'This is'} ${possessive(ownerName)} workspace, so what you add counts toward ${possessive(ownerName)} plan.`;
  } else if (plan === 'trial' && stoppedBy === 'storage') {
    lede = `While you’re trying ${PLAN_NAME} your drive is ${TRIAL_STORAGE_LABEL}. Your first payment${firstPayment ? `, on ${firstPayment},` : ''} makes it ${CREATOR_STORAGE_LABEL}.`;
  } else if (stoppedBy === 'cards') {
    let split = '';
    if (splits.length === 1) split = ` (${splits[0].name} splits in ${WORDS[splits[0].of] || `${splits[0].of} parts`})`;
    else if (splits.length > 1) split = ` (${splits.length} big folders split into parts)`;
    const shape = nFolders === 1 && totals.clusters === 1
      ? 'It becomes one cluster, and its files go to that cluster’s Files.'
      : `Its ${nOf(nFolders, 'folder')} become ${nOf(totals.clusters, 'cluster')}${split}, and each folder’s files go to its cluster’s Files.`;
    lede = `${shape} ${clusterCost > 0 ? 'Each cluster counts as a card.' : 'Clusters don’t count as cards.'} Nothing is laid out on a board.`;
  }

  let offerBox = null;
  if (offer === 'trial') {
    offerBox = { name: PLAN_NAME, text: `Unlimited cards${all ? ` and room for all ${sizeLabel(totals.bytes)}` : `, and a ${TRIAL_STORAGE_LABEL} drive until the first payment makes it ${CREATOR_STORAGE_LABEL}`}. Free for ${CREATOR_TRIAL_DAYS} days, then ${PRICING.monthly.perMonthLabel} a month. Card required.` };
  } else if (offer === 'upgrade') {
    offerBox = { name: PLAN_NAME, text: `Unlimited cards and ${all ? `room for all ${sizeLabel(totals.bytes)}` : `a ${CREATOR_STORAGE_LABEL} drive`}. ${PRICING.monthly.perMonthLabel} a month, or ${PRICING.annual.perMonthLabel} a month billed yearly.` };
  } else if (offer === 'addon') {
    const per = interval === 'year' ? STORAGE_ADDON_PRICING.annual.perLabel : STORAGE_ADDON_PRICING.monthly.perLabel;
    offerBox = { name: 'Extra storage', text: `Add ${STORAGE_ADDON_BLOCK_LABEL} to your drive for ${per}, on your ${PLAN_NAME} bill.` };
  }

  const dropAgain = `Closed the tab? Drop the ${thing} again — what’s in is skipped.`;
  let note;
  if (!own) {
    note = fit.files > 0
      ? `Bring ${fitN} now and the rest waits in this tab until ${ownerName || 'the owner'} has room.`
      : `Nothing fits yet. It waits in this tab and comes in once ${ownerName || 'the owner'} has room.`;
  } else if (plan === 'trial' && stoppedBy === 'storage') {
    note = `After your first payment${firstPayment ? ` on ${firstPayment}` : ''}, drop the ${thing} again to bring the rest — what’s in already is skipped.`;
  } else if (offer === 'addon') {
    note = `${fit.files > 0 ? `Bring ${fitN} now and the rest` : 'It'} waits in this tab; it comes in as soon as the ${STORAGE_ADDON_BLOCK_LABEL} is added.`;
  } else if (plan === 'paid') {
    note = `${fit.files > 0 ? `Bring ${fitN} now and the rest` : 'It'} waits in this tab, and picks up by itself once deleting files or emptying the trash makes room.`;
  } else {
    note = `${fit.files > 0 ? `Bring ${fitN} now and the rest waits in this tab, coming in` : 'Nothing fits yet. It waits in this tab and comes in'} once there’s room. ${dropAgain}`;
  }

  const actions = [{ id: 'cancel', label: 'Cancel', tone: null }];
  actions.push({ id: 'fit', label: fit.files > 0 ? `Bring ${fitN} now` : 'Keep it waiting', tone: offer ? null : 'default' });
  if (offer === 'trial') actions.push({ id: 'all', label: `${CTA.tryCreatorShort}${all ? ` — bring all ${allN}` : ''}`, tone: 'primary' });
  else if (offer === 'upgrade') actions.push({ id: 'all', label: all ? `Upgrade — bring all ${allN}` : `Upgrade to ${PLAN_NAME}`, tone: 'primary' });
  else if (offer === 'addon') actions.push({ id: 'all', label: `Add ${STORAGE_ADDON_BLOCK_LABEL}${all ? ` — bring all ${allN}` : ''}`, tone: 'primary' });

  return {
    kicker: 'Import', title, sub,
    pct: pctOf(fit.files, totals.files),
    fit: { n: fitN, text: fitText },
    wait: { n: countLabel(waiting.files), text: 'would wait' },
    lede, offer: offerBox, note, actions, offerKind: offer,
  };
}

// ── The zip question ───────────────────────────────────────────────────────
// Asked when zips are dropped, before anything is read: unpack them into
// clusters, or add them as they are. Built from names and sizes alone, so a
// "keep" costs nothing. zips: [{ name, size }] in drop order; groups:
// zipRead.groupArchives(names) (several parts of one export make one group).
const word = (n) => WORDS[n] || countLabel(n);
const ZIP_ROWS = 4;

function exportOf(name) {
  if (/^takeout-\d{8}T\d{6}Z-\d{3}\.zip$/i.test(name)) return 'one Google Takeout export';
  if (/^drive-download-\d{8}T\d{6}Z-\d{3}\.zip$/i.test(name)) return 'one Google Drive download';
  return null;
}

export function zipAskCopy({ zips = [], groups = [] } = {}) {
  const n = zips.length;
  const many = n !== 1;
  const total = zips.reduce((t, z) => t + (Number(z.size) || 0), 0);
  const oneExport = groups.length === 1 && n > 1;
  const what = oneExport ? (exportOf(String(zips[0]?.name || '')) || `one export in ${word(n)} parts`) : null;
  const lede = oneExport
    ? `Unpacked, the ${word(n)} parts become one tree: every folder in it becomes a cluster, and its files go to that cluster’s Files.`
    : !many
      ? 'Unpacked, every folder in it becomes a cluster, and its files go to that cluster’s Files.'
      : `Unpacked, each ${groups.length < n ? 'export' : 'zip'} becomes a cluster with a cluster for every folder in it, and each file goes to its cluster’s Files.`;
  return {
    kicker: many ? 'Zip files' : 'Zip file',
    title: many ? 'Unpack these into clusters?' : 'Unpack this into clusters?',
    sub: [`${nOf(n, 'zip')}`, sizeLabel(total), what].filter(Boolean).join(' · '),
    rows: zips.slice(0, ZIP_ROWS).map((z) => ({ name: String(z.name || ''), size: sizeLabel(z.size, { fixed: true }) })),
    more: n > ZIP_ROWS ? `and ${countLabel(n - ZIP_ROWS)} more` : null,
    lede,
    note: many ? `Or add them as ${word(n)} zip files, each kept whole in Files.` : 'Or add it as a zip file, kept whole in Files.',
    actions: [
      { id: 'keep', label: many ? `Add as ${countLabel(n)} zip files` : 'Add as a zip file', tone: null },
      { id: 'unpack', label: 'Unpack into clusters', tone: 'default' },
    ],
  };
}

// ── The tray ────────────────────────────────────────────────────────────────
// A failure in words a person can act on. The zip reader's own failures come
// first: "more than its declared size" is a damaged entry, not a plan limit.
export function failReason(message) {
  const m = String(message || '');
  if (/to unpack here/i.test(m)) return 'Too large to unpack here — unzip it on your computer';
  if (/cannot decompress/i.test(m)) return 'This browser can’t unpack it';
  if (/declared size|checksum|damaged|incomplete|past the end/i.test(m)) return 'Damaged inside the zip';
  if (/NotReadable|NotFound|could not be read|couldn.t be read|permission/i.test(m)) return 'Couldn’t be read from the folder';
  if (/changed|modified/i.test(m)) return 'It changed while it was uploading';
  if (/too large|too big|size limit|exceeds/i.test(m)) return 'Too large for this plan';
  if (/fetch|network|connection|offline/i.test(m)) return 'The connection dropped';
  return 'Couldn’t be uploaded';
}

const FAILS_SHOWN = 5;

// entry: { phase: 'reading'|'job', title, reading: { files, folders, bytes },
//          snap (importJob state), offer, plan, own, ownerName, source, zips,
//          targetName }
export function trayCopy(entry) {
  const title = entry.title || 'Import';
  if (entry.phase === 'queued') {
    const r = entry.reading || {};
    return {
      title, close: 'collapse',
      line: [{ b: countLabel(r.files) }, ` ${Number(r.files) === 1 ? 'file' : 'files'} in ${nOf(r.folders || 0, 'folder')}`],
      bar: null, meta: 'Starts when the import before it has finished.',
      rows: [], wait: null, finished: null, fails: null,
      foot: { meta: null, actions: [{ id: 'cancel', label: 'Cancel' }] },
      chip: { kind: 'glyph', icon: 'clock', text: 'Queued', label: `${title} starts when the import before it has finished. Open the import` },
    };
  }
  // Stopped by a reload or a closed tab (mockup r4-Tray-Reload / Tray-Drop):
  // where this browser kept the folder, Resume; elsewhere, drop it again.
  if (entry.phase === 'stopped') {
    const landedN = Number(entry.landed) || 0;
    const total = Number(entry.total) || 0;
    const st = entry.stopped || {};
    const tops = st.tops || [];
    const zips = st.zips || [];
    const what = st.source === 'zip'
      ? (zips.length === 1 ? String(zips[0]) : zips.length ? `the ${zips.length} zips` : title)
      : (tops.length > 1 ? `the ${tops.length} folders` : title);
    const where = entry.targetName ? ` on ${entry.targetName}` : '';
    return {
      title: `${title} stopped`, close: 'collapse',
      line: [{ b: countLabel(landedN) }, ` of ${countLabel(total)} files are in`],
      bar: { pct: pctOf(landedN, total) },
      meta: entry.canResume
        ? 'The page reloaded, so the upload stopped. Resume picks up where it left off; your browser asks to read the folder again first.'
        : `The page reloaded, so the upload stopped. Drop ${what}${where} again to bring the rest — files already in are skipped.`,
      rows: [], wait: null, fails: null, foot: null,
      finished: { open: null, remove: true, resume: !!entry.canResume },
      chip: { kind: 'glyph', icon: 'x', text: 'Stopped', label: `${title} stopped at ${countLabel(landedN)} of ${countLabel(total)} files. Open the import` },
    };
  }
  if (entry.phase === 'reading') {
    const r = entry.reading || {};
    return {
      title: `Reading ${title}…`, close: 'collapse',
      line: [{ b: countLabel(r.files) }, ` ${Number(r.files) === 1 ? 'file' : 'files'} in ${nOf(r.folders || 0, 'folder')}${r.bytes ? ` · ${sizeLabel(r.bytes)} so far` : ''}`],
      bar: { reading: true },
      meta: 'Counting first, so you see what fits before anything moves. Nothing has uploaded yet.',
      rows: [], wait: null, finished: null, fails: null,
      foot: { meta: null, actions: [{ id: 'cancel', label: 'Cancel' }] },
      chip: { kind: 'ring', pct: null, text: 'Reading', label: `Reading ${title}: ${countLabel(r.files)} files so far. Open the import` },
    };
  }

  const s = entry.snap || {};
  const total = s.totals?.files || 0;
  const landedN = s.landed?.files || 0;
  const filesPct = pctOf(landedN, total);
  const bytesPct = s.totals?.bytes > 0 ? pctOf(s.sentBytes || 0, s.totals.bytes) : filesPct;
  const thing = thingOf({ source: entry.source, zips: entry.zips, tops: (s.tops || []).length });
  const eta = etaLabel(s.etaMs);
  const failed = s.failed || [];
  const soleTop = (s.tops || []).length === 1 ? s.tops[0] : null;
  const progressLine = [{ b: countLabel(landedN) }, ` of ${countLabel(total)} files${s.totals?.bytes ? ` · ${sizeLabel(s.sentBytes || 0)} of ${sizeLabel(s.totals.bytes)}` : ''}`];

  const rows = (s.rows || []).length > 1 ? s.rows.map((r) => {
    if (r.landed >= r.files) return { key: r.key, name: r.name, state: 'done', count: countLabel(r.files), pct: 100 };
    if (r.key === s.currentRow && s.status === 'running') return { key: r.key, name: r.name, state: 'now', count: `${countLabel(r.landed)} of ${countLabel(r.files)}`, pct: pctOf(r.landed, r.files) };
    if (r.landed > 0) return { key: r.key, name: r.name, state: 'part', count: `${countLabel(r.landed)} of ${countLabel(r.files)}`, pct: pctOf(r.landed, r.files) };
    return { key: r.key, name: r.name, state: 'later', count: countLabel(r.files), pct: 0 };
  }) : [];

  const base = { close: 'collapse', rows: [], wait: null, finished: null, fails: null, foot: null, meta: null, bar: null };
  const open = soleTop?.boardId ? { boardId: soleTop.boardId, label: `Open ${soleTop.name}` } : null;

  switch (s.status) {
    case 'idle':
    case 'creating':
      return {
        ...base, title: `Importing ${title}`,
        line: [`Making ${nOf(s.totals?.clusters || 0, 'cluster')}…`],
        bar: { pct: 0 }, meta: 'Keep this tab open',
        foot: { meta: null, actions: [{ id: 'cancel', label: 'Cancel' }] },
        chip: { kind: 'ring', pct: 0, text: '0%', label: `Importing ${title}: making its clusters. Open the import` },
      };
    case 'running':
      return {
        ...base, title: `Importing ${title}`, line: progressLine, bar: { pct: bytesPct },
        meta: eta ? `${eta} · keep this tab open` : 'Keep this tab open', rows,
        foot: { meta: null, actions: [{ id: 'pause', label: 'Pause', icon: 'pause' }, { id: 'cancel', label: 'Cancel' }] },
        chip: { kind: 'ring', pct: bytesPct, text: `${Math.floor(bytesPct)}%`, label: `Importing ${title}: ${countLabel(landedN)} of ${countLabel(total)} files${eta ? `, ${eta.toLowerCase()}` : ''}. Open the import` },
      };
    case 'paused':
      return {
        ...base, title: `${title} is paused`, line: progressLine, bar: { pct: bytesPct },
        meta: 'Nothing is uploading. Resume picks up where it left off.', rows,
        foot: { meta: null, actions: [{ id: 'resume', label: 'Resume', icon: 'play' }, { id: 'cancel', label: 'Cancel' }] },
        chip: { kind: 'glyph', icon: 'pause', text: 'Paused', label: `${title} is paused at ${countLabel(landedN)} of ${countLabel(total)} files. Open the import` },
      };
    case 'waiting':
      return {
        ...base, title,
        // No folder list here (the owner's pick): the wait box and its one step are the point.
        line: [{ b: countLabel(landedN) }, ' in · ', { b: countLabel(s.waiting?.files || 0) }, ' waiting for room'],
        bar: { pct: filesPct },
        wait: waitBox({
          ...entry, reason: s.waitingReason, thing,
          offer: entry.offer !== undefined ? entry.offer
            : offerFor({ own: entry.own, plan: entry.plan, stoppedBy: s.waitingReason, trialOffer: entry.trialOffer, addon: entry.addon }),
        }),
        foot: { meta: 'They wait in this tab — keep it open.', actions: [{ id: 'cancel', label: 'Stop' }] },
        chip: { kind: 'glyph', icon: 'clock', text: 'Waiting', label: `${title}: ${countLabel(landedN)} in, ${countLabel(s.waiting?.files || 0)} waiting for room. Open the import` },
      };
    case 'done':
      return {
        ...base, title: `${title} is in`, close: 'close',
        line: [{ b: countLabel(landedN) }, ` ${landedN === 1 ? 'file' : 'files'} in ${nOf(s.totals?.clusters || 0, 'cluster')}${entry.targetName ? `, inside ${entry.targetName}` : ''}`],
        finished: { open, remove: true },
        fails: failed.length ? {
          head: `${nOf(failed.length, 'file')} couldn’t be brought in`,
          list: failed.slice(0, FAILS_SHOWN).map((f) => ({ path: f.relPath, why: failReason(f.message) })),
          more: failed.length > FAILS_SHOWN ? `and ${countLabel(failed.length - FAILS_SHOWN)} more` : null,
          retry: true,
        } : null,
        chip: failed.length
          ? { kind: 'glyph', icon: 'warning', text: `${countLabel(failed.length)} failed`, label: `${title} is in; ${nOf(failed.length, 'file')} couldn’t be brought in. Open the import` }
          : { kind: 'glyph', icon: 'check', text: 'Done', label: `${title} is in. Open the import` },
      };
    case 'cancelled':
      return {
        ...base, title: `${title} stopped`, close: 'close',
        line: [{ b: countLabel(landedN) }, ` of ${countLabel(total)} files are in`],
        finished: { open: landedN > 0 ? open : null, remove: landedN > 0 || (s.tops || []).some((t) => t.boardId) },
        chip: { kind: 'glyph', icon: 'x', text: 'Stopped', label: `${title} stopped at ${countLabel(landedN)} of ${countLabel(total)} files. Open the import` },
      };
    case 'failed':
    default:
      // Closing keeps what is in and lets the rest go, as Stop does.
      return {
        ...base, title: `${title} stopped`, close: 'close',
        line: [{ b: countLabel(landedN) }, ` of ${countLabel(total)} files are in`],
        bar: { pct: filesPct },
        meta: `Something went wrong${s.error ? ` — ${s.error}` : ''}. Resume picks up where it left off.`,
        finished: { open: null, remove: true, resume: true },
        chip: { kind: 'glyph', icon: 'warning', text: 'Stopped', label: `${title} stopped at ${countLabel(landedN)} of ${countLabel(total)} files. Open the import` },
      };
  }
}

// Waiting for room: what it waits for, and the one step that brings the rest.
function waitBox({ reason, offer, plan, own, ownerName, thing }) {
  const aside = 'Or free up room — it picks up by itself.';
  if (!own) {
    return { text: [`${ownerName ? `${ownerName}’s` : 'The owner’s'} plan is full. It picks up by itself when ${ownerName || 'the owner'} makes room.`], action: null, aside: null };
  }
  if (plan === 'trial' && reason === 'storage') {
    return { text: [`Your trial’s ${TRIAL_STORAGE_LABEL} drive is full. Your first payment makes it ${CREATOR_STORAGE_LABEL}; drop the ${thing} again then to bring the rest.`], action: null, aside: null };
  }
  if (offer === 'trial' || offer === 'upgrade') {
    const what = reason === 'storage' ? 'Your free storage is full. ' : 'Your free plan is full. ';
    const why = offer === 'trial'
      ? ` brings in the rest — ${reason === 'storage' ? 'more room' : 'unlimited cards'}, free for ${CREATOR_TRIAL_DAYS} days, card required.`
      : ` brings in the rest — ${reason === 'storage' ? `a ${CREATOR_STORAGE_LABEL} drive` : 'unlimited cards'}.`;
    return {
      text: [what, { b: PLAN_NAME }, why],
      action: { id: 'upgrade', label: offer === 'trial' ? CTA.tryCreatorShort : 'Upgrade' },
      aside,
    };
  }
  if (offer === 'addon') {
    return { text: ['Your drive is full. Adding ', { b: STORAGE_ADDON_BLOCK_LABEL }, ' brings in the rest.'], action: { id: 'addon', label: `Add ${STORAGE_ADDON_BLOCK_LABEL}` }, aside };
  }
  return { text: ['Your drive is full. It picks up by itself once deleting files or emptying the trash makes room.'], action: null, aside: null };
}

// ── Where the files land (r5-Land-*) ────────────────────────────────────────
// The empty canvas of a cluster whose files are in Files. `total` files are in
// Files, `ready` of them finished (the rest still coming in: they can't go on
// the board yet, because their finished size would undo the layout); `kind`
// 'image' or 'video' when they all are one; `waiting` and `path` from the
// import that made the cluster (importJobs.importForBoard), when this tab ran
// it; `cap` the most one Put places. → { title, sub, put (null: nothing
// ready), choose }.
const LAND_NOUN = { image: ['photo', 'photos'], video: ['video', 'videos'] };
export function landingCopy({ total = 0, ready = 0, kind = null, waiting = 0, path = null, cap = Infinity } = {}) {
  const [one, many] = LAND_NOUN[kind] || ['file', 'files'];
  const coming = Math.max(0, total - ready);
  const is = (n) => (n === 1 ? 'is' : 'are');
  const title = `${countLabel(total)} ${total === 1 ? one : many} ${is(total)} ${ready > 0 ? 'in Files' : 'coming in'}`;
  const sub = [];
  if (path) sub.push(`From ${path}.`);
  if (ready > 0 && coming > 0 && waiting > 0) sub.push(`${countLabel(coming)} ${is(coming)} still coming in, and ${countLabel(waiting)} more ${is(waiting)} waiting for room.`);
  else if (ready > 0 && coming > 0) sub.push(`${countLabel(coming)} of them ${is(coming)} still coming in.`);
  else if (waiting > 0) sub.push(`${countLabel(waiting)} more ${is(waiting)} waiting for room.`);
  if (coming > 0 || waiting > 0) sub.push('Nothing goes on the board until you put it there.');
  else sub.push(total === 1 ? 'It stays off the board until you put it there.' : 'They stay off the board until you put them on it — all of them, or the ones you choose.');
  const n = Math.min(ready, cap);
  const put = ready <= 0 ? null
    : n < ready ? `Put the first ${countLabel(n)} on the board`
    : ready < total ? `Put ${countLabel(ready)} on the board`
    : total === 1 ? 'Put it on the board' : 'Put them on the board';
  return { title, sub: sub.join(' '), put, choose: 'Choose in Files' };
}
