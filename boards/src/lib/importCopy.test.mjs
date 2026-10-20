// importCopy.test.mjs — the bulk import's words in every state, against the
// owner's pick (direction A, canvas v6) and the critic's rules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askCopy, trayCopy, offerFor, sizeLabel, etaLabel, labelBytes, failReason, countLabel } from './importCopy.js';
import { CREATOR_STORAGE_LABEL, TRIAL_STORAGE_LABEL, STORAGE_ADDON_BLOCK_LABEL, PRICING, CREATOR_TRIAL_DAYS } from './billingCopy.js';

const GB = 1024 ** 3;
const NIGHT = {
  title: 'Night Shift', folders: 14,
  totals: { files: 6193, bytes: 26.4 * GB, clusters: 17 },
  splits: [{ name: 'Stills', of: 3 }],
};
const gold = (c) => c.actions.filter((a) => a.tone === 'primary');

test('labels: sizes keep one decimal until three digits; drive labels read as bytes', () => {
  assert.equal(sizeLabel(26.4 * GB), '26.4 GB');
  assert.equal(sizeLabel(241 * GB), '241 GB');
  assert.equal(sizeLabel(0), '0 B');
  assert.equal(countLabel(6193), '6,193');
  assert.equal(labelBytes('100GB'), 100 * GB);
  assert.equal(labelBytes(CREATOR_STORAGE_LABEL), 1024 ** 4);
  assert.equal(labelBytes('lots'), null);
  assert.ok(labelBytes(TRIAL_STORAGE_LABEL) > 0 && labelBytes(STORAGE_ADDON_BLOCK_LABEL) > 0, 'billingCopy\'s labels parse');
  assert.equal(etaLabel(70 * 60000), 'About 1 hr 10 min left');
  assert.equal(etaLabel(20 * 1000), 'Less than a minute left');
  assert.equal(etaLabel(null), null);
});

test('the free plan: what fits, the trial with "card required", gold only on it', () => {
  const c = askCopy({
    ...NIGHT, fit: { files: 12, bytes: 0 }, waiting: { files: 6181 }, stoppedBy: 'cards',
    budgets: { cardsLeft: 12, bytesLeft: 3.8 * GB, bytesUsed: 1.2 * GB, quota: 5 * GB }, plan: 'free', own: true, trialOffer: true,
  });
  assert.equal(c.sub, '6,193 files in 14 folders · 26.4 GB');
  assert.deepEqual([c.fit.n, c.fit.text, c.wait.n, c.wait.text], ['12', 'fit on your free plan', '6,181', 'would wait']);
  assert.equal(c.lede, 'Its 14 folders become 17 clusters (Stills splits in three), and each folder’s files go to its cluster’s Files. Clusters don’t count as cards. Nothing is laid out on a board.');
  assert.equal(c.offer.text, `Unlimited cards and room for all 26.4 GB. Free for ${CREATOR_TRIAL_DAYS} days, then ${PRICING.monthly.perMonthLabel} a month. Card required.`);
  assert.equal(c.note, 'Bring 12 now and the rest waits in this tab, coming in once there’s room. Closed the tab? Drop the folder again — what’s in is skipped.');
  assert.deepEqual(c.actions.map((a) => a.label), ['Cancel', 'Bring 12 now', 'Try Creator free — bring all 6,193']);
  assert.deepEqual(gold(c).map((a) => a.id), ['all']);
  assert.equal(c.pct, 0.2);
});

