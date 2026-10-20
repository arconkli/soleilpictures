// importJobs.test.mjs — the tray's store: which import it shows, and what a
// tab must not lose.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  putImportJob, dropImportJob, importJobsSnapshot, subscribeImportJobs, trayEntries,
  hasActiveImport, importJobEntry, importForBoard, __resetImportJobsForTests,
} from './importJobs.js';

beforeEach(() => __resetImportJobsForTests());

test('put adds, then merges; every change is a new snapshot for useSyncExternalStore', () => {
  let calls = 0;
  const off = subscribeImportJobs(() => { calls++; });
  const a = importJobsSnapshot();
  putImportJob('k1', { phase: 'reading', title: 'Night Shift' });
  putImportJob('k1', { phase: 'job', snap: { status: 'running' } });
  const b = importJobsSnapshot();
  assert.notEqual(a, b);
  assert.equal(b.list.length, 1);
  assert.deepEqual([importJobEntry('k1').title, importJobEntry('k1').phase], ['Night Shift', 'job']);
  assert.equal(calls, 2);
  dropImportJob('k1');
  dropImportJob('k1');
  assert.equal(calls, 3, 'dropping what is gone changes nothing');
  off();
});

test('the tray shows the import still going, never one being asked about, and counts the rest', () => {
  putImportJob('done', { phase: 'job', snap: { status: 'done' } });
  putImportJob('ask', { phase: 'asking' });
  putImportJob('run', { phase: 'job', snap: { status: 'running' } });
  putImportJob('next', { phase: 'job', snap: { status: 'idle' } });
  const { lead, more } = trayEntries();
  assert.equal(lead.key, 'run');
  assert.equal(more, 1, 'the one queued behind it; not the one in the dialog');
  dropImportJob('run');
  dropImportJob('next');
  assert.equal(trayEntries().lead.key, 'done', 'with nothing going, the latest finished');
  dropImportJob('done');
  assert.equal(trayEntries().lead, null, 'the dialog speaks for the asked one');
});

test('active: reading, asking and unfinished jobs hold the tab; finished ones do not', () => {
  assert.equal(hasActiveImport(), false);
  putImportJob('a', { phase: 'job', snap: { status: 'waiting' } });
  assert.equal(hasActiveImport(), true);
  putImportJob('a', { snap: { status: 'cancelled' } });
  assert.equal(hasActiveImport(), false);
  putImportJob('b', { phase: 'asking' });
  assert.equal(hasActiveImport(), true);
});

test('importForBoard: what the latest import that made a cluster knows about it, the same object while it holds', () => {
  const first = { b1: { path: 'Night Shift › Lookbook', waiting: 0 } };
  putImportJob('k1', { phase: 'job', snap: { status: 'done', byBoard: first } });
  putImportJob('k2', { phase: 'reading' });
  assert.equal(importForBoard('b1'), first.b1);
  assert.equal(importForBoard('nope'), null);
  assert.equal(importForBoard(null), null);
  const again = { b1: { path: 'Night Shift › Lookbook', waiting: 52 } };
  putImportJob('k2', { phase: 'job', snap: { status: 'waiting', byBoard: again } });
  assert.equal(importForBoard('b1').waiting, 52, 'the later import speaks');
  putImportJob('k2', { snap: { status: 'waiting', byBoard: again, landed: { files: 1 } } });
  assert.equal(importForBoard('b1'), again.b1, 'a progress tick changes nothing a view selected');
  dropImportJob('k2');
  dropImportJob('k1');
  assert.equal(importForBoard('b1'), null, 'closed in the tray, forgotten');
});
