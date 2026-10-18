// 0416: an invitation pays storage on both sides, through the referral row.
//
// The storage half of a reward is written by a trigger on public.referrals:
// the friend's when their row goes in (the same moment their cards land), the
// inviter's when reward_granted_at is stamped (the same moment _pay_referral_rewards
// credits their cards). Every drive reads it through _storage_quota_bytes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { latestDefinition, latestMatch, migrationFiles, MIGRATIONS_DIR } from './migrationText.mjs';
import { INVITE_BONUS_STORAGE_BYTES } from './inviteReward.js';

const MIG = '0416_invite_rewards_storage_and_no_wait.sql';
const sql = readFileSync(new URL(MIG, `file://${MIGRATIONS_DIR}`), 'utf8');
const prefix = (f) => Number(f.slice(0, 4));

test('profiles carries the invitation storage, and no client can write it', () => {
  assert.match(sql, /add column if not exists bonus_storage_bytes bigint not null default 0\s+check \(bonus_storage_bytes >= 0\)/);
  assert.match(sql, /revoke insert \(bonus_storage_bytes\), update \(bonus_storage_bytes\) on public\.profiles from anon, authenticated;/);
  assert.match(sql, /has_column_privilege\(v_role, 'public\.profiles', 'bonus_storage_bytes', v_priv\)/);
  // profiles' client writes are granted per column; a table-wide INSERT or
  // UPDATE grant from here on would hand clients this column too.
  for (const f of migrationFiles().filter((f) => prefix(f) >= 416)) {
    const text = readFileSync(new URL(f, `file://${MIGRATIONS_DIR}`), 'utf8');
    assert.doesNotMatch(text, /grant\s+[^;]*\bbonus_storage_bytes\b[^;]*\bto\s+[^;]*\b(?:anon|authenticated)\b/i, f);
    assert.doesNotMatch(text, /grant\s+(?:all|insert|update)(?:\s*,\s*\w+)*\s+on\s+(?:table\s+)?public\.profiles\s+to\s+[^;]*\b(?:anon|authenticated)\b/i, f);
  }
});

test('the amount has one source in SQL, and the app says the same number', () => {
  const fn = latestDefinition('_referral_bonus_storage_bytes');
  assert.ok(fn, '_referral_bonus_storage_bytes is defined');
  assert.equal(Number(fn.body.match(/select\s+(\d+)::bigint/)[1]), INVITE_BONUS_STORAGE_BYTES);
});

test('storage rides on the referral row: the friend on insert, the inviter on payout', () => {
  const tg = latestDefinition('_tg_referral_bonus_storage').body;
  assert.match(tg, /if tg_op = 'INSERT' then\s+update public\.profiles\s+set bonus_storage_bytes = bonus_storage_bytes \+ public\._referral_bonus_storage_bytes\(\)\s+where user_id = new\.referee_id;/);
  assert.match(tg, /elsif old\.reward_granted_at is null and new\.reward_granted_at is not null then\s+update public\.profiles\s+set bonus_storage_bytes = bonus_storage_bytes \+ public\._referral_bonus_storage_bytes\(\)\s+where user_id = new\.referrer_id;/);
  assert.doesNotMatch(tg, /exception\s+when/i, 'storage and cards land together or not at all');
  // AFTER, not BEFORE: an `on conflict do nothing` skip fires BEFORE INSERT
  // triggers but never AFTER ones, and a skipped referral grants no cards.
  assert.ok(latestMatch(/create or replace trigger referrals_bonus_storage_on_insert\s+after insert on public\.referrals\s+for each row execute function public\._tg_referral_bonus_storage\(\);/));
  assert.ok(latestMatch(/create or replace trigger referrals_bonus_storage_on_reward\s+after update of reward_granted_at on public\.referrals\s+for each row\s+when \(old\.reward_granted_at is null and new\.reward_granted_at is not null\)\s+execute function public\._tg_referral_bonus_storage\(\);/));
  // The payout is the only thing that stamps a reward, so the update trigger
  // fires exactly when the inviter's cards are credited.
  assert.match(latestDefinition('_pay_referral_rewards').body,
    /update public\.referrals set reward_granted_at = now\(\) where id = r\.id;\s+update public\.profiles\s+set bonus_card_credits = coalesce\(bonus_card_credits, 0\) \+ c_reward_cards/);
});

test('every drive includes the invitation storage, on top of any plan or per-account figure', () => {
  const q = latestDefinition('_storage_quota_bytes').body;
  assert.match(q, /\)\s*\+ coalesce\(\(select p\.bonus_storage_bytes from public\.profiles p where p\.user_id = p_owner\), 0\);/,
    'the bonus is added outside the coalesce, so a per-account figure gets it too');
  assert.match(q, /public\._storage_addon_blocks\(p_owner\)/, '0415 extra storage still counts');
  assert.match(q, /else public\._storage_quota_free_bytes\(\)/);
});

test('the backfill is absolute, so running it again changes nothing', () => {
  const backfill = sql.split('── 6.')[1].split('── 7.')[0];
  assert.match(backfill, /set bonus_storage_bytes = public\._referral_bonus_storage_bytes\(\) \* \(/);
  assert.doesNotMatch(backfill, /bonus_storage_bytes \+/);
});

test('0416 revokes and proves its grants, and leaves the stats RPC alone', () => {
  for (const sig of ['_referral_bonus_storage_bytes\\(\\)', '_tg_referral_bonus_storage\\(\\)',
    '_storage_quota_bytes\\(uuid\\)', '_pay_referral_rewards\\(uuid\\)']) {
    assert.match(sql, new RegExp(`revoke execute on function public\\.${sig} from public, anon, authenticated;`), sig);
  }
  assert.match(sql, /has_function_privilege\('anon', v_sig, 'execute'\)/);
  assert.doesNotMatch(sql, /function public\.get_my_referral_stats/,
    'its multipliers and column order are pinned by the 0377 test');
  // gen-docs reads whole migration files; the old wait must not reappear in one.
  assert.doesNotMatch(sql, /c_mature_hours/);
});
