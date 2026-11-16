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

test('comment notices: the SQL’s wording, the cluster’s name from the app', () => {
  const ctx = { nameOf, boardNameOf: (id) => ({ b1: 'Moodboard', b2: ' ' }[id] || '') };
  const words = {
    new: 'Ana commented in Moodboard', reply: 'Ana replied in Moodboard',
    mention: 'Ana mentioned you in Moodboard', resolved: 'Ana resolved your comment in Moodboard',
  };
  for (const family of ['comment', 'doc']) {
    for (const [what, title] of Object.entries(words)) {
      const n = row(`${family}.${what}`, { board_id: 'b1', body: 'the words', data: { thread_id: 't', count: 2 } });
      assert.deepEqual(es(n, ctx), { title, body: 'the words' }, n.kind);
      // English is what the database wrote
      setUiLocale('en');
      assert.deepEqual(notificationText(n, ctx), { title: 'STORED TITLE', body: 'the words' });
    }
  }
  // no name for the person or the cluster: the stored English
  assert.deepEqual(es(row('comment.reply', { board_id: 'b1', actor_id: 'u2' }), ctx), STORED);
  assert.deepEqual(es(row('comment.reply', { board_id: 'b2' }), ctx), STORED);
  assert.deepEqual(es(row('doc.new', { board_id: 'gone' }), ctx), STORED);
  assert.deepEqual(es(row('doc.new', { board_id: 'b1' })), STORED, 'no cluster names handed in');
});

test('kinds whose words name a cluster, workspace, team or plan owner stay stored', () => {
  for (const kind of ['edit_request', 'edit_granted', 'editors.joined_as_viewer', 'workspace.ownership_received',
    'team.join_request', 'team.joined_as_viewer', 'team.seats_full', 'team.closed', 'team.workspace_moved_out',
    'team.removed', 'team.request_approved', 'team.view_only', 'team.active_again', 'team.payment_failed', 'share.viewed']) {
    assert.deepEqual(es(row(kind, { data: { org_id: 'o', request_id: 'r', requester_id: 'u1' } })), STORED, kind);
  }
});

// 0897's SQL (_tg_team_note_joined): the words it writes, character for
// character, for each way in and each role.
const sqlJoinedTitle = (name, team, count) => (
  count === 1 ? `${name} joined ${team}`
    : count === 2 ? `${name} and 1 other joined ${team}`
      : `${name} and ${count - 1} others joined ${team}`);
const sqlJoinedBody = (via, role, count) => (count > 1 ? 'See who in People.' : `${{
  invite: 'They accepted an invite.',
  link: 'They joined through the team link.',
  domain: 'They joined with their work email.',
  request: 'An admin approved their request.',
}[via] || 'They joined the team.'}${role === 'viewer' ? ' They can view.' : ' They can edit.'}`);
const joined = (over = {}) => row('team.joined', {
  data: { org_id: 'o1', team_name: 'Northlight Films', name: 'Lena Fischer', count: 1, via: 'link', role: 'editor', since: '2026-11-15T09:00:00Z', ...over },
});

test('team.joined says what the SQL says, for every way in and both roles (0897)', () => {
  for (const via of ['invite', 'link', 'domain', 'request', 'create', 'other', null]) {
    for (const role of ['viewer', 'editor', 'admin', 'member']) {
      assert.deepEqual(es(joined({ via, role })), {
        title: sqlJoinedTitle('Lena Fischer', 'Northlight Films', 1),
        body: sqlJoinedBody(via, role, 1),
      }, `${via} / ${role}`);
    }
  }
});

test('team.joined counts up: 2 is "and 1 other", more is "and N others", the body points to People', () => {
  for (const count of [2, 3, 5]) {
    assert.deepEqual(es(joined({ count })), {
      title: sqlJoinedTitle('Lena Fischer', 'Northlight Films', count),
      body: sqlJoinedBody('link', 'editor', count),
    }, `count ${count}`);
  }
  assert.equal(es(joined({ count: 2 })).title, 'Lena Fischer and 1 other joined Northlight Films');
  assert.equal(es(joined({ count: 5 })).title, 'Lena Fischer and 4 others joined Northlight Films');
  // A count-up needs neither how they came in nor their role.
  assert.equal(es(joined({ count: 3, via: undefined, role: undefined })).body, 'See who in People.');
});

test('team.joined keeps the stored words when a field it needs is missing', () => {
  for (const over of [
    { name: undefined }, { name: '  ' }, { team_name: undefined }, { team_name: null },
    { count: undefined }, { count: null }, { count: 0 },
    { role: undefined }, { role: null },
  ]) {
    assert.deepEqual(es(joined(over)), STORED, JSON.stringify(over));
  }
  const noVia = joined();
  delete noVia.data.via;
  assert.deepEqual(es(noVia), STORED);
  assert.deepEqual(es(row('team.joined', { data: {} })), STORED);
  assert.deepEqual(es(row('team.joined', { data: null })), STORED);
});

test('team.joined in English is the stored row, untouched', () => {
  const n = joined({ count: 3 });
  assert.deepEqual(notificationText(n, { nameOf }), STORED);
});

// 0897 (_tg_team_note_kept).
test('team.kept_viewer says what the SQL says, from target_name and team_name (0897)', () => {
  const data = { org_id: 'o1', team_name: 'Northlight Films', target_name: 'Commercials', request_id: 'r1' };
  assert.deepEqual(es(row('team.kept_viewer', { data })), {
    title: 'You can keep viewing “Commercials”',
    body: 'An admin of Northlight Films kept you as a viewer for now.',
  });
});

test('team.kept_viewer keeps the stored words when a name is missing', () => {
  const data = { org_id: 'o1', team_name: 'Northlight Films', target_name: 'Commercials' };
  for (const over of [{ target_name: undefined }, { target_name: ' ' }, { team_name: undefined }, { team_name: null }]) {
    assert.deepEqual(es(row('team.kept_viewer', { data: { ...data, ...over } })), STORED, JSON.stringify(over));
  }
  assert.deepEqual(es(row('team.kept_viewer', { data: {} })), STORED);
});
