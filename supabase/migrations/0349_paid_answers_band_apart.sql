-- 0349 — an answer from someone who pays is not a near-cap answer.
--
-- admin_feedback_breakdown (0348) bands every answer by how deep its author
-- was: 0 / 1-12 / 13+ / 80%+ of cap. It measured against the answer's own
-- context.cap, else the profile's free allowance (card_cap_base + bonus), and
-- that allowance is a cap only on the free plan. Creator has no card cap, the
-- return banner and Send feedback attach no cap for it, and so a paying person
-- with 45 cards was banded "80%+ of cap": an answer from someone who has already
-- bought, filed with the people the cap presses hardest. That is the band the
-- pre-registered "What's holding you back?" read is taken from.
--
-- Now an answer whose author was on a paid or admin plan when they gave it —
-- context.tier, else the profile's tier today for answers sent without one — is
-- banded 'paid', and only free answers are measured against a cap. Every tier
-- but 'demo' counts as paid, which is the cap trigger's own rule for who is
-- uncapped (enforce_demo_card_cap_trg: `v_tier is distinct from 'demo'`).
--
-- Same signature and return type, so CREATE OR REPLACE keeps the ACL. The proofs
-- below check it anyway.

create or replace function public.admin_feedback_breakdown(
  p_since            date    default null,
  p_exclude_internal boolean default true
) returns table (
  kind text, choice text, role text, depth text,
  answers bigint, with_note bigint, contact_ok bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
begin
  perform public._require_admin();
  return query
  with base as (
    select f.kind, f.choice, f.user_id, f.contact_ok,
           (f.message is distinct from public._feedback_label(f.kind, f.choice)) as has_note,
           case when f.user_id is null then null
                when coalesce(f.context->>'cards', '') ~ '^[0-9]{1,7}$' then (f.context->>'cards')::int
                else public._owner_card_count(f.user_id) end as cards,
           case when coalesce(f.context->>'cap', '') ~ '^[0-9]{1,7}$' then (f.context->>'cap')::int
                else (select coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0)
                        from public.profiles p where p.user_id = f.user_id) end as cap,
           coalesce(nullif(f.context->>'tier', ''),
                    (select p.tier from public.profiles p where p.user_id = f.user_id)) as tier,
           (select r.choice from public.feedback r
             where r.user_id = f.user_id and r.kind = 'role' limit 1) as role
      from public.feedback f
     where (p_since is null or f.created_at >= p_since)
       and (not p_exclude_internal or f.user_id is null
            or f.user_id not in (select _internal_user_ids()))
  )
  select b.kind, b.choice, b.role,
         case
           when b.user_id is null then 'anonymous'
           when b.tier is not null and b.tier <> 'demo' then 'paid'
           when b.cards is null then 'unknown'
           when b.cards = 0 then '0'
           when b.cap > 0 and b.cards >= 0.8 * b.cap then '80%+ of cap'
           when b.cards >= 13 then '13+'
           else '1-12'
         end as depth,
         count(*)                                 as answers,
         count(*) filter (where b.has_note)       as with_note,
         count(*) filter (where b.contact_ok)     as contact_ok
    from base b
   group by 1, 2, 3, 4
   order by 1, 5 desc;
end $$;

comment on function public.admin_feedback_breakdown(date, boolean) is
  'Every feedback answer counted by kind × choice × role × depth band at answer '
  'time (paid authors in their own band), with notes and contact consent. Admin only.';

-- ── Proofs ──────────────────────────────────────────────────────────────────
do $$
declare
  v_bad text := '';
  v_fn  constant text := 'public.admin_feedback_breakdown(date, boolean)';
  v_def text;
begin
  if has_function_privilege('anon', v_fn, 'execute') then
    v_bad := v_bad || ' anon can execute it;';
  end if;
  if not has_function_privilege('authenticated', v_fn, 'execute') then
    v_bad := v_bad || ' authenticated cannot execute it;';
  end if;
  if not has_function_privilege('service_role', v_fn, 'execute') then
    v_bad := v_bad || ' service_role cannot execute it;';
  end if;

  v_def := pg_get_functiondef(v_fn::regprocedure);
  if v_def not like '%perform public._require_admin()%' then
    v_bad := v_bad || ' the admin guard is gone;';
  end if;
  -- The paid band must be decided before any cap arithmetic, or a paying
  -- author with a free-sized count still lands in a cap band.
  if position('then ''paid''' in v_def) = 0
     or position('then ''paid''' in v_def) > position('then ''80%+ of cap''' in v_def) then
    v_bad := v_bad || ' paid is not banded ahead of the cap bands;';
  end if;

  if v_bad <> '' then
    raise exception '0349:%', v_bad;
  end if;
end $$;
