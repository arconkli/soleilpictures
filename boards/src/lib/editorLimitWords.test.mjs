// editorLimitWords.test.mjs — the app-only words say exactly what editorLimit.js
// says, for every stage, every owner and every grant.
//
//   node --import ./scripts/linguiNode.mjs --test src/lib/editorLimitWords.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as shared from './editorLimit.js';
import * as words from './editorLimitWords.js';

const cap = (over) => shared.normalizeEditorCapacity({ enforced: true, editor_limit: 10, used: 0, pending: 0, is_full: false, i_am_account_owner: true, ...over });

test('the share panel note reads the same in every stage, for owners and for everyone else', () => {
  const caps = [];
  for (const subject of ['account', 'team']) {
    for (const isAccountOwner of [true, false]) {
      for (const [used, pending, is_full] of [[0, 0, false], [7, 1, false], [8, 0, false], [9, 0, false], [10, 0, true], [10, 0, false], [12, 0, false], [3, 0, false]]) {
        caps.push(cap({ subject, i_am_account_owner: isAccountOwner, used, pending, is_full }));
      }
    }
  }
  caps.push(null, cap({ enforced: false }), cap({ editor_limit: 3, used: 1 }), cap({ editor_limit: 3, used: 2 }), cap({ editor_limit: 3, used: 3 }));
  for (const c of caps) {
    for (const ownerName of [null, 'Alex']) {
      for (const asked of [false, true]) {
        for (const canBuySeat of [false, true]) {
          const opts = { ownerName, asked, canBuySeat };
          assert.deepEqual(words.editorLimitNote(c, opts), shared.editorLimitNote(c, opts), JSON.stringify([c, opts]));
        }
      }
    }
  }
});

test('a door\'s refusal reads the same for the team, the owner and the person who can only ask', () => {
  const refusals = [null, { team: true, ask: true }, { team: true, ask: false }, { ask: false }, { ask: true }];
  for (const r of refusals) {
    for (const ownerName of [null, 'Alex']) {
      for (const limit of [undefined, 10, 3]) {
        const opts = limit === undefined ? { ownerName } : { ownerName, limit };
        assert.equal(words.editorLimitRefusalMessage(r, opts), shared.editorLimitRefusalMessage(r, opts), JSON.stringify([r, opts]));
      }
    }
  }
  assert.equal(words.editorLimitRefusalMessage({ ask: false }), shared.editorLimitRefusalMessage({ ask: false }));
});

test('a notice\'s toast reads the same, with a body, without one, and for a viewer let in', () => {
  const notices = [null, {}, { title: 'T' }, { title: 'T', body: 'B' }, { title: 'T', body: 'B', kind: 'editors.joined_as_viewer' }, { title: 'T', kind: 'editors.joined_as_viewer' }];
  for (const n of notices) assert.equal(words.noticeToastText(n), shared.noticeToastText(n), JSON.stringify(n));
});

test('the line under a person in the owner\'s list reads the same for every kind of grant', () => {
  const g = (over) => ({ source: 'member', role: 'editor', workspace_id: 'w', workspace_name: 'Ws', board_id: null, board_name: null, invite_id: null, sent_at: null, ...over });
  const rows = [
    null,
    { source: 'owner', email: 'me@x.com', grants: [] },
    { source: 'member', email: 'a@x.com', grants: [] },
    { source: 'member', email: 'a@x.com', grants: [g({})] },
    { source: 'member', email: 'a@x.com', grants: [g({ role: 'coowner' })] },
    { source: 'member', email: 'a@x.com', grants: [g({ role: 'owner', workspace_name: null })] },
    { source: 'member', email: 'a@x.com', grants: [g({ source: 'share', board_name: 'Plan', board_id: 'b' }), g({ role: 'coowner' })] },
    { source: 'member', email: 'a@x.com', grants: [g({ source: 'share', board_name: null, board_id: 'b' })] },
    { source: 'pending', email: 'a@x.com', grants: [g({ source: 'invite', invite_id: 'i', sent_at: '2026-10-21T10:00:00Z' })] },
    { source: 'pending', email: 'a@x.com', grants: [g({ source: 'invite', invite_id: 'i', board_id: 'b', board_name: 'Plan', sent_at: '2026-10-21T10:00:00Z' }), g({ source: 'invite', invite_id: 'j', sent_at: '2026-10-22T10:00:00Z' })] },
    { source: 'pending', email: 'a@x.com', grants: [g({ source: 'invite', invite_id: 'i' })] },
  ];
  for (const r of rows) assert.equal(words.accountEditorSub(r), shared.accountEditorSub(r), JSON.stringify(r));
});
