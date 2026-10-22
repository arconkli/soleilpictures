// importGuide.test.mjs — the tray's guide to bringing files over from another
// app (the owner's pick D, 2026-10-20): its words, where they say to drop,
// the room line, and the store the Upload menu opens it through.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GUIDE_APPS, rich, guideApp, guideAppName, guideRoom,
  subscribeImportGuide, importGuideSnapshot, isImportGuideOpen, openImportGuide, closeImportGuide, chooseGuideApp,
  __resetImportGuideForTests,
} from './importGuide.js';
import { IMPORT_LIMITS } from './importTree.js';
import { CLUSTER_FILE_CEILING } from './importPlan.js';

const GB = 1024 ** 3;
const text = (parts) => parts.map((p) => (typeof p === 'string' ? p : p.b)).join('');
const every = (opts) => GUIDE_APPS.map((id) => guideApp(id, opts));

// A fake localStorage, swapped in per test.
let stored;
function storage({ throws = false } = {}) {
  stored = new Map();
  const bad = () => { throw new Error('denied'); };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true, writable: true,
    value: throws ? { getItem: bad, setItem: bad } : {
      getItem: (k) => (stored.has(k) ? stored.get(k) : null),
      setItem: (k, v) => stored.set(k, String(v)),
    },
  });
}
beforeEach(() => { __resetImportGuideForTests(); storage(); });

test('rich: **x** is a label from the other app, everything else is text', () => {
  assert.deepEqual(rich('Open **Takeout**, then **Drive**.'), ['Open ', { b: 'Takeout' }, ', then ', { b: 'Drive' }, '.']);
  assert.deepEqual(rich('**Download**'), [{ b: 'Download' }]);
  assert.deepEqual(rich('plain'), ['plain']);
});

test('every app has a name, a line on what it downloads, steps ending on the drop, and a picker', () => {
  assert.deepEqual([...GUIDE_APPS], ['drive', 'photos', 'dropbox', 'onedrive', 'icloud', 'other']);
  for (const m of every({ target: 'Studio' })) {
    assert.ok(m.name && m.lede, m.id);
    assert.ok(m.steps.length >= 2, `${m.id} has steps`);
    for (const s of m.steps) assert.ok(text(s).trim().length > 10, `${m.id}: a step says something`);
    assert.match(text(m.steps.at(-1)), /^(Drop|Drag) .* Studio/, `${m.id} ends on where to drop`);
    assert.ok(m.picks.length >= 1, `${m.id} has a picker`);
    assert.equal(guideAppName(m.id), m.name);
  }
});

test('the words: cluster, never board; select, never tick; no "click here", no emojis', () => {
  const all = JSON.stringify([every({ target: 'Studio' }), every({ target: null, canFolder: false })]);
  assert.doesNotMatch(all, /\bboards?\b/i);
  assert.doesNotMatch(all, /\btick/i);
  assert.doesNotMatch(all, /click here/i);
  assert.doesNotMatch(all, /\p{Extended_Pictographic}/u);
});

test('with an open cluster a step says to drop anywhere in it; without one, here', () => {
  const into = guideApp('drive', { target: 'Studio' });
  assert.equal(text(into.steps.at(-1)), 'Drop all the parts anywhere in Studio at once. Each folder becomes a cluster.');
  const here = guideApp('drive');
  assert.equal(text(here.steps.at(-1)), 'Drop all the parts here at once. Each folder becomes a cluster.');
  assert.equal(text(guideApp('dropbox', { target: 'Studio' }).steps.at(-1)), 'Drop the zip anywhere in Studio. Each folder becomes a cluster.');
  assert.equal(text(guideApp('icloud', { target: 'Studio' }).steps.at(-1)), 'Drag the folder anywhere into Studio. Each folder becomes a cluster.');
  assert.match(text(guideApp('other').steps.at(-1)), /^Drop the zip or the folder here\. /);
});