test('"bring all" only when the drive bought would hold all of it', () => {
  const big = { ...NIGHT, totals: { ...NIGHT.totals, bytes: 241 * GB } };
  const c = askCopy({ ...big, fit: { files: 12 }, waiting: { files: 6181 }, stoppedBy: 'cards', budgets: { bytesUsed: GB }, plan: 'free', trialOffer: true });
  assert.equal(c.actions.at(-1).label, 'Try Creator free', 'a 100GB trial drive does not hold 241 GB');
  assert.match(c.offer.text, new RegExp(`a ${TRIAL_STORAGE_LABEL} drive until the first payment makes it ${CREATOR_STORAGE_LABEL}`));
  const unknown = askCopy({ ...NIGHT, fit: { files: 12 }, waiting: { files: 6181 }, stoppedBy: 'cards', budgets: {}, plan: 'free', trialOffer: true });
  assert.equal(unknown.actions.at(-1).label, 'Try Creator free', 'a drive that could not be read makes no claim');
  const upgrade = askCopy({ ...NIGHT, fit: { files: 12 }, waiting: { files: 6181 }, stoppedBy: 'cards', budgets: { bytesUsed: GB }, plan: 'free', trialOffer: false });
  assert.equal(upgrade.actions.at(-1).label, 'Upgrade — bring all 6,193');
  assert.doesNotMatch(upgrade.offer.text, /Card required/);
});

test('a paying owner\'s full drive: extra storage, priced from billingCopy', () => {
  const c = askCopy({
    ...NIGHT, fit: { files: 267, bytes: 8 * GB }, waiting: { files: 5926 }, stoppedBy: 'storage',
    budgets: { bytesLeft: 8 * GB, bytesUsed: 1016 * GB, quota: 1024 * GB }, plan: 'paid', own: true, addon: true,
  });
  assert.deepEqual([c.fit.n, c.fit.text], ['267', 'fit in the 8 GB you have left']);
  assert.equal(c.lede, '');
  assert.equal(c.offer.name, 'Extra storage');
  assert.equal(c.offer.text, 'Add 1TB to your drive for $25/month, on your Creator bill.');
  assert.equal(c.note, 'Bring 267 now and the rest waits in this tab; it comes in as soon as the 1TB is added.');
  assert.deepEqual(c.actions.map((a) => a.label), ['Cancel', 'Bring 267 now', 'Add 1TB — bring all 6,193']);
  const held = askCopy({ ...NIGHT, fit: { files: 267 }, waiting: { files: 5926 }, stoppedBy: 'storage', budgets: { bytesLeft: 8 * GB }, plan: 'paid', addon: false });
  assert.equal(held.offer, null);
  assert.deepEqual(held.actions.map((a) => [a.label, a.tone]), [['Cancel', null], ['Bring 267 now', 'default']], 'no paid step, no gold');
});

test('a trial over its drive: no offer, the first payment named, drop again after', () => {
  const c = askCopy({
    title: 'Google Drive (Takeout)', source: 'zip', zips: 5, folders: 1204,
    totals: { files: 18402, bytes: 241 * GB, clusters: 1300 }, fit: { files: 6730 }, waiting: { files: 11672 },
    stoppedBy: 'storage', budgets: { bytesLeft: 87.6 * GB }, plan: 'trial', own: true, firstPayment: 'Nov 2',
  });
  assert.equal(c.sub, '18,402 files in 1,204 folders · 241 GB · 5 zips');
  assert.equal(c.fit.text, 'fit in your trial’s 87.6 GB left');
  assert.equal(c.lede, 'While you’re trying Creator your drive is 100GB. Your first payment, on Nov 2, makes it 1TB.');
  assert.equal(c.note, 'After your first payment on Nov 2, drop the zips again to bring the rest — what’s in already is skipped.');
  assert.deepEqual(c.actions.map((a) => [a.label, a.tone]), [['Cancel', null], ['Bring 6,730 now', 'default']]);
});

