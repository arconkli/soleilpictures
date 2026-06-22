-- 0166 — Fix referral-code minting: gen_random_bytes() was unresolvable.
--
-- _gen_referral_code() (from 0163) called gen_random_bytes() unqualified while
-- pinned to `set search_path to 'public'`. gen_random_bytes is a pgcrypto
-- function and on Supabase pgcrypto lives in the `extensions` schema, NOT public
-- — so the pinned search_path excluded it and every call threw
-- `function gen_random_bytes(integer) does not exist`.
--
-- Effect: get_or_create_my_referral_code() raised on the mint path, so the
-- "Invite & earn" tab showed "Couldn't load your invite link" for EVERY user and
-- no profile ever received a referral_code (0/92 at time of fix). Symptom-free in
-- get_my_referral_stats() because it never calls the minting helper.
--
-- Fix: schema-qualify the call as extensions.gen_random_bytes(1). This keeps the
-- narrow pinned search_path (security posture from 0165) and is robust even if the
-- search_path is later changed. get_byte/substr/length are pg_catalog built-ins
-- and need no qualification. CREATE OR REPLACE preserves the existing owner
-- (postgres) and ACL; the revoke is re-stated for idempotency / self-documentation.

create or replace function public._gen_referral_code()
returns text
language plpgsql
set search_path to 'public'
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  v text := '';
  i int;
begin
  for i in 1..7 loop
    v := v || substr(alphabet, 1 + (get_byte(extensions.gen_random_bytes(1), 0) % length(alphabet)), 1);
  end loop;
  return v;
end $$;

revoke execute on function public._gen_referral_code() from public, anon, authenticated;