test('a phone or a tablet is told to choose the zip below, and keeps no computer-only way', () => {
  for (const m of every({ target: 'Studio', canFolder: false })) {
    for (const st of m.steps) assert.doesNotMatch(text(st), /\b(drag|drop)\b/i, `${m.id}: ${text(st)}`);
    assert.match(text(m.steps.at(-1)), /^Choose (the zip|all the parts) below/, m.id);
    for (const note of m.notes) assert.doesNotMatch(text(note), /right-click|drag/i, `${m.id}: ${text(note)}`);
  }
  assert.equal(text(guideApp('drive', { target: 'Studio', canFolder: false }).steps.at(-1)),
    'Choose all the parts below at once. They go into Studio. Each folder becomes a cluster.');
  assert.equal(text(guideApp('dropbox', { target: 'Studio', canFolder: false }).steps.at(-1)),
    'Choose the zip below. It goes into Studio. Each folder becomes a cluster.');
  assert.equal(text(guideApp('dropbox', { canFolder: false }).steps.at(-1)), 'Choose the zip below. Each folder becomes a cluster.');
  assert.deepEqual(guideApp('drive', { canFolder: false }).notes.map(text), ['The download link expires after a week.']);
});

test("iCloud on a phone is the Files app's Compress, with no link to icloud.com", () => {
  const m = guideApp('icloud', { target: 'Studio', canFolder: false });
  assert.equal(m.lede, 'On an iPhone or iPad, the Files app zips a folder for you.');
  assert.deepEqual(m.steps.slice(0, 2).map(text), [
    'In the Files app, open iCloud Drive.',
    'Touch and hold the folder you want, then tap Compress.',
  ]);
  assert.equal(m.link, null);
  assert.deepEqual(m.notes, []);
  assert.deepEqual(m.picks.map((p) => p.kind), ['zips']);
  const mac = guideApp('icloud', { target: 'Studio' });
  assert.match(mac.lede, /^On a Mac/);
  assert.equal(mac.link.href, 'https://www.icloud.com/iclouddrive/');
});

test("a cluster's name is placed, never parsed", () => {
  const m = guideApp('dropbox', { target: '**Night** <b>Shift</b>' });
  assert.equal(m.steps.at(-1)[0], 'Drop the zip anywhere in **Night** <b>Shift</b>.');
});

test('our own limits come from the code that enforces them, never typed', () => {
  const note = text(guideApp('other').notes[1]);
  assert.equal(note, `Up to ${IMPORT_LIMITS.maxFiles.toLocaleString('en-US')} files at a time. `
    + `A folder with more than ${CLUSTER_FILE_CEILING.toLocaleString('en-US')} files is split into parts.`);
  const src = readFileSync(new URL('./importGuide.js', import.meta.url), 'utf8');
  for (const v of [IMPORT_LIMITS.maxFiles, CLUSTER_FILE_CEILING]) {
    assert.ok(!src.includes(v.toLocaleString('en-US')) && !src.includes(String(v)), `${v} is not a literal in importGuide.js`);
  }
});

test("the other apps' numbers each name the page that states them", () => {
  const src = readFileSync(new URL('./importGuide.js', import.meta.url), 'utf8');
  for (const [constant, page] of [
    ['TAKEOUT_LINK_NOTE', 'support.google.com/'],
    ['DROPBOX_ZIP_NOTE', 'help.dropbox.com/'],
    ['ONEDRIVE_ZIP_NOTE', 'support.microsoft.com/'],
  ]) {
    const at = src.indexOf(`const ${constant} =`);
    assert.ok(at > 0, constant);
    assert.ok(src.slice(Math.max(0, at - 300), at).includes(page), `${constant} names ${page}`);
  }
});

test('links open the app itself, over https; anything else has none', () => {
  const hosts = { drive: 'takeout.google.com', photos: 'takeout.google.com', dropbox: 'www.dropbox.com', onedrive: 'onedrive.live.com', icloud: 'www.icloud.com' };
  for (const m of every()) {
    if (m.id === 'other') { assert.equal(m.link, null); continue; }
    assert.ok(m.link, m.id);
    const u = new URL(m.link.href);
    assert.equal(u.protocol, 'https:', m.id);
    assert.equal(u.host, hosts[m.id], m.id);
    assert.match(m.link.label, /^Open /);
  }
});

test("the pickers are what each app's download is; a phone has no folder picker", () => {
  const kinds = (id, o) => guideApp(id, o).picks.map((p) => p.kind);
  assert.deepEqual(kinds('drive'), ['zips']);
  assert.deepEqual(kinds('photos'), ['zips']);
  assert.deepEqual(kinds('dropbox'), ['zips', 'folder']);
  assert.deepEqual(kinds('icloud'), ['folder', 'zips']);
  assert.deepEqual(kinds('other'), ['zips', 'folder']);
  for (const id of GUIDE_APPS) {
    assert.deepEqual(kinds(id, { canFolder: false }), ['zips'], `${id} on a phone`);
  }
});

