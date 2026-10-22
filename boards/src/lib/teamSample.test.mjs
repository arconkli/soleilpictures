// teamSample.test.mjs — the test team answers as the server will: cut to the
// viewer's role before the page sees it. And the preview stays a preview:
// preview host and dev only, admins only, look only.
//
//   node --test src/lib/teamSample.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sampleTeam, SAMPLE_SETUP_WORKSPACES } from './teamSample.js';
import { seatsUsed, storageQuota, holdsSeat } from './teamModel.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(here, '..', p), 'utf8');
const NOW = new Date('2026-10-21T15:00:00').getTime();

test('the owner and admins get the whole team: emails, seats, the plan and joining', () => {
  for (const as of ['owner', 'admin', 'unpaid']) {
    const t = sampleTeam(as, NOW);
    assert.ok(t.people.every((p) => typeof p.email === 'string' && p.email.includes('@')), as);
    assert.ok(t.plan && t.storage && t.whenFull && t.joining && t.requests, as);
    assert.ok(t.plan.seats >= seatsUsed(t.people), as);
    assert.equal(t.storage.quotaBytes, storageQuota(t.plan.seats));
    assert.ok(t.plan.renewsAt > NOW, as);
    assert.equal(t.workspaces.length, 3);
  }
  assert.equal(sampleTeam('owner', NOW).me.role, 'owner');
  assert.equal(sampleTeam('admin', NOW).me.id, 'p-ben');
});

test('a member gets names and where people edit, and nothing else', () => {
  const t = sampleTeam('member', NOW);
  assert.equal(t.me.role, 'member');
  assert.equal(t.me.id, 'p-maya');
  assert.ok(t.people.length > 0);
  for (const p of t.people) {
    assert.equal(p.email, null, p.name);
    assert.equal(p.lastSeenAt, null, p.name);
    assert.equal(p.online, false, p.name);
    assert.equal(p.invited, null, p.name);
  }
  assert.equal(t.plan, null);
  assert.equal(t.storage, null);
  assert.equal(t.whenFull, null);
  assert.equal(t.joining, null);
  assert.equal(t.requests, null);
  assert.deepEqual(t.workspaces.map((w) => w.name), ['Studio', 'Commercials']);
  assert.doesNotMatch(JSON.stringify(t), /@northlight\.studio|4242/);
});

test('unpaid is the owner of a view-only team, with the deletion a year after grace ends', () => {
  const t = sampleTeam('unpaid', NOW);
  assert.equal(t.status, 'view_only');
  assert.equal(t.me.role, 'owner');
  assert.ok(t.unpaid.failedAt < NOW);
  assert.equal(t.unpaid.deleteAt - t.unpaid.failedAt, (14 + 365) * 864e5);
  assert.equal(sampleTeam('owner', NOW).unpaid, null);
  assert.equal(sampleTeam('owner', NOW).status, 'active');
});

test('the preview is preview-host-and-dev only, and turning it off closes the page', () => {
  const src = read('lib/teamPreview.js');
  assert.match(src, /export function teamPreviewAvailable\(\) \{\s+return editorLimitPreviewAvailable\(\);\s+\}/);
  assert.match(src, /export function readTeamPreview\(\) \{\s+if \(!teamPreviewAvailable\(\)\) return null;/);
  assert.ok(src.includes('if (!TEAM_PREVIEW_ROLES.includes(as)) closeTeamPage();'));
  assert.ok(read('lib/editorLimitPreview.js').includes('return onPreviewHost() || !!import.meta.env.DEV;'));
});

test('a typed team name replaces Northlight Films, with its first letter; empty keeps the default', () => {
  const t = sampleTeam('owner', NOW, { name: '  lumen Pictures ' });
  assert.equal(t.name, 'lumen Pictures');
  assert.equal(t.letter, 'L');
  for (const name of ['', '   ', undefined]) {
    const d = sampleTeam('owner', NOW, { name });
    assert.equal(d.name, 'Northlight Films');
    assert.equal(d.letter, 'N');
  }
});

test('the first three setup workspaces hold exactly the test team’s seat holders', () => {
  const union = new Set(SAMPLE_SETUP_WORKSPACES.slice(0, 3).flatMap((w) => w.editors));
  const seatHolders = sampleTeam('owner', NOW).people.filter(holdsSeat).map((p) => p.id);
  assert.deepEqual([...union].sort(), seatHolders.sort());
  assert.equal(SAMPLE_SETUP_WORKSPACES.length, 4);
});
