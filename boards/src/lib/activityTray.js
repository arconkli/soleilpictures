// activityTray — the activity tray's rules and words. Pure: no React, no clock
// reads (`now` is a parameter), so every word and every "when does it show"
// rule is node-testable. components/ActivityTray.jsx draws what this returns.
//
// One tray holds what this tab is moving or waiting on: upload batches
// (lib/activity.js), the canvas connection (lib/canvasConnection.js), files held
// for room (lib/heldUploads.js) and the bulk import (lib/importJob.js). Each is
// a section; the folded chip and the phone's slim bar speak for the lead one.
//
// `parts` are rich text: strings and { b } runs, the shape ImportTray's Rich
// renders. Every `line` is parts; `meta` is a plain string.

import { batchEtaMs, canCancelTransfer } from './activity.js';
import { etaWords, etaShort, opWords } from './activityWords.js';
import { sizeLabel, countLabel } from './importCopy.js';

export const SHOW_AFTER_MS = 1000;      // an upload batch done inside this never shows
export const OFFLINE_AFTER_MS = 2000;   // offline for less than this shows nothing
const ROW_CAP = 50;

const ACTIVE = new Set(['waiting', 'running', 'finishing']);
const DIDNT = 'Didn’t upload';
const UNITS = { TB: 1024 ** 4, GB: 1024 ** 3, MB: 1024 ** 2, KB: 1024, B: 1 };

const filesOf = (n) => `${countLabel(n)} ${n === 1 ? 'file' : 'files'}`;
const plain = (parts) => parts.map((p) => (typeof p === 'string' ? p : p.b)).join('');
const pctOf = (it) => Math.min(99, Math.floor((it.fraction || 0) * 100));