test('an unknown app falls back to Google Drive', () => {
  assert.equal(guideApp('myspace').id, 'drive');
  assert.equal(guideAppName('myspace'), 'Google Drive');
});

test('the room line: files left on the free plan, the drive on a trial or Creator, nothing for a guest', () => {
  const t = (r) => (guideRoom(r) ? text(guideRoom(r)) : null);
  assert.equal(t({ plan: 'free', cardsLeft: 12 }), 'Free plan: 12 more files fit now; the rest waits for room.');
  assert.deepEqual(guideRoom({ plan: 'free', cardsLeft: 12 })[1], { b: '12 more files' });
  assert.equal(t({ plan: 'free', cardsLeft: 1 }), 'Free plan: 1 more file fits now; the rest waits for room.');
  assert.equal(t({ plan: 'free', cardsLeft: 1240 }), 'Free plan: 1,240 more files fit now; the rest waits for room.');
  assert.equal(t({ plan: 'free', cardsLeft: 0 }), 'Your free plan is full; what you bring waits for room.');
  assert.equal(t({ plan: 'free', cardsLeft: -3 }), 'Your free plan is full; what you bring waits for room.');
  assert.equal(t({ plan: 'trial', bytesLeft: 87.6 * GB }), '87.6 GB free on your Creator trial.');
  assert.equal(t({ plan: 'paid', bytesLeft: 412 * GB }), '412 GB free in your drive.');
  assert.equal(t({ plan: 'paid', bytesLeft: -1 }), '0 B free in your drive.');
  // Someone else's workspace counts against its owner's plan: the import's
  // own question says so. An unknown number says nothing.
  assert.equal(guideRoom({ own: false, plan: 'free', cardsLeft: 12 }), null);
  assert.equal(guideRoom({ plan: 'free', cardsLeft: null }), null);
  assert.equal(guideRoom({ plan: 'free', cardsLeft: NaN }), null);
  assert.equal(guideRoom({ plan: 'paid', bytesLeft: null }), null);
  assert.equal(guideRoom({ plan: null, bytesLeft: GB }), null);
  assert.equal(guideRoom(), null);
});

test('the store: open, choose, close; listeners hear each change and a bad one breaks nothing', () => {
  const heard = [];
  subscribeImportGuide(() => { throw new Error('a bad listener'); });
  const off = subscribeImportGuide(() => heard.push({ ...importGuideSnapshot() }));
  assert.equal(isImportGuideOpen(), false);
  openImportGuide();
  assert.deepEqual(importGuideSnapshot(), { open: true, app: 'drive' });
  chooseGuideApp('dropbox');
  chooseGuideApp('dropbox');
  chooseGuideApp('myspace');
  assert.equal(importGuideSnapshot().app, 'dropbox');
  closeImportGuide();
  closeImportGuide();
  assert.equal(isImportGuideOpen(), false);
  assert.deepEqual(heard, [{ open: true, app: 'drive' }, { open: true, app: 'dropbox' }, { open: false, app: 'dropbox' }]);
  off();
  openImportGuide('photos');
  assert.equal(heard.length, 3, 'unsubscribed');
  assert.equal(importGuideSnapshot().app, 'photos', 'opened on the app asked for');
});

test('the app last chosen is remembered in this browser, and opens again', () => {
  openImportGuide();
  chooseGuideApp('onedrive');
  assert.equal(stored.get('soleil.importGuide.app'), 'onedrive');
  __resetImportGuideForTests();
  openImportGuide();
  assert.equal(importGuideSnapshot().app, 'onedrive');
  stored.set('soleil.importGuide.app', 'not-an-app');
  __resetImportGuideForTests();
  openImportGuide();
  assert.equal(importGuideSnapshot().app, 'drive');
});

test('without storage (a private window) the guide still opens and chooses', () => {
  storage({ throws: true });
  openImportGuide();
  chooseGuideApp('icloud');
  assert.deepEqual(importGuideSnapshot(), { open: true, app: 'icloud' });
});
