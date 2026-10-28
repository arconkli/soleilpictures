// shareSentences.test.mjs — the feeds' sentences. Invented people and titles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledgerSentence, eventSentence, shortName } from './shareSentences.js';

const maya = { user_id: 'u1', email: 'maya@example.com', name: 'Maya' };
const sam = { user_id: 'u2', email: 'sam@example.com', name: null };
const deck = { kind: 'cluster', id: 'b1', title: 'Pitch deck', deleted: false };

test('names: a display name, else the local part, a masked address as it is', () => {
  assert.equal(shortName(maya), 'Maya');
  assert.equal(shortName(sam), 'sam');
  assert.equal(shortName({ email: 'n•••@example.com' }), 'n•••@example.com');
  assert.equal(shortName(null), 'Someone');
});

test('the ledger, fact by fact', () => {
  assert.equal(ledgerSentence({ fact: 'copied', route: 'view_link', sharer: maya, object: deck }), 'Maya copied the view link to “Pitch deck”');
  assert.equal(ledgerSentence({ fact: 'shared', route: 'email_invite', sharer: maya, recipient: sam, object: deck }), 'Maya invited sam to “Pitch deck”');
  assert.equal(ledgerSentence({ fact: 'new_account', route: 'edit_link', sharer: maya, recipient: sam, object: deck }), 'sam signed up through Maya’s edit link to “Pitch deck”');
  assert.equal(ledgerSentence({ fact: 'viewed', route: 'view_link', sharer: maya, object: deck }), '“Pitch deck” was opened through Maya’s view link');
  assert.equal(ledgerSentence({ fact: 'shared', route: 'workspace_add', sharer: null, recipient: sam, object: { kind: 'workspace', title: 'Studio' } }),
    'sam was added to “Studio” (who added them isn’t recorded)');
  assert.equal(ledgerSentence({ fact: 'co_created', sharer: maya, recipient: sam, object: deck }), 'sam is co-creating in Maya’s “Pitch deck”');
});

test('titles: untitled and deleted read as words, never as quotes', () => {
  assert.equal(ledgerSentence({ fact: 'copied', route: 'edit_link', sharer: maya, object: { kind: 'cluster', title: '' } }),
    'Maya copied the edit link to an untitled cluster');
  assert.equal(ledgerSentence({ fact: 'copied', route: 'edit_link', sharer: maya, object: { kind: 'cluster', title: null, deleted: true } }),
    'Maya copied the edit link to a deleted cluster');
  assert.equal(ledgerSentence({ fact: 'mystery' }), null);
});

test('live events with 0747 facts', () => {
  assert.equal(eventSentence({ event: 'share_link_copied', actor_name: 'Maya', facts: { board_id: 'b', board_title: 'Pitch deck', kind: 'view' } }),
    'Maya copied the view link to “Pitch deck”');
  assert.equal(eventSentence({ event: 'share_view', email: null, facts: { board_id: 'b', board_title: 'Pitch deck', owner_name: 'Maya', link_kind: 'invite' } }),
    'Someone opened Maya’s edit link to “Pitch deck”');
  assert.equal(eventSentence({ event: 'share_view', email: 'maya@example.com', facts: { board_id: 'b', board_title: 'Pitch deck', owner_name: 'Maya', insider: true } }),
    'maya opened their own link to “Pitch deck”');
  assert.equal(eventSentence({ event: 'file_share_view', facts: { file_title: 'Treatment.pdf' } }), 'Someone opened the shared file “Treatment.pdf”');
});

test('anything without facts falls back to the raw event', () => {
  assert.equal(eventSentence({ event: 'card_placed', facts: {} }), null);
  assert.equal(eventSentence({ event: 'share_link_copied' }), null);
});