// "0.4 of 1.6 GB": the total through importCopy's sizeLabel, the sent part in
// the same unit, one decimal under 100, ".0" dropped.
function sizePair(sent, bytes) {
  const total = sizeLabel(bytes);
  const unit = total.split(' ')[1];
  if (!(sent > 0)) return `0 of ${total}`;
  const v = sent / (UNITS[unit] || 1);
  return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10} of ${total}`;
}

function withLabel(chip) {
  if (!chip || chip.label) return chip;
  return { ...chip, label: `${plain(chip.parts)}${chip.chevron ? '. Open' : ''}` };
}

const chipOf = (parts, icon, { pct = null, tone = null, action = null, chevron = true } = {}) => withLabel({
  key: null, parts, icon, pct, tone, action, chevron,
});

function failRow(it) {
  return {
    key: it.id, tid: it.id, state: 'fail', name: it.label, thumb: it.thumb || null, mime: it.mime || '',
    pct: null, c: null,
    why: it.retryOnline ? `${DIDNT} · connection dropped` : (it.error && it.error !== DIDNT ? it.error : DIDNT),
    retry: !!it.actions?.retry,
    button: it.actions?.remove ? { id: 'remove', label: it.version ? 'Dismiss' : 'Remove this file' } : { id: 'dismiss-row', label: 'Dismiss' },
  };
}

function row(it, state, c, extra = {}) {
  return {
    key: it.id, tid: it.id, state, name: it.label, thumb: it.thumb || null, mime: it.mime || '',
    pct: null, c, why: null, retry: false, button: null, ...extra,
  };
}

function batchSection(batch, all, now) {
  const mine = all.filter((i) => i.batch === batch.id && !i.parked);
  const n = { total: mine.length, done: 0, failed: 0, waiting: 0, running: 0 };
  let bytes = 0;
  let sent = 0;
  let lastDoneAt = batch.createdAt;
  for (const i of mine) {
    if (i.state === 'done') { n.done++; lastDoneAt = Math.max(lastDoneAt, i.doneAt ?? 0); }
    else if (i.state === 'failed') n.failed++;
    else if (i.state === 'waiting') n.waiting++;
    else n.running++;   // running and finishing
    bytes += i.bytesTotal || 0;
    sent += i.state === 'done' ? (i.bytesTotal || 0) : (i.sentBytes || 0);
  }
  const active = n.waiting + n.running > 0;
  const paused = active && !!batch.paused;
  const single = n.total === 1;
  const finished = !active;

  const hiddenByDismiss = batch.dismissed && !active;
  const aged = now - batch.createdAt >= SHOW_AFTER_MS;
  const visible = !hiddenByDismiss && (n.failed > 0 || (aged && (active || lastDoneAt - batch.createdAt >= SHOW_AFTER_MS)));
  // The moment a not-yet-visible batch becomes visible by age alone.
  const wake = !hiddenByDismiss && !visible && !aged && (active || lastDoneAt - batch.createdAt >= SHOW_AFTER_MS)
    ? batch.createdAt + SHOW_AFTER_MS : null;
  if (!visible) return { visible: false, wake };

  const where = batch.boardName ? ` to ${batch.boardName}` : '';
  const title = active ? `Uploading ${filesOf(n.total)}${where}`
    : n.done === 0 && n.failed > 0 ? `${DIDNT}${where}` : `Uploaded${where}`;
  const pct = finished ? 100
    : bytes > 0 ? Math.min(100, Math.floor((sent / bytes) * 100))
      : n.total ? Math.min(100, Math.floor((n.done / n.total) * 100)) : 0;
  const eta = active && !paused ? batchEtaMs(batch, mine, now) : null;
  const ofTotal = `${countLabel(n.done)} of ${countLabel(n.total)}`;
  const failedBit = n.failed ? ` · ${countLabel(n.failed)} didn’t upload` : '';

  let line;
  let chipParts;
  let chipIcon;
  let chipTone = null;
  if (single && active) {
    const p = Math.min(99, pct);
    if (paused) { line = ['Paused']; chipParts = ['Paused']; chipIcon = 'pause'; }
    else {
      line = [{ b: `${p}%` }, bytes > 0 ? ` · ${sizePair(sent, bytes)}` : null, etaWords(eta) ? ` · ${etaWords(eta)}` : null].filter(Boolean);
      chipParts = ['Uploading · ', { b: `${p}%` }, etaShort(eta) ? ` · ${etaShort(eta)}` : null].filter(Boolean);
      chipIcon = 'ring';
    }
  } else if (active) {
    if (paused) {
      line = [{ b: ofTotal }, ' uploaded · paused'];
      chipParts = ['Paused · ', { b: ofTotal }];
      chipIcon = 'pause';
    } else {
      line = [{ b: ofTotal }, ' uploaded', bytes > 0 ? ` · ${sizePair(sent, bytes)}` : null,
        etaWords(eta) ? ` · ${etaWords(eta)}` : null, failedBit || null].filter(Boolean);
      chipParts = ['Uploading · ', { b: ofTotal }, etaShort(eta) ? ` · ${etaShort(eta)}` : null, failedBit || null].filter(Boolean);
      chipIcon = 'ring';
    }
  } else if (n.done > 0) {
    line = [{ b: ofTotal }, ' uploaded', failedBit || null].filter(Boolean);
    if (n.failed) { chipParts = [{ b: ofTotal }, ` uploaded${failedBit}`]; chipIcon = 'warning'; chipTone = 'err'; }
    else { chipParts = ['Uploaded · ', { b: ofTotal }]; chipIcon = 'check'; chipTone = 'quiet'; }
    if (single) { chipParts = ['Uploaded']; }
  } else {
    line = [{ b: filesOf(n.failed) }, ' didn’t upload'];
    chipParts = single ? [DIDNT] : [{ b: filesOf(n.failed) }, ' didn’t upload'];
    chipIcon = 'warning';
    chipTone = 'err';
  }

  const rows = [];
  const moving = mine.filter((i) => i.state === 'running' || i.state === 'finishing' || i.state === 'waiting');
  const order = [
    ...moving.filter((i) => i.state === 'running'),
    ...moving.filter((i) => i.state === 'finishing'),
    ...moving.filter((i) => i.state === 'waiting'),
  ];
  for (const it of order.slice(0, ROW_CAP)) {
    if (it.state === 'running') {
      const p = pctOf(it);
      rows.push(row(it, 'now', it.etaText ? `${p}% · ${it.etaText}` : `${p}%`, {
        pct: p, button: canCancelTransfer(it) ? { id: 'cancel', label: 'Cancel this upload' } : null,
      }));
    } else if (it.state === 'finishing') {
      rows.push(row(it, 'busy', 'Making a preview…'));
    } else {
      rows.push(row(it, 'later', it.paused ? 'Paused' : 'Waiting', {
        button: canCancelTransfer(it) ? { id: 'cancel', label: 'Remove this file' } : null,
      }));
    }
  }
  if (order.length > ROW_CAP) {
    rows.push({ key: 'more', tid: null, state: 'more', name: null, thumb: null, mime: '', pct: null, c: `${countLabel(order.length - ROW_CAP)} more waiting`, why: null, retry: false, button: null });
  }
  const failedItems = mine.filter((i) => i.state === 'failed');
  for (const it of failedItems.slice(0, ROW_CAP)) rows.push(failRow(it));
  if (failedItems.length > ROW_CAP) {
    rows.push({ key: 'more-failed', tid: null, state: 'more', name: null, thumb: null, mime: '', pct: null, c: `${countLabel(failedItems.length - ROW_CAP)} more didn’t upload`, why: null, retry: false, button: null });
  }
  if (n.done > 0) {
    const doneItems = mine.filter((i) => i.state === 'done');
    const doneNames = doneItems.slice(0, ROW_CAP).map((i) => ({ key: i.id, name: i.label }));
    if (doneItems.length > ROW_CAP) doneNames.push({ key: 'more-done', name: `${countLabel(doneItems.length - ROW_CAP)} more` });
    rows.push({
      key: 'done-fold', tid: null, state: 'done-fold', name: null, thumb: null, mime: '', pct: null,
      c: `${countLabel(n.done)} uploaded`, why: null, retry: false, button: null,
      done: doneNames,
    });
  }

  const key = `batch:${batch.id}`;
  const chip = chipOf(chipParts, chipIcon, { pct: chipIcon === 'ring' ? pct : null, tone: chipTone });
  chip.key = key;
  return {
    visible: true,
    wake,
    section: {
      key, kind: 'batch', batchId: batch.id, opens: n.total >= 2 || n.failed > 0, chipOnly: false,
      title, announce: title, line, meta: null, pct, active, paused, failed: n.failed, finished,
      counts: { ...n, bytes, sent },
      headAction: active && (n.waiting > 0 || paused)
        ? { id: paused ? 'resume' : 'pause', label: paused ? 'Resume' : 'Pause' } : null,
      close: finished ? 'dismiss' : 'fold',
      rows, chip,
    },
  };
}

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const OP_ICON = { download: 'download', export: 'export', copy: 'copy' };

// A download, export or copy (lib/activityOps.js): one item in its own batch.
// Shown after the batch's showAfterMs (a copy uses 0); one that finished inside
// that beat never shows. Downloads of 2+ files and copies open the tray; a
// single file or an export is a chip.
function opSection(batch, all, now) {
  const it = all.find((i) => i.batch === batch.id && !i.parked);
  if (!it) return { visible: false, wake: null };
  const done = it.state === 'done';
  const active = !done && it.state !== 'failed';
  const beat = batch.showAfterMs ?? SHOW_AFTER_MS;
  const aged = now - batch.createdAt >= beat;
  const lastDoneAt = done ? (it.doneAt ?? batch.createdAt) : batch.createdAt;
  const shown = aged && (active || lastDoneAt - batch.createdAt >= beat);
  const hidden = batch.dismissed && !active;
  const wake = !hidden && !aged && (active || lastDoneAt - batch.createdAt >= beat) ? batch.createdAt + beat : null;
  if (hidden || !shown) return { visible: false, wake };

  const title = opWords(it);
  if (!title) return { visible: false, wake: null };
  const total = it.count?.total || 0;
  const ratio = (it.fraction || 0) > 0 ? it.fraction : total > 0 ? (it.count.done || 0) / total : null;
  const pct = done ? 100 : ratio == null ? null : Math.min(99, Math.floor(ratio * 100));
  const opens = it.kind === 'copy' || (it.kind === 'download' && total >= 2);
  const subject = it.kind === 'download' ? (it.label || 'download') : null;
  const stem = String(title).replace(/…$/, '');
  const cancelAria = subject ? `Cancel download of ${subject}` : `Cancel ${lowerFirst(stem)}`;
  const icon = done ? 'check' : OP_ICON[it.kind] || 'download';
  const tone = done ? 'quiet' : null;
  const chipParts = [title, !done && pct != null ? ' · ' : null, !done && pct != null ? { b: `${pct}%` } : null].filter(Boolean);
  const chip = chipOf(chipParts, icon, { pct: done ? null : pct, tone, chevron: opens });
  chip.key = `op:${batch.id}`;
  return {
    visible: true,
    wake,
    section: {
      key: `op:${batch.id}`, kind: 'op', opKind: it.kind, batchId: batch.id, itemId: it.id, opens, chipOnly: !opens,
      title, announce: it.kind === 'download' && active && total >= 2 ? `Preparing download of ${total} files` : title,
      icon, tone, pct, subject,
      headAction: active && it.cancel ? { label: 'Cancel', aria: cancelAria, run: it.cancel } : null,
      open: done && it.actions?.open ? { label: 'Open', aria: it.kind === 'copy' ? 'Open the copy' : `Open: ${title}`, run: it.actions.open } : null,
      close: done ? 'dismiss' : 'fold', dismissAria: `Dismiss: ${title}`,
      active, finished: done, chip,
    },
  };
}

function connSection({ conn, items, batches, offlineForMs, canRetryConnection }) {
  const keptLine = conn?.kept ? 'Changes you make are kept on this device' : 'Keep this tab open until you’re back online';
  const offline = offlineForMs != null && offlineForMs >= OFFLINE_AFTER_MS;
  const liveBatch = new Set(batches.filter((b) => b.kind === 'upload' && !b.hidden).map((b) => b.id));
  const mineItems = items.filter((i) => liveBatch.has(i.batch) && !i.parked);
  const pausedItems = mineItems.filter((i) => ACTIVE.has(i.state) || (i.state === 'failed' && i.retryOnline));
  if (offline && (conn || pausedItems.length)) {
    const n = pausedItems.length;
    const line = n > 0
      ? `${countLabel(n)} ${n === 1 ? 'upload paused, it’ll' : 'uploads paused, they’ll'} continue when you’re back`
      : conn ? keptLine : 'You’re offline';
    const meta = n > 0 && conn ? (conn.kept ? 'Changes are kept on this device' : 'Keep this tab open until you’re back online') : null;
    const rows = [];
    for (const it of pausedItems.slice(0, ROW_CAP)) {
      const f = pctOf(it);
      rows.push(row(it, 'later', (it.fraction || 0) > 0 ? `Paused at ${f}%` : 'Waiting', { pct: (it.fraction || 0) > 0 ? f : null }));
    }
    if (n > ROW_CAP) rows.push({ key: 'more', tid: null, state: 'more', name: null, thumb: null, mime: '', pct: null, c: `${countLabel(n - ROW_CAP)} more waiting`, why: null, retry: false, button: null });
    const batchesWithPaused = new Set(pausedItems.map((i) => i.batch));
    const chosen = new Set(pausedItems.map((i) => i.id));
    for (const it of mineItems) {
      if (it.state === 'failed' && !chosen.has(it.id) && batchesWithPaused.has(it.batch)) rows.push(failRow(it));
    }
    const chip = chipOf([n > 0 ? `Offline · ${countLabel(n)} paused` : 'Offline'], 'offline');
    chip.key = 'conn';
    return { key: 'conn', kind: 'conn', opens: true, chipOnly: false, title: 'Offline', announce: 'Offline', icon: 'offline', tone: null, line: [line], meta, pct: null, headAction: null, close: 'fold', rows, chip, conn: 'offline' };
  }
  if (conn?.state === 'error') {
    const retry = canRetryConnection ? { id: 'retry-conn', label: 'Retry' } : null;
    const line = conn.kept
      ? 'Your changes are kept on this device and will save when the connection is back'
      : 'Your latest changes aren’t saved yet. Keep this tab open.';
    const chip = chipOf(['Couldn’t save'], 'warning', { tone: 'err', action: retry });
    chip.key = 'conn';
    return { key: 'conn', kind: 'conn', opens: true, chipOnly: false, title: 'Couldn’t save', announce: 'Couldn’t save', icon: 'warning', tone: 'err', line: [line], meta: null, pct: null, headAction: retry, close: 'fold', rows: [], chip, conn: 'error' };
  }
  if (conn?.state === 'reconnecting' && conn.everLive) {
    const chip = chipOf(['Reconnecting…'], 'reconnecting', { chevron: false });
    chip.key = 'conn';
    return { key: 'conn', kind: 'conn', opens: false, chipOnly: true, title: 'Reconnecting…', announce: 'Reconnecting…', icon: 'reconnecting', tone: null, line: null, meta: null, pct: null, headAction: null, close: 'fold', rows: [], chip, conn: 'reconnecting' };
  }
  if (conn?.state === 'saved') {
    const chip = chipOf(['Saved'], 'check', { tone: 'quiet', chevron: false });
    chip.key = 'conn';
    return { key: 'conn', kind: 'conn', opens: false, chipOnly: true, title: 'Saved', announce: 'Saved', icon: 'check', tone: 'quiet', line: null, meta: null, pct: null, headAction: null, close: 'fold', rows: [], chip, conn: 'saved' };
  }
  return null;
}

function heldSection(held) {
  const entries = (held?.entries || []).filter((e) => e.via !== 'import');
  if (!entries.length) return null;
  const count = entries.reduce((n, e) => n + (Number(e.count) || 0), 0);
  const allReady = entries.every((e) => e.ready);
  const paying = !allReady && !!held.awaiting;
  const nf = filesOf(count);
  const chip = allReady ? chipOf(['Ready to upload · ', { b: nf }], 'check')
    : paying ? chipOf(['Waiting for payment · ', { b: nf }], 'clock')
      : chipOf(['Waiting for room · ', { b: nf }], 'clock');
  chip.key = 'held';
  const title = allReady ? 'Ready to upload' : 'Waiting for room';
  return { key: 'held', kind: 'held', opens: true, chipOnly: false, title, announce: title, count, allReady, paying, chip };
}

function importSection(importLead, guideOpen) {
  if (!importLead && !guideOpen) return null;
  let chip;
  let key;
  if (importLead) {
    const c = importLead.chip || {};
    key = `import:${importLead.key}`;
    chip = {
      key, parts: ['Import · ', { b: c.text }], icon: c.kind === 'ring' ? 'ring' : c.icon,
      pct: c.kind === 'ring' ? (c.pct ?? null) : null, tone: null, action: null, chevron: true, label: c.label,
    };
  } else {
    key = 'guide';
    chip = chipOf(['Import'], 'clock');
    chip.key = key;
  }
  return { key, kind: 'import', opens: true, chipOnly: false, title: 'Import', announce: 'Import', chip };
}

export function trayModel({
  activity, held, importLead = null, guideOpen = false, conn = null, offlineForMs = null,
  canRetryConnection = false, now,
}) {
  const items = activity?.items || [];
  const allBatches = activity?.batches || [];
  const wakes = [];

  const connSec = connSection({ conn, items, batches: allBatches, offlineForMs, canRetryConnection });
  const tooOfflineToList = connSec?.conn === 'offline';

  const batchSecs = [];
  const uploads = allBatches.filter((b) => b.kind === 'upload' && !b.hidden).slice().reverse();   // newest first
  for (const b of uploads) {
    const r = batchSection(b, items, now);
    if (r.wake != null) wakes.push(r.wake);
    if (r.visible && !tooOfflineToList) batchSecs.push(r.section);
  }
  if (offlineForMs != null && offlineForMs < OFFLINE_AFTER_MS) wakes.push(now + (OFFLINE_AFTER_MS - offlineForMs));

  const opSecs = [];
  const ops = allBatches.filter((b) => b.kind !== 'upload' && !b.hidden).slice().reverse();
  for (const b of ops) {
    const r = opSection(b, items, now);
    if (r.wake != null) wakes.push(r.wake);
    if (r.visible) opSecs.push(r.section);
  }

  const heldSec = heldSection(held);
  const importSec = importSection(importLead, guideOpen);

  const others = [...batchSecs, ...opSecs, heldSec, importSec].filter(Boolean);
  const sections = [];
  if (connSec && !(connSec.conn === 'saved' && others.length)) sections.push(connSec);
  sections.push(...others);

  const find = (fn) => sections.find(fn) || null;
  const lead = find((s) => s.conn === 'error')
    || find((s) => s.conn === 'offline')
    // What the person just asked for (a download, an export, a copy) leads
    // while it runs; a failed or running upload stays one tap away in the
    // open tray.
    || find((s) => s.kind === 'op' && s.active)
    || find((s) => s.kind === 'batch' && s.failed > 0)
    || find((s) => s.kind === 'batch' && s.active)
    || find((s) => s.kind === 'import')
    || find((s) => s.kind === 'held')
    || find((s) => s.kind === 'batch')
    || find((s) => s.kind === 'op')
    || find((s) => s.conn === 'reconnecting')
    || find((s) => s.conn === 'saved');

  // A chip-only op that leads still has to open the tray when anything else
  // would draw a panel there (the same sections ActivityTray draws open),
  // or the chip would be a dead end over a failed upload.
  let chip = lead ? lead.chip : null;
  if (lead && lead.kind === 'op' && lead.chipOnly && !chip.chevron && sections.some((s) => s !== lead && !s.chipOnly)) {
    chip = withLabel({ ...chip, chevron: true, label: undefined });
  }

  const future = wakes.filter((w) => w > now);
  return {
    sections,
    lead,
    chip,
    wakeAt: future.length ? Math.min(...future) : null,
  };
}