test('someone else\'s workspace: their plan, named, never "you" for theirs, never a pronoun', () => {
  const c = askCopy({
    ...NIGHT, fit: { files: 12 }, waiting: { files: 6181 }, stoppedBy: 'cards', plan: 'free', own: false,
    ownerName: 'Maya Ortiz', workspaceName: 'Lost Time',
  });
  assert.equal(c.fit.text, 'fit on Maya Ortiz’s plan');
  assert.equal(c.lede, 'Lost Time is Maya Ortiz’s workspace, so what you add counts toward Maya Ortiz’s plan.');
  assert.equal(c.note, 'Bring 12 now and the rest waits in this tab until Maya Ortiz has room.');
  assert.equal(c.offer, null);
  assert.equal(gold(c).length, 0);
  assert.equal(offerFor({ own: false, plan: 'free', trialOffer: true }), null, 'buying would not make room in someone else\'s plan');
  for (const text of [c.lede, c.note]) assert.doesNotMatch(text, /\b(she|he|her|his|they|their|them)\b/i);
});

test('nothing fits: keep it waiting, never "Bring 0 now"', () => {
  const c = askCopy({ ...NIGHT, fit: { files: 0 }, waiting: { files: 6193 }, stoppedBy: 'cards', plan: 'free', trialOffer: true });
  assert.equal(c.actions[1].label, 'Keep it waiting');
  assert.match(c.note, /^Nothing fits yet\. It waits in this tab/);
  assert.equal(askCopy({ ...NIGHT, fit: { files: 0 }, waiting: { files: 1 }, stoppedBy: 'cards', clusterCost: 1 }).lede.includes('Each cluster counts as a card.'), true);
});

const snap = (over = {}) => ({
  status: 'running', totals: { files: 6193, bytes: 26.4 * GB, clusters: 17 }, landed: { files: 1846, bytes: 13 * GB },
  sentBytes: 13.2 * GB, waiting: { files: 0 }, failed: [], etaMs: 70 * 60000, currentRow: 'Night Shift/Stills',
  tops: [{ key: 'Night Shift', name: 'Night Shift', files: 6193, landed: 1846, boardId: 'b-night' }],
  rows: [
    { key: 'Night Shift', name: 'Night Shift', files: 3, landed: 3 },
    { key: 'Night Shift/Stills', name: 'Stills', files: 4518, landed: 535 },
    { key: 'Night Shift/Wardrobe', name: 'Wardrobe', files: 236, landed: 0 },
  ],
  ...over,
});

test('the tray, running: the mockup\'s line, the ETA, the rows, Pause and Cancel', () => {
  const t = trayCopy({ phase: 'job', title: 'Night Shift', snap: snap() });
  assert.equal(t.title, 'Importing Night Shift');
  assert.deepEqual(t.line, [{ b: '1,846' }, ' of 6,193 files · 13.2 GB of 26.4 GB']);
  assert.equal(t.bar.pct, 50);
  assert.equal(t.meta, 'About 1 hr 10 min left · keep this tab open');
  assert.deepEqual(t.rows.map((r) => [r.name, r.state, r.count]), [['Night Shift', 'done', '3'], ['Stills', 'now', '535 of 4,518'], ['Wardrobe', 'later', '236']]);
  assert.deepEqual(t.foot.actions.map((a) => a.id), ['pause', 'cancel']);
  assert.deepEqual([t.chip.kind, t.chip.text], ['ring', '50%']);
  assert.equal(t.chip.label, 'Importing Night Shift: 1,846 of 6,193 files, about 1 hr 10 min left. Open the import');
});

test('the tray, waiting on the free plan: the trial, "picks up by itself", no Try again', () => {
  const t = trayCopy({ phase: 'job', title: 'Night Shift', own: true, plan: 'free', offer: 'trial',
    snap: snap({ status: 'waiting', waitingReason: 'cards', landed: { files: 12 }, waiting: { files: 6181 } }) });
  assert.deepEqual(t.line, [{ b: '12' }, ' in · ', { b: '6,181' }, ' waiting for room']);
  assert.deepEqual(t.wait.text, ['Your free plan is full. ', { b: 'Creator' }, ` brings in the rest — unlimited cards, free for ${CREATOR_TRIAL_DAYS} days, card required.`]);
  assert.deepEqual(t.wait.action, { id: 'upgrade', label: 'Try Creator free' });
  assert.equal(t.wait.aside, 'Or free up room — it picks up by itself.');
  assert.equal(t.foot.meta, 'They wait in this tab — keep it open.');
  assert.deepEqual(t.foot.actions.map((a) => a.label), ['Stop']);
  assert.deepEqual([t.chip.icon, t.chip.text], ['clock', 'Waiting']);
  assert.deepEqual(t.rows, [], 'no folder list while waiting, as the mockup');
  const flat = JSON.stringify(t);
  assert.doesNotMatch(flat, /Try again/);
});

