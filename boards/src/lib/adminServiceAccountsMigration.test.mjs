// 0851: service accounts (profiles.is_service, the identities MCP drafts are
// built under) are left out of _admin_people, the population behind the admin
// numbers, and out of admin_signups_by_day, as admin_stats always left them.
// Each restated body is the definition before it plus that one clause and
// nothing else, so the logic stays where the other migration tests pin it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { definitionsOf, bodyText } from './migrationText.mjs';

const FILE = '0851_admin_people_skip_service.sql';
const SKIP = 'and not exists (select 1 from public.profiles sp where sp.user_id = u.id and coalesce(sp.is_service, false))';

for (const fn of ['_admin_people', 'admin_signups_by_day']) {
  test(`${fn} leaves service accounts out, and changes nothing else`, () => {
    const defs = definitionsOf(fn);
    assert.ok(defs.length >= 2, `${fn} was defined before ${FILE}`);
    const [before, live] = defs.slice(-2);
    assert.equal(live.file, FILE, `the live ${fn} is ${FILE}`);
    assert.match(live.body, /security definer\s+set search_path to 'public'/, `${fn} stays security definer on public`);
    const body = bodyText(live.body);
    assert.equal(body.split(SKIP).length, 2, `${fn} carries the clause once`);
    assert.equal(body.replace(` ${SKIP}`, ''), bodyText(before.body), `${fn} is ${before.file}'s body plus the clause`);
  });
}
