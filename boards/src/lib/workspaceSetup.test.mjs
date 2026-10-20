import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SETUP_EPOCH, NAME_MAX, REASK_MIN_CARDS, TEAM_OPTIONS, WORK_OPTIONS,
  stepsForSetup, isSetupCandidate, normalizeWorkspaceName, validateWorkspaceName,
  workToFirstBoardKind, inviteCopyFor, initialSetupState, nextSetupState, reaskDue,
} from './workspaceSetup.js';

const AFTER = '2026-11-02T10:00:00Z';

test('only new accounts, where the gate is open, before the app ever ran', () => {
  assert.equal(isSetupCandidate({ allowed: true, createdAt: AFTER, onboarding: null }), true);
  assert.equal(isSetupCandidate({ allowed: true, createdAt: AFTER, onboarding: {} }), true);
  assert.equal(isSetupCandidate({ allowed: false, createdAt: AFTER }), false, 'production and the native shells');
  assert.equal(isSetupCandidate({ allowed: true, createdAt: '2026-10-19T23:59:59Z' }), false, 'before the epoch');
  assert.equal(isSetupCandidate({ allowed: true, createdAt: SETUP_EPOCH }), true, 'the epoch itself counts');
  assert.equal(isSetupCandidate({ allowed: true, createdAt: AFTER, onboarding: { seeded: true } }), false, 'the app already seeded');
  assert.equal(isSetupCandidate({ allowed: true, createdAt: AFTER, onboarding: { done: true } }), false);
  assert.equal(isSetupCandidate({ allowed: true, createdAt: 'not a date' }), false);
  assert.equal(isSetupCandidate(), false);
});

test('an invitee answers one question; everyone else three', () => {
  assert.deepEqual([...stepsForSetup({ invitee: true })], ['invitee']);
  assert.deepEqual([...stepsForSetup({})], ['name', 'who', 'invite']);
  assert.deepEqual([...stepsForSetup()], ['name', 'who', 'invite']);
});

test('a name is trimmed, single-spaced and free of invisible characters', () => {
  assert.equal(normalizeWorkspaceName('  Lost   Time '), 'Lost Time');
  assert.equal(normalizeWorkspaceName('Lost\nTime'), 'Lost Time', 'a newline is a header-injection primitive in mail');
  assert.equal(normalizeWorkspaceName(`Lost${String.fromCodePoint(0x200b)}Time`), 'Lost Time');
  assert.equal(normalizeWorkspaceName(`${String.fromCodePoint(0x202e)}emiT tsoL`), 'emiT tsoL', 'bidi override');
  assert.equal(normalizeWorkspaceName(null), '');
  assert.equal(normalizeWorkspaceName('Café'), 'Café', 'NFC');
});

test('a name is required and capped at the length emails show', () => {
  assert.deepEqual(validateWorkspaceName('Lost Time'), { ok: true, name: 'Lost Time', reason: null });
  assert.equal(validateWorkspaceName('   ').reason, 'empty');
  assert.equal(validateWorkspaceName(String.fromCodePoint(0x200b)).reason, 'empty');
  assert.equal(validateWorkspaceName('x'.repeat(NAME_MAX)).ok, true);
  assert.equal(validateWorkspaceName('x'.repeat(NAME_MAX + 1)).reason, 'too_long');
  const emoji = String.fromCodePoint(0x1f3ac);
  assert.equal(validateWorkspaceName(emoji.repeat(NAME_MAX)).ok, true, 'counted in characters, not UTF-16 units');
});

test('the work answer names the first board', () => {
  assert.equal(workToFirstBoardKind('film'), 'storyboard');
  for (const w of ['photo', 'design', 'ads']) assert.equal(workToFirstBoardKind(w), 'moodboard');
  for (const w of ['music', 'school', 'personal', 'other', null, undefined, 'nope']) assert.equal(workToFirstBoardKind(w), null);
  // Every kind returned is one firstBoardCopy knows.
  for (const o of WORK_OPTIONS) {
    const k = workToFirstBoardKind(o.id);
    assert.ok(k === null || ['storyboard', 'moodboard', 'references'].includes(k));
  }
});

test('the team answer changes how the invite step asks', () => {
  assert.equal(inviteCopyFor('solo', 'Lost Time').rows, 1);
  assert.equal(inviteCopyFor('few', 'Lost Time').rows, 2);
  assert.equal(inviteCopyFor('team', 'Lost Time').rows, 3);
  assert.equal(inviteCopyFor(null, 'Lost Time').rows, 1);
  assert.match(inviteCopyFor('team', 'Lost Time').head, /Lost Time/);
  assert.match(inviteCopyFor(null, '  ').head, /your workspace/);
  const heads = new Set(TEAM_OPTIONS.map((o) => inviteCopyFor(o.id, 'X').head));
  assert.equal(heads.size, TEAM_OPTIONS.length, 'each answer reads differently');
  // The invite step never repeats the question the step before asked.
  for (const o of TEAM_OPTIONS) assert.doesNotMatch(inviteCopyFor(o.id, 'X').head, /working in it/i);
});