test('the tray, waiting elsewhere: a trial\'s drive, a paying owner\'s drive, someone else\'s plan', () => {
  const w = (entry) => trayCopy({ phase: 'job', title: 'Night Shift', snap: snap({ status: 'waiting', waitingReason: 'storage', waiting: { files: 9 } }), ...entry }).wait;
  assert.equal(w({ own: true, plan: 'trial', offer: null }).action, null);
  assert.match(w({ own: true, plan: 'trial', offer: null }).text[0], /drop the folder again then/);
  assert.deepEqual(w({ own: true, plan: 'paid', offer: 'addon' }).action, { id: 'addon', label: 'Add 1TB' });
  assert.equal(w({ own: true, plan: 'paid', offer: null }).action, null);
  assert.deepEqual(w({ own: false, plan: 'free', ownerName: 'Maya Ortiz' }).text, ['Maya Ortiz’s plan is full. It picks up by itself when Maya Ortiz makes room.']);
});

test('the tray, done: where it went, Open, Remove, and failures in words', () => {
  const t = trayCopy({ phase: 'job', title: 'Night Shift', targetName: 'Studio', snap: snap({
    status: 'done', landed: { files: 6190 }, failed: [
      { relPath: 'Casting/Callbacks/take-14.mov', message: 'The file was modified during upload' },
      { relPath: 'Stills/DSC_4410.jpg', message: 'NotReadableError: could not be read' },
      { relPath: 'Stills/DSC_4411.jpg', message: 'boom' },
    ] }) });
  assert.equal(t.title, 'Night Shift is in');
  assert.equal(t.close, 'close');
  assert.deepEqual(t.line, [{ b: '6,190' }, ' files in 17 clusters, inside Studio']);
  assert.deepEqual(t.finished.open, { boardId: 'b-night', label: 'Open Night Shift' });
  assert.equal(t.fails.head, '3 files couldn’t be brought in');
  assert.deepEqual(t.fails.list.map((f) => f.why), ['It changed while it was uploading', 'Couldn’t be read from the folder', 'Couldn’t be uploaded']);
  assert.deepEqual([t.chip.icon, t.chip.text], ['warning', '3 failed']);
  const clean = trayCopy({ phase: 'job', title: 'Night Shift', snap: snap({ status: 'done', landed: { files: 6193 } }) });
  assert.equal(clean.fails, null);
  assert.deepEqual([clean.chip.icon, clean.chip.text], ['check', 'Done']);
});

test('the tray, reading and stopped', () => {
  const r = trayCopy({ phase: 'reading', title: 'Night Shift', reading: { files: 2410, folders: 6, bytes: 9.1 * GB } });
  assert.equal(r.title, 'Reading Night Shift…');
  assert.deepEqual(r.line, [{ b: '2,410' }, ' files in 6 folders · 9.1 GB so far']);
  assert.equal(r.bar.reading, true);
  assert.equal(r.chip.pct, null);
  const p = trayCopy({ phase: 'job', title: 'Night Shift', snap: snap({ status: 'paused' }) });
  assert.deepEqual(p.foot.actions.map((a) => a.id), ['resume', 'cancel']);
  const f = trayCopy({ phase: 'job', title: 'Night Shift', snap: snap({ status: 'failed', error: 'Failed to fetch' }) });
  assert.equal(f.finished.resume, true);
  assert.match(f.meta, /Resume picks up where it left off/);
  const c = trayCopy({ phase: 'job', title: 'Night Shift', snap: snap({ status: 'cancelled', landed: { files: 0 }, tops: [{ key: 'N', name: 'N', boardId: null }] }) });
  assert.equal(c.finished.open, null);
  assert.equal(c.finished.remove, false, 'nothing was made, nothing to remove');
  assert.equal(failReason('TypeError: Failed to fetch'), 'The connection dropped');
});

