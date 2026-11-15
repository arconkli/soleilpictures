// notificationText: English shows what the server stored; another language is
// rebuilt from `data` with the SQL's own wording, or falls back to the stored
// English when a field it needs is not on the row.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { notificationText } from './notificationWords.js';
import { setUiLocale } from './uiLocale.js';
import { formatDate } from './intlFormat.js';

afterEach(() => setUiLocale('en'));

const names = { u1: 'Ana', u2: '  ' };
const nameOf = (id) => names[id] || '';
const row = (kind, over = {}) => ({
  id: 'n1', kind, actor_id: 'u1', title: 'STORED TITLE', body: 'STORED BODY', data: {}, ...over,
});
const STORED = { title: 'STORED TITLE', body: 'STORED BODY' };

// Catalogs are empty in node, so a non-English locale returns the source English.
const es = (n, ctx = { nameOf }) => { setUiLocale('es'); return notificationText(n, ctx); };
// The SQL's 'Dy Mon FMDD' is the person's language's short date.
const day = (iso) => {
  setUiLocale('es');
  return formatDate(new Date(`${iso}T00:00:00Z`), { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
};

test('English returns the stored title and body untouched, for every kind', () => {
  for (const kind of ['file.shared', 'file.commented', 'editors.limit_reached', 'invite.reward', 'schedule.moved', 'team.closed', 'unknown.kind']) {
    const n = row(kind, { data: { file_name: 'x', editor_limit: 3, via: 'ask', account_owner: true, cards: 25, storage_bytes: 1 } });
    assert.deepEqual(notificationText(n, { nameOf }), STORED);
  }
  assert.deepEqual(notificationText(row('file.shared', { body: null }), { nameOf }), { title: 'STORED TITLE', body: null });
});

test('file.shared / commented / replied: 0422 and 0426 wording', () => {
  const data = { file_name: 'Plan.pdf', token: 't' };
  assert.equal(es(row('file.shared', { data, body: null })).title, 'Ana shared “Plan.pdf” with you');
  assert.equal(es(row('file.commented', { data })).title, 'Ana commented on “Plan.pdf”');
  const c = es(row('file.replied', { data, body: 'looks good' }));
  assert.equal(c.title, 'Ana replied on “Plan.pdf”');
  assert.equal(c.body, 'looks good');   // the comment's own words
});

test('file kinds keep the stored English without a known name or a file name', () => {
  const data = { file_name: 'Plan.pdf' };
  assert.equal(es(row('file.shared', { data, actor_id: 'u2' })).title, 'STORED TITLE');
  assert.equal(es(row('file.shared', { data, actor_id: null })).title, 'STORED TITLE');
  assert.equal(es(row('file.shared', { data: {} })).title, 'STORED TITLE');
  assert.equal(es(row('file.shared', { data }), {}).title, 'STORED TITLE');
});

test('editors.limit_reached: only the account owner\'s ask notice is rebuilt (0520)', () => {
  const data = { via: 'ask', editor_limit: 3, account_owner: true };
  assert.deepEqual(es(row('editors.limit_reached', { data })), {
    title: 'Ana asked for room to add an editor',
    body: 'Your plan has 3 people who can edit, the most it allows.',
  });
  for (const over of [{ account_owner: false }, { via: 'link' }, { editor_limit: undefined }]) {
    assert.deepEqual(es(row('editors.limit_reached', { data: { ...data, ...over } })), STORED);
  }
});

test('invite.reward uses the numbers in data (0863)', () => {
  const n = row('invite.reward', { data: { cards: 25, storage_bytes: 536870912, referral_id: 'r' } });
  const spanish = es(n);
  assert.equal(spanish.title, 'A friend you invited added their first card');
  assert.match(spanish.body, /^You earned 25 more cards and 0,5\sGB more storage\.$/);
  assert.equal(es(row('invite.reward', { data: {} })).title, 'STORED TITLE');
});

test('schedule kinds (0243): label, date and body from data', () => {
  const published = es(row('schedule.published', { data: { date: '2026-06-05', day_label: 'Day 3', version: 1, note: null } }));
  assert.equal(published.title, `Day 3 — ${day('2026-06-05')}`);
  assert.equal(published.body, 'Call sheet published');
  assert.equal(es(row('schedule.published', { data: { date: '2026-06-05', day_label: 'Day 3', version: 2, note: '' } })).body, 'Call sheet updated — v2');
  assert.equal(es(row('schedule.published', { data: { date: '2026-06-05', day_label: 'Day 3', version: 2, note: 'Bring boots' } })).body, 'STORED BODY');

  const moved = (d) => es(row('schedule.moved', { data: { day_label: 'Day 3', ...d } }));
  assert.equal(moved({ date: '2026-06-06', prev_date: null }).body, 'Added to the schedule');
  assert.equal(moved({ date: null, prev_date: '2026-06-05' }).body, 'Removed from the schedule');
  assert.equal(moved({ date: null, prev_date: '2026-06-05' }).title, 'Day 3');
  assert.equal(moved({ date: '2026-06-06', prev_date: '2026-06-05' }).body, `Moved from ${day('2026-06-05')} to ${day('2026-06-06')}`);

  const cancelled = (reason) => es(row('schedule.cancelled', { data: { date: '2026-06-05', day_label: 'Day 3', reason } }));
  assert.equal(cancelled(null).body, 'Cancelled');
  assert.equal(cancelled('Rain').body, 'STORED BODY');
});

test('schedule kinds without a day label (the SQL used the cluster\'s name), and day_updated, stay stored', () => {
  assert.equal(es(row('schedule.published', { data: { date: '2026-06-05', day_label: null, version: 1 } })).title, 'STORED TITLE');
  assert.equal(es(row('schedule.day_updated', { data: { date: '2026-06-05', day_label: 'Day 3', day_place: 'Pier' } })).title, 'STORED TITLE');
});

test('kinds whose words name a cluster, workspace, team or plan owner stay stored', () => {
  for (const kind of ['edit_request', 'edit_granted', 'editors.joined_as_viewer', 'workspace.ownership_received',
    'team.join_request', 'team.joined_as_viewer', 'team.seats_full', 'team.closed', 'team.workspace_moved_out',
    'team.removed', 'team.request_approved', 'team.view_only', 'team.active_again', 'team.payment_failed', 'share.viewed']) {
    assert.deepEqual(es(row(kind, { data: { org_id: 'o', request_id: 'r', requester_id: 'u1' } })), STORED, kind);
  }
});