test('the steps advance in order and record what was answered', () => {
  let s = initialSetupState();
  assert.equal(s.step, 'name');
  s = nextSetupState(s, { type: 'name', name: '   ', now: 't0' });
  assert.equal(s.step, 'name', 'an empty name does not advance');
  s = nextSetupState(s, { type: 'name', name: 'Lost Time', now: 't1' });
  assert.equal(s.step, 'who');
  assert.equal(s.named_at, 't1');
  s = nextSetupState(s, { type: 'who', team: 'few', work: 'film' });
  assert.deepEqual([s.step, s.team, s.work], ['invite', 'few', 'film']);
  s = nextSetupState(s, { type: 'back' });
  assert.equal(s.step, 'who');
  s = nextSetupState(s, { type: 'back' });
  s = nextSetupState(s, { type: 'back' });
  assert.equal(s.step, 'name', 'back stops at the first step');
  s = nextSetupState(s, { type: 'name', name: 'Lost Time', now: 't2' });
  assert.equal(s.named_at, 't1', 'the first naming time is kept');
  s = nextSetupState(s, { type: 'skip_who' });
  assert.equal(s.step, 'invite');
  assert.equal(s.team, 'few', 'skipping later keeps an earlier answer');
  s = nextSetupState(s, { type: 'invite_skipped', now: 't3' });
  assert.deepEqual([s.step, s.done, s.invite, s.done_at], ['done', true, 'skipped', 't3']);
  assert.equal(nextSetupState(s, { type: 'back' }), s, 'finished is final');
});

test('answers outside the lists are dropped, not stored', () => {
  let s = nextSetupState(initialSetupState(), { type: 'name', name: 'A' });
  s = nextSetupState(s, { type: 'who', team: '<script>', work: 'film' });
  assert.equal(s.team, null);
  assert.equal(s.work, 'film');
});

test('moves that do not fit the step change nothing', () => {
  const s = initialSetupState();
  assert.equal(nextSetupState(s, { type: 'invite_sent' }), s);
  assert.equal(nextSetupState(s, { type: 'who', team: 'few' }), s);
  assert.equal(nextSetupState(s, { type: 'invitee_done' }), s);
  assert.equal(nextSetupState(s, { type: 'nope' }), s);
  assert.equal(nextSetupState(s, null), s);
  assert.equal(nextSetupState(null, { type: 'name', name: 'A' }).step, 'who', 'a missing record starts fresh');
});

test('an invitee finishes with one optional answer', () => {
  let s = initialSetupState({ invitee: true });
  assert.deepEqual([s.step, s.invitee], ['invitee', true]);
  assert.equal(nextSetupState(s, { type: 'name', name: 'Mine' }), s, 'an invitee never renames anything');
  s = nextSetupState(s, { type: 'invitee_done', work: 'photo', now: 't' });
  assert.deepEqual([s.done, s.work, s.invite], [true, 'photo', null]);
});

test('the re-ask comes once, to arm B skippers, after real work, inside the window', () => {
  const base = {
    arm: 'B', welcome: { done: true, invite: 'skipped' }, reasked: false, ownCards: REASK_MIN_CARDS,
    uploading: false, overlayOpen: false, createdAt: '2026-11-01T10:00:00Z', now: '2026-11-03T10:00:00Z',
  };
  assert.equal(reaskDue(base), true);
  assert.equal(reaskDue({ ...base, arm: 'A' }), false, 'control never sees it');
  assert.equal(reaskDue({ ...base, reasked: true }), false, 'never a third ask');
  assert.equal(reaskDue({ ...base, welcome: { done: true, invite: 'sent' } }), false);
  assert.equal(reaskDue({ ...base, welcome: { done: true, invitee: true } }), false);
  assert.equal(reaskDue({ ...base, welcome: { done: false, invite: 'skipped' } }), false);
  assert.equal(reaskDue({ ...base, ownCards: REASK_MIN_CARDS - 1 }), false);
  assert.equal(reaskDue({ ...base, uploading: true }), false, 'not while uploads land');
  assert.equal(reaskDue({ ...base, overlayOpen: true }), false, 'not over a tour or a dialog');
  assert.equal(reaskDue({ ...base, now: '2026-11-15T10:00:01Z' }), false, 'past 14 days');
  assert.equal(reaskDue({ ...base, now: '2026-11-15T10:00:00Z' }), true, 'day 14 still counts');
  assert.equal(reaskDue({ ...base, createdAt: null }), false);
  assert.equal(reaskDue(), false);
});