test('the zip question: one Takeout in two parts, as the mockup', async () => {
  const { zipAskCopy } = await import('./importCopy.js');
  const zips = [{ name: 'takeout-20261019T091522Z-001.zip', size: 2.0 * GB }, { name: 'takeout-20261019T091522Z-002.zip', size: 1.9 * GB }];
  const q = zipAskCopy({ zips, groups: [[0, 1]] });
  assert.equal(q.kicker, 'Zip files');
  assert.equal(q.title, 'Unpack these into clusters?');
  assert.equal(q.sub, '2 zips · 3.9 GB · one Google Takeout export');
  assert.deepEqual(q.rows, [{ name: 'takeout-20261019T091522Z-001.zip', size: '2.0 GB' }, { name: 'takeout-20261019T091522Z-002.zip', size: '1.9 GB' }]);
  assert.equal(q.lede, 'Unpacked, the two parts become one tree: every folder in it becomes a cluster, and its files go to that cluster’s Files.');
  assert.equal(q.note, 'Or add them as two zip files, each kept whole in Files.');
  assert.deepEqual(q.actions.map((a) => [a.id, a.label, a.tone]), [['keep', 'Add as 2 zip files', null], ['unpack', 'Unpack into clusters', 'default']]);
  assert.equal(q.more, null);
});

test('the zip question: one zip, unrelated zips, and a long list', async () => {
  const { zipAskCopy } = await import('./importCopy.js');
  const one = zipAskCopy({ zips: [{ name: 'Lookbook.zip', size: 300 * 1024 ** 2 }], groups: [[0]] });
  assert.deepEqual([one.kicker, one.title, one.sub], ['Zip file', 'Unpack this into clusters?', '1 zip · 300 MB']);
  assert.equal(one.note, 'Or add it as a zip file, kept whole in Files.');
  assert.equal(one.actions[0].label, 'Add as a zip file');
  const two = zipAskCopy({ zips: [{ name: 'a.zip', size: 1 }, { name: 'b.zip', size: 1 }], groups: [[0], [1]] });
  assert.match(two.lede, /^Unpacked, each zip becomes a cluster/);
  const drive = zipAskCopy({ zips: [{ name: 'drive-download-20261019T091522Z-001.zip', size: 1 }, { name: 'drive-download-20261019T091522Z-002.zip', size: 1 }], groups: [[0, 1]] });
  assert.match(drive.sub, /one Google Drive download$/);
  const lots = zipAskCopy({ zips: Array.from({ length: 12 }, (_, i) => ({ name: `p${i}.zip`, size: GB })), groups: Array.from({ length: 12 }, (_, i) => [i]) });
  assert.equal(lots.rows.length, 4);
  assert.equal(lots.more, 'and 8 more');
  assert.equal(lots.note, 'Or add them as 12 zip files, each kept whole in Files.');
  assert.doesNotMatch(JSON.stringify([one, two, lots]), /\b(he|she|his|her|they|their)\b/i);
});

test('a zip entry that fails says why, never "too large for this plan"', async () => {
  const { failReason } = await import('./importCopy.js');
  assert.equal(failReason('Entry inflates to more than its declared size.'), 'Damaged inside the zip');
  assert.equal(failReason('Entry failed its checksum.'), 'Damaged inside the zip');
  assert.equal(failReason('Too large to unpack here (4 GB in the zip)'), 'Too large to unpack here — unzip it on your computer');
  assert.equal(failReason('This browser cannot decompress zip entries.'), 'This browser can’t unpack it');
  assert.equal(failReason('File too large'), 'Too large for this plan');
});
