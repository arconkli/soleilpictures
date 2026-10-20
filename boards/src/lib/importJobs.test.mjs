// importJobs.test.mjs — the tray's store: which import it shows, and what a
// tab must not lose.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  putImportJob, dropImportJob, importJobsSnapshot, subscribeImportJobs, trayEntries,
  hasActiveImport, importJobEntry, __resetImportJobsForTests,
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
