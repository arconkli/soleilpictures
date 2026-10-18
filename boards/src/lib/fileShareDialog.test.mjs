import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isEmailLike, parseEmails, mergeChips, normalizeSettings, sharedMessage, commentsLabel, fileDisplayName,
} from './fileShareDialog.js';
import { FILE_SHARE_PEOPLE_PER_CALL } from './fileShares.js';

test('isEmailLike matches the server rule', () => {
  assert.equal(isEmailLike('a@b.co'), true);
  assert.equal(isEmailLike('a@b'), false);
  assert.equal(isEmailLike('nope'), false);
  assert.equal(isEmailLike('a b@c.d'), false);
  assert.equal(isEmailLike(''), false);
});

test('parseEmails splits on comma, semicolon and whitespace, lower-cases and de-dupes', () => {
  assert.deepEqual(parseEmails(' A@x.com, b@y.org;c\n<D@z.io>  a@x.com '), {
    emails: ['a@x.com', 'b@y.org', 'd@z.io'],
    invalid: ['c'],
  });
  assert.deepEqual(parseEmails(''), { emails: [], invalid: [] });
  assert.deepEqual(parseEmails(null), { emails: [], invalid: [] });
});

test('mergeChips keeps order, marks invalid, skips duplicates', () => {
  const a = mergeChips([], 'a@x.com bad');
  assert.deepEqual(a, { chips: [{ email: 'a@x.com', invalid: false }, { email: 'bad', invalid: true }], overflow: 0 });
  const b = mergeChips(a.chips, 'A@x.com, c@y.com');
  assert.deepEqual(b.chips.map((c) => c.email), ['a@x.com', 'bad', 'c@y.com']);
  assert.equal(b.overflow, 0);
});

test('mergeChips caps at the per-call limit and counts the overflow', () => {
  const many = Array.from({ length: FILE_SHARE_PEOPLE_PER_CALL + 3 }, (_, i) => `p${i}@x.com`).join(' ');
  const r = mergeChips([], many);
  assert.equal(r.chips.length, FILE_SHARE_PEOPLE_PER_CALL);
  assert.equal(r.overflow, 3);
  assert.equal(mergeChips([], 'a@x.com b@x.com c@x.com', 2).overflow, 1);
});

test('normalizeSettings fills defaults and maps people', () => {
  assert.deepEqual(normalizeSettings({ exists: false }), {
    exists: false, token: null, linkAccess: 'none', allowDownload: true, people: [], commentCount: 0,
  });
  const s = normalizeSettings({
    exists: true, token: 't1', link_access: 'comment', allow_download: false, comment_count: 4,
    people: [
      { email: 'a@x.com', role: 'view', pending: true, name: null, avatar_url: null },
      { email: 'b@x.com', role: 'comment', pending: false, name: 'Bea', avatar_url: 'https://i/a.png' },
      { role: 'view' },
    ],
  });
  assert.equal(s.linkAccess, 'comment');
  assert.equal(s.allowDownload, false);
  assert.equal(s.commentCount, 4);
  assert.deepEqual(s.people, [
    { email: 'a@x.com', role: 'view', pending: true, name: null, avatarUrl: null },
    { email: 'b@x.com', role: 'comment', pending: false, name: 'Bea', avatarUrl: 'https://i/a.png' },
  ]);
  assert.equal(normalizeSettings({ link_access: 'edit' }).linkAccess, 'none');
});

test('sharedMessage and commentsLabel', () => {
  assert.equal(sharedMessage(2, 0), 'Shared with 2');
  assert.equal(sharedMessage(1, 1), 'Shared with 1 · 1 skipped');
  assert.equal(sharedMessage(0, 2), 'Nobody was added · 2 skipped');
  assert.equal(commentsLabel(1), '1 comment');
  assert.equal(commentsLabel(3), '3 comments');
});

test('fileDisplayName prefers title, then fileName, then name', () => {
  assert.equal(fileDisplayName({ title: ' Cut 3 ', fileName: 'a.mov' }), 'Cut 3');
  assert.equal(fileDisplayName({ title: '', fileName: 'a.mov' }), 'a.mov');
  assert.equal(fileDisplayName({ name: 'n.pdf' }), 'n.pdf');
  assert.equal(fileDisplayName(null), 'File');
});
