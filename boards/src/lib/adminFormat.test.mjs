// adminFormat's date helpers read a bare 'YYYY-MM-DD' as the calendar day it
// names. The admin RPCs' `day` columns are UTC days, and new Date('2026-10-19')
// is UTC midnight, the evening of the 18th in California, so every day-grain
// axis label read one day early there.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shortDate, fmtDate, fmtDateTime, segmentLabel, REDACTED_CAMPAIGN } from './adminFormat.js';
import { redactLinkTokens } from './linkTokens.js';

// West of Greenwich is where the old reading went wrong. Node applies a TZ
// change at runtime, and this file runs in its own process under node --test.
process.env.TZ = 'America/Los_Angeles';

test('a day string is the day it names, west of Greenwich', () => {
  assert.equal(shortDate('2026-10-19'), '10/19');
  assert.equal(shortDate('2026-01-01'), '1/1');
  assert.equal(fmtDate('2026-10-19'), new Date(2026, 9, 19).toLocaleDateString());
  assert.equal(fmtDateTime('2026-10-19'), new Date(2026, 9, 19).toLocaleString());
});

test('an instant is still an instant, shown in local time', () => {
  // 03:00 UTC on the 19th is 20:00 on the 18th in Los Angeles.
  assert.equal(shortDate('2026-10-19T03:00:00Z'), '10/18');
  assert.equal(shortDate(Date.UTC(2026, 9, 19, 20)), '10/19');
});

test('bad input never renders NaN', () => {
  assert.equal(shortDate('not a date'), '');
  assert.equal(shortDate('2026-13-45x'), '');
  assert.equal(fmtDate(null), '—');
  assert.equal(fmtDateTime(''), '');
});

// Since 0474 a shared link's token never reaches an event, so the campaign its
// sign-up link set arrives as a placeholder. The Funnel's campaign picker and
// its "Campaigns and creatives" well listed it as ":token".
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('a shared link\'s campaign is named, by the placeholder both writers store', () => {
  const stored = redactLinkTokens({ utm_campaign: '0c9a3f52-7d1e-4b8a-9f21-5e6d4c3b2a10' }).utm_campaign;
  assert.equal(stored, REDACTED_CAMPAIGN);
  assert.match(read('../../../supabase/migrations/0474_no_link_tokens_in_telemetry.sql'),
    /'utm_campaign', ':token'/, 'the database writes the same placeholder');
  assert.equal(segmentLabel(stored), 'shared link · token not kept');
  assert.equal(segmentLabel('launch-q3'), 'launch-q3');
});

test('the campaign picker, the campaigns well and a profile\'s last touch show it by name', () => {
  const select = read('../pages/admin/analytics/widgets/SegmentSelect.jsx');
  assert.match(select, /\{segmentLabel\(value\)\} \(none in this window\)/);
  assert.match(select, /\{segmentLabel\(o\.value\)\} \(\{formatCount\(o\.sessions\)\}\)/);
  assert.match(select, /<option key=\{o\.value\} value=\{o\.value\}>/, 'the option still carries the stored value');
  const funnel = read('../pages/admin/analytics/views/FunnelView.jsx');
  assert.match(funnel, /label: segmentLabel\(s\.value\),/);
  assert.doesNotMatch(funnel, /label: s\.value,/);
  // A profile's last touch is read from events too.
  const profile = read('../pages/admin/AdminUserDetail.jsx');
  assert.match(profile, /\['utm_campaign', segmentLabel\(lt\.utm_campaign\)\]/);
});
