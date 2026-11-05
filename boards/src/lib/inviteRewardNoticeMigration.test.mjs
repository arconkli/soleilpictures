// 0863: a friend's first card tells the inviter (bell note + one email).
// Pinned at the source (the latest migration definitions). Text only.
// check_security_invariants is read at 0863's own definition because 0865 re-emits it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { latestDefinition, definitionsOf, MIGRATIONS_DIR } from './migrationText.mjs';
import { REFERRAL_REWARD_CARDS, INVITE_BONUS_STORAGE_BYTES, formatBonusBytes } from './inviteReward.js';

const notice = latestDefinition('_tg_referral_reward_notice');
assert.ok(notice, 'no definition of _tg_referral_reward_notice');
const file = readFileSync(join(MIGRATIONS_DIR, notice.file), 'utf8');

test('the latest notice trigger function is 0863\'s, definer, empty search path, guarded', () => {
  assert.match(notice.file, /_invite_reward_notice\.sql$/);
  assert.match(notice.body, /security definer/);
  assert.match(notice.body, /set search_path = ''/);
  assert.match(notice.body, /exception when others/);
});

test('it writes the invite.reward note with the agreed words', () => {
  assert.ok(notice.body.includes("'invite.reward'"));
  assert.ok(notice.body.includes("'A friend you invited added their first card'"));
  assert.ok(notice.body.includes("'You earned %s more cards and %s more storage.'"));
});

test('the card count agrees across SQL, the payer and the app', () => {
  const cards = latestDefinition('_referral_reward_cards');
  assert.ok(cards, 'no definition of _referral_reward_cards');
  const n = Number(cards.body.match(/select\s+(\d+)/i)?.[1]);
  const pay = latestDefinition('_pay_referral_rewards');
  const payN = Number(pay.body.match(/c_reward_cards\s+constant\s+integer\s*:=\s*(\d+)/)?.[1]);
  assert.equal(n, REFERRAL_REWARD_CARDS);
  assert.equal(n, payN);
});

test('the storage label proof matches the app\'s formatter', () => {
  assert.equal(INVITE_BONUS_STORAGE_BYTES, 536870912);
  assert.ok(file.includes(`_bonus_bytes_label(${INVITE_BONUS_STORAGE_BYTES})`));
  assert.ok(file.includes(`is distinct from '${formatBonusBytes(INVITE_BONUS_STORAGE_BYTES)}'`));
});

test('the trigger fires once, when the reward is stamped', () => {
  assert.ok(file.includes('after update of reward_granted_at on public.referrals'));
  assert.ok(file.includes('when (old.reward_granted_at is null and new.reward_granted_at is not null)'));
});

test('the helpers are not client-executable', () => {
  for (const sig of ['_referral_reward_cards()', '_bonus_bytes_label(bigint)', '_tg_referral_reward_notice()']) {
    const re = new RegExp(`revoke execute on function public\\.${sig.replace(/[()]/g, '\\$&')}\\s+from public, anon, authenticated;`);
    assert.match(file, re, sig);
  }
});

test('email_unsubscribe allows exactly the keys the Worker knows', () => {
  const unsub = latestDefinition('email_unsubscribe');
  assert.ok(unsub, 'no definition of email_unsubscribe');
  const list = unsub.body.match(/p_key\s+not\s+in\s*\(([\s\S]*?)\)/i)?.[1] ?? '';
  const sql = [...list.matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort();
  const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  const obj = worker.match(/const UNSUB_LABELS = \{([\s\S]*?)\n\};/)?.[1] ?? '';
  const keys = [...obj.matchAll(/^\s*(email_[a-z_]+)\s*:/gm)].map(m => m[1]).sort();
  assert.ok(sql.includes('email_invite_reward'));
  assert.deepEqual(sql, keys);
});

test('0863 classes invite_reward as a member email in the gate and lists the sender in the daily check', () => {
  const gate = latestDefinition('_outbound_gate');
  const check = definitionsOf('check_security_invariants').find(d => /_invite_reward_notice\.sql$/.test(d.file));
  assert.match(gate.file, /_invite_reward_notice\.sql$/);
  assert.ok(check, 'check_security_invariants has a definition in 0863');
  assert.match(gate.body, /when p_template in \([^)]*'edit_granted', 'invite_reward'\) then 'member'/);
  assert.ok(check.body.includes("'_tg_referral_reward_notice'"));
});

test('the gate and the daily check are exact copies of their previous definitions, plus one token', () => {
  const ws = s => s.replace(/\s+/g, ' ').trim();
  const pairs = [
    ['_outbound_gate', /,\s*'invite_reward'/, '0830_'],
    ['check_security_invariants', /,\s*'_tg_referral_reward_notice'/, '0541_'],
  ];
  for (const [name, token, prevFile] of pairs) {
    const defs = definitionsOf(name);
    const i = defs.findIndex(d => /_invite_reward_notice\.sql$/.test(d.file));
    assert.ok(i > 0, `${name}: 0863 defines it`);
    const cur = defs[i];
    const prev = defs[i - 1];
    assert.match(cur.file, /_invite_reward_notice\.sql$/, name);
    assert.ok(prev.file.startsWith(prevFile), `${name}: previous definition is ${prev.file}`);
    assert.ok(token.test(cur.body), `${name}: added token present`);
    assert.equal(ws(cur.body.replace(token, '')), ws(prev.body), `${name} differs from ${prev.file} by more than the added token`);
  }
});
