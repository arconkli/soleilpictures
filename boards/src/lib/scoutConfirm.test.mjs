// The predicates that decide what a short reply MEANS.
//
// These are the highest-consequence pure functions in Scout: each one stands
// between a two-character message and an irreversible action on somebody's
// board. The governing rule is stated in scoutConfirm.js and every case below
// exists to hold it — AMBIGUITY IS NOT CONSENT.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseConfirmation, wantsEverything, isBinQuery, parseStopIntent,
  parseFindIntent, isDeleteIntent, isCreateConfirmation,
} from './scoutConfirm.js';

test('a yes is a whole message, never a word inside one', () => {
  for (const yes of ['y', 'yes', 'Yes', 'yep', 'ok', 'OK.', 'sure', 'do it', '👍']) {
    assert.equal(parseConfirmation(yes), 'yes', `${yes} should be a yes`);
  }
  // The failure this whole flow exists to prevent: twenty photos moving because
  // somebody happened to use the word "sure" in a sentence about something else.
  for (const notYes of [
    'okay so the diner is on 3rd',
    'sure, but which one',
    'yes the power drops looked bad',
    'ok now send me the other board',
  ]) {
    assert.equal(parseConfirmation(notYes), null, `${notYes} must NOT be a yes`);
  }
});

test('no and undo are recognised, and neither is a yes', () => {
  for (const no of ['n', 'no', 'nope', 'cancel', 'wait', "don't"]) {
    assert.equal(parseConfirmation(no), 'no');
  }
  for (const undo of ['undo', 'revert', 'put them back', 'nevermind', 'never mind']) {
    assert.equal(parseConfirmation(undo), 'undo');
  }
});

test('CREATE is its own word — a bare yes never conjures a board', () => {
  assert.ok(isCreateConfirmation('create'));
  assert.ok(isCreateConfirmation('CREATE'));
  assert.ok(isCreateConfirmation('make it'));
  assert.ok(isCreateConfirmation('new board'));
  // The point of the separate predicate: an ordinary agreement must not be
  // enough to mint a board off a name we may have misheard.
  assert.ok(!isCreateConfirmation('yes'));
  assert.ok(!isCreateConfirmation('ok'));
  assert.ok(!isCreateConfirmation('create a board called diner'));
});

test('"everything" is an explicit opt-in to the whole Bin', () => {
  assert.ok(wantsEverything('put everything in diner recce'));
  assert.ok(wantsEverything('all of them in the diner board'));
  assert.ok(wantsEverything('the whole bin goes in there'));
  assert.ok(!wantsEverything('put these in diner recce'));
});

test('bin queries', () => {
  assert.ok(isBinQuery('/bin'));
  assert.ok(isBinQuery("what's in my bin"));
  assert.ok(isBinQuery('show me my bin'));
  assert.ok(!isBinQuery('put these in the bin board'));
});

// ── STOP ─────────────────────────────────────────────────────────────────────

test('unambiguous opt-outs are honoured in any state', () => {
  for (const s of ['unsubscribe', 'stop all', 'STOPALL', 'opt out', 'remove me',
                   'leave me alone', 'delete my account', "don't text me"]) {
    assert.equal(parseStopIntent(s), 'stop', `${s} should opt out`);
    // Even mid-proposal: these phrasings cannot mean "cancel that move".
    assert.equal(parseStopIntent(s, { movePending: true }), 'stop', `${s} with a move pending`);
  }
});

test('a bare "stop" is a cancellation while a move is pending and an opt-out otherwise', () => {
  // Somebody watching a confirmation appear and typing "stop" means the move.
  assert.equal(parseStopIntent('stop', { movePending: true }), null);
  assert.equal(parseStopIntent('cancel everything', { movePending: true }), null);
  // On an idle thread there is nothing to cancel, so it can only mean one thing.
  assert.equal(parseStopIntent('stop'), 'stop');
  assert.equal(parseStopIntent('quit'), 'stop');
});

test('START reverses it, and neither keyword fires inside a sentence', () => {
  assert.equal(parseStopIntent('start'), 'start');
  assert.equal(parseStopIntent('RESUME'), 'start');
  assert.equal(parseStopIntent('stop by the diner and get a shot'), null);
  assert.equal(parseStopIntent('we start at 6am'), null);
});

// ── Search ───────────────────────────────────────────────────────────────────

test('search intent picks up the natural phrasings', () => {
  assert.deepEqual(parseFindIntent('find diner'), { query: 'diner' });
  assert.deepEqual(parseFindIntent('/find diner'), { query: 'diner' });
  assert.deepEqual(parseFindIntent('where are the warehouse photos'), { query: 'warehouse' });
  assert.deepEqual(parseFindIntent('show me the power drops'), { query: 'power drops' });
  assert.deepEqual(parseFindIntent('search for scene 4'), { query: 'scene 4' });
});

test('search intent declines what it cannot turn into a query', () => {
  // Contentless — these would search for a pronoun.
  assert.equal(parseFindIntent('find it'), null);
  assert.equal(parseFindIntent('show me my bin'), null);
  assert.equal(parseFindIntent('find everything'), null);
  // Not a search at all. The cost of a false positive is answering a search
  // nobody asked for instead of keeping their note.
  assert.equal(parseFindIntent('the diner is on 3rd'), null);
  assert.equal(parseFindIntent('put these in diner recce'), null);
  assert.equal(parseFindIntent('a'.repeat(200)), null);
});

// ── Delete ───────────────────────────────────────────────────────────────────

test('delete intent covers the short forms and nothing else', () => {
  for (const s of ['delete', '/delete', 'delete that', 'delete the last one',
                   'remove those', 'get rid of that']) {
    assert.ok(isDeleteIntent(s), `${s} should be a delete`);
  }
});

test('delete intent never fires on a noun phrase or on the Bin', () => {
  // Deleting a named board off a guessed name is not something a bot should do.
  assert.ok(!isDeleteIntent('delete the diner board'));
  assert.ok(!isDeleteIntent('remove the light from the shot'));
  // "bin" is this product's own noun for the staging board. Reading it as a
  // verb would eventually destroy a batch for somebody who meant "show me".
  assert.ok(!isDeleteIntent('bin'));
  assert.ok(!isDeleteIntent('/bin'));
});
