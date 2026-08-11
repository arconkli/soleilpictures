// Filing without a model, and the command table.
//
// parseFileIntent is the deterministic half of the product's second most
// important verb. It exists because filing must not depend on a third-party
// model being reachable — with no Cloudflare AI credentials (which are optional,
// and were unset in production) "put these in Diner Recce" used to be INGESTED
// as content and became a sticky note on the user's canvas, consuming a card to
// do it.
//
// The matcher is deliberately narrow, and the risk it guards against is the
// mirror image: reading "move the lighting rig into the truck" as a filing
// instruction would swallow a note the user wanted kept.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseFileIntent, fallbackIntent, parseCommand } from './scoutIntent.js';

test('the plain instruction parses', () => {
  assert.deepEqual(parseFileIntent('put these in Diner Recce'), { board: 'Diner Recce' });
  assert.deepEqual(parseFileIntent('file that under Locations'), { board: 'Locations' });
  assert.deepEqual(parseFileIntent('these go in Diner Recce'), { board: 'Diner Recce' });
  assert.deepEqual(parseFileIntent('this belongs in Locations'), { board: 'Locations' });
});

test('the POLITE form parses — the one that used to reach the help menu', () => {
  // looksLikeQuestion fires on any message opening with can/do/could/will, and
  // the question gate used to run first, so every one of these was answered
  // with a menu and filed nothing. parseFileIntent always handled them; they
  // were simply unreachable.
  assert.deepEqual(parseFileIntent('can you put these in Diner Recce'), { board: 'Diner Recce' });
  assert.deepEqual(parseFileIntent('could you file these under Locations'), { board: 'Locations' });
  assert.deepEqual(parseFileIntent('please put these in Diner Recce'), { board: 'Diner Recce' });
});

test('decoration around the board name is stripped', () => {
  assert.deepEqual(parseFileIntent('put these in the diner board.'), { board: 'diner' });
  assert.deepEqual(parseFileIntent('put these in "Diner Recce"'), { board: 'Diner Recce' });
});

test('an arbitrary noun phrase is NOT a filing instruction', () => {
  // The thing being filed must be a pronoun or a quantifier. Anything else
  // falls through to ingest, where the worst case is a note card the user can
  // delete — as opposed to silently swallowing a note they wanted kept.
  assert.equal(parseFileIntent('move the lighting rig into the truck'), null);
  assert.equal(parseFileIntent('put the generator in the alley'), null);
  assert.equal(parseFileIntent('add a note about the power drops'), null);
});

test('a paragraph is content, not a command', () => {
  const long = `put these in ${'the diner '.repeat(30)}`;
  assert.equal(parseFileIntent(long), null);
  assert.equal(parseFileIntent(''), null);
  assert.equal(parseFileIntent(null), null);
});

test('the deterministic fallback honours filing rather than pinning it to a canvas', () => {
  const filed = fallbackIntent('put these in Diner Recce');
  assert.equal(filed.action, 'file');
  assert.equal(filed.board, 'Diner Recce');
  // Ordinary words still become the batch label, in the user's own vocabulary.
  const plain = fallbackIntent('scene 4 diner');
  assert.equal(plain.action, 'ingest');
  assert.equal(plain.topic, 'scene 4 diner');
});

test('the command table routes every verb the bot advertises', () => {
  assert.deepEqual(parseCommand('/help'), { command: 'help', arg: '' });
  assert.deepEqual(parseCommand('/bin'), { command: 'bin', arg: '' });
  assert.deepEqual(parseCommand('/inbox'), { command: 'bin', arg: '' });
  assert.deepEqual(parseCommand('/board Diner Recce'), { command: 'board', arg: 'Diner Recce' });
  assert.deepEqual(parseCommand('/code ABCD1234'), { command: 'code', arg: 'ABCD1234' });
  assert.deepEqual(parseCommand('/find diner'), { command: 'find', arg: 'diner' });
  assert.deepEqual(parseCommand('/search diner'), { command: 'find', arg: 'diner' });
  assert.deepEqual(parseCommand('/delete'), { command: 'delete', arg: '' });
});

test('/start and /stop are their own commands, not aliases of /help', () => {
  // /start is also the conventional opt-IN keyword, so it has to be able to
  // clear an opt-out — which it cannot do while it resolves to a command that
  // only prints a menu.
  assert.deepEqual(parseCommand('/start'), { command: 'start', arg: '' });
  assert.deepEqual(parseCommand('/stop'), { command: 'stop', arg: '' });
});

test('an unknown slash word is not a command', () => {
  assert.equal(parseCommand('/wibble'), null);
  assert.equal(parseCommand('not a command'), null);
  assert.equal(parseCommand(''), null);
});
