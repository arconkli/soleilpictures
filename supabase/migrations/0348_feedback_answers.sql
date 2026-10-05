-- 0348 — one data model for everything people tell us, and the question we
-- never asked: why they didn't buy.
--
-- Nobody has paid and nobody has started the Creator trial, and the product had
-- no way to hear why: no surface ever asked. Owner decision 2026-10-01: ask in
-- the app — "What's holding you back?" as an offer closes — and bring both
-- existing surfaces (the return banner and Send feedback) onto the same model,
-- with one-tap answers, the context they were given in, and consent to follow
-- up. This migration is the storage half.
--
--   1. feedback.context   — what the person was looking at (surface, cards,
--                           plan, device, build…), attached automatically and
--                           SHOWN to them before they send. Cleaned against ONE
--                           whitelist by a trigger, so the definer RPCs and the
--                           service-role edge function cannot drift apart.
--   2. feedback.contact_ok — "OK to email me about this". Default false; only
--                           ever true when a signed-in person ticked it.
--   3. kinds upgrade_reason and role, each once per account by partial unique
--      index (the 0310 pattern).
--   4. _feedback_label(kind, choice) — the server's label for every tap-only
--      answer. A tap with no words stores the label as its message (message is
--      NOT NULL, and three export RPCs to_jsonb() the row), and the admin view
--      tells that filler from prose by comparing against this. The trigger
--      fills it when a writer leaves message empty, so the edge function needs
--      no copy of the labels.
--   5. submit_upgrade_reason, submit_role; submit_return_reason gains p_context.
--   6. admin_list_feedback returns context + contact_ok; admin_feedback_breakdown.
--   7. admin_conversion_funnel: a 'Near-cap toast' bucket. Its exposures (header
--      'near-cap', added 2026-10-01) were landing in 'Other in-app'.
--
-- Every closed list here has a client twin. boards/src/lib/feedbackContract.test.mjs
-- compares each pair, per function — the 0282 lesson is that a list the client
-- can send and the server rejects loses every answer, silently.
--
-- (0341–0344 are reserved by the card_index derived-table spec; 0347 is taken.)

-- ── 1 + 2. The columns ──────────────────────────────────────────────────────
-- No re-grant needed: every privilege on feedback is table-level and the SELECT
-- that anon/authenticated hold is inert (RLS on, zero policies) — see 0310.
alter table public.feedback add column if not exists context jsonb;
alter table public.feedback add column if not exists contact_ok boolean not null default false;

comment on column public.feedback.context is
  'What the person was looking at when they answered, attached automatically and '
  'shown to them first. Cleaned by _feedback_context on every write: whitelisted '
  'keys only, scalars only, strings capped. Never card contents or typed text.';
comment on column public.feedback.contact_ok is
  'The person ticked "OK to email me about this". Only ever true for a signed-in '
  'author; an anonymous row cannot be followed up, so the writer forces false.';

-- ── 3. The kinds ────────────────────────────────────────────────────────────
alter table public.feedback drop constraint if exists feedback_kind_check;
alter table public.feedback add constraint feedback_kind_check
  check (kind in ('bug', 'idea', 'praise', 'other', 'return_reason', 'account_deleted', 'upgrade_reason', 'role'));

create unique index if not exists feedback_one_upgrade_reason_per_user
  on public.feedback (user_id)
  where kind = 'upgrade_reason';

create unique index if not exists feedback_one_role_per_user
  on public.feedback (user_id)
  where kind = 'role';

-- ── 4. The labels ───────────────────────────────────────────────────────────
-- Each must read exactly like the chip the person tapped: the client's labels
-- and these are compared by feedbackContract.test.mjs.
create or replace function public._upgrade_reason_label(p_choice text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case p_choice
    when 'enough_room'  then 'The free plan is enough for me'
    when 'price'        then 'The price'
    when 'no_card'      then 'Putting a card in for a trial'
    when 'unsure_value' then 'Not sure what I''d get'
    when 'just_trying'  then 'Just trying it out for now'
    when 'other'        then 'Something else'
    else null
  end
$$;

create or replace function public._role_label(p_choice text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case p_choice
    when 'filmmaker'    then 'Filmmaker'
    when 'photographer' then 'Photographer'
    when 'designer'     then 'Designer'
    when 'artist'       then 'Artist or illustrator'
    when 'student'      then 'Student'
    when 'other'        then 'Something else'
    else null
  end
$$;

-- Send feedback's one-tap topics. They file under the established kinds (see
-- send-feedback TOPIC_KIND), so every existing reader of bug/idea/praise/other
-- keeps working; the topic itself is the choice.
create or replace function public._feedback_topic_label(p_choice text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case p_choice
    when 'broke'           then 'Something broke'
    when 'missing_feature' then 'Missing a feature'
    when 'confusing'       then 'Confusing'
    when 'slow'            then 'Slow'
    when 'pricing'         then 'Plans and pricing'
    when 'love'            then 'I love something'
    when 'other'           then 'Other'
    else null
  end
$$;

create or replace function public._feedback_label(p_kind text, p_choice text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case
    when p_kind = 'return_reason'  then public._return_reason_label(p_choice)
    when p_kind = 'upgrade_reason' then public._upgrade_reason_label(p_choice)
    when p_kind = 'role'           then public._role_label(p_choice)
    when p_kind in ('bug', 'idea', 'praise', 'other') then public._feedback_topic_label(p_choice)
    else null
  end
$$;

-- ── 1 (cont). The context whitelist, in one place ──────────────────────────
-- Scalars only; strings capped at 80. Anything else is dropped, never stored.
-- The key list is the client's FEEDBACK_CONTEXT_KEYS (lib/feedbackContext.js);
-- feedbackContract.test.mjs keeps the two identical.
create or replace function public._feedback_context(p jsonb)
returns jsonb
language sql
immutable
set search_path to 'public'
as $$
  select nullif(coalesce(jsonb_object_agg(e.key,
           case jsonb_typeof(e.value)
             when 'string' then to_jsonb(left(e.value #>> '{}', 80))
             else e.value
           end), '{}'::jsonb), '{}'::jsonb)
    from jsonb_each(case when jsonb_typeof(p) = 'object' then p else '{}'::jsonb end) as e(key, value)
   where e.key in ('surface', 'offer', 'via', 'method', 'trial_offered', 'dwell_ms',
                   'cards', 'server_cards', 'cap', 'tier',
                   'device', 'os', 'browser', 'build', 'path', 'board_id')
     and jsonb_typeof(e.value) in ('string', 'number', 'boolean')
$$;

-- One trigger for every writer: clean the context, and give a tap-only answer
-- the label of what was tapped. BEFORE ROW triggers run before NOT NULL is
-- checked, which is what lets a writer leave message empty.
create or replace function public._feedback_before_write()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  new.context := public._feedback_context(new.context);
  if new.message is null or btrim(new.message) = '' then
    new.message := coalesce(public._feedback_label(new.kind, new.choice), new.kind);
  end if;
  return new;
end $$;

drop trigger if exists feedback_before_write on public.feedback;
create trigger feedback_before_write
  before insert or update of context, message on public.feedback
  for each row execute function public._feedback_before_write();

-- Belt and braces under the cleaner: sixteen capped scalars cannot exceed this.
alter table public.feedback drop constraint if exists feedback_context_size;
alter table public.feedback add constraint feedback_context_size
  check (context is null or octet_length(context::text) <= 2048);

-- ── 5. The writes ───────────────────────────────────────────────────────────
-- "What's holding you back?" — asked as an eligible person closes an offer,
-- once per account. Same two-call shape as the return question: the tap is
-- banked at once, the optional note updates the row the tap wrote, so a dropped
-- second call costs the note and never the answer.
create or replace function public.submit_upgrade_reason(
  p_choice  text,
  p_note    text  default null,
  p_context jsonb default null
) returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid    uuid := auth.uid();
  v_choice text := lower(btrim(coalesce(p_choice, '')));
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_existing record;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  if v_choice not in ('enough_room', 'price', 'no_card', 'unsure_value', 'just_trying', 'other') then
    raise exception 'unknown choice' using errcode = '22023';
  end if;

  select id, kind, choice, message into v_existing
    from public.feedback
   where user_id = v_uid and kind = 'upgrade_reason'
   for update;

  if found then
    if v_note is null or v_existing.message is distinct from public._feedback_label(v_existing.kind, v_existing.choice) then
      return false;
    end if;
    update public.feedback set message = left(v_note, 500) where id = v_existing.id;
    return true;
  end if;

  insert into public.feedback (user_id, kind, choice, message, context)
  values (v_uid, 'upgrade_reason', v_choice, left(v_note, 500), p_context);

  return true;
end $$;

comment on function public.submit_upgrade_reason(text, text, jsonb) is
  'Records "What''s holding you back?". Call once with the choice, then again with '
  'the note. One answer per account (feedback_one_upgrade_reason_per_user). '
  'Returns false when this account has already answered.';

-- "What best describes you?" — the second step of the return question. One per
-- account; the note is for 'other' ("what do you do?") but accepted for any.
create or replace function public.submit_role(
  p_role text,
  p_note text default null
) returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid  uuid := auth.uid();
  v_role text := lower(btrim(coalesce(p_role, '')));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_existing record;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  if v_role not in ('filmmaker', 'photographer', 'designer', 'artist', 'student', 'other') then
    raise exception 'unknown role' using errcode = '22023';
  end if;

  select id, kind, choice, message into v_existing
    from public.feedback
   where user_id = v_uid and kind = 'role'
   for update;

  if found then
    if v_note is null or v_existing.message is distinct from public._feedback_label(v_existing.kind, v_existing.choice) then
      return false;
    end if;
    update public.feedback set message = left(v_note, 500) where id = v_existing.id;
    return true;
  end if;

  insert into public.feedback (user_id, kind, choice, message)
  values (v_uid, 'role', v_role, left(v_note, 500));

  return true;
end $$;

comment on function public.submit_role(text, text) is
  'Records "What best describes you?". One per account (feedback_one_role_per_user). '
  'Returns false when this account already has a role on record.';

-- The return question gains its context. The signature changes, so the old
-- two-argument function is DROPPED first — and a drop discards the ACL, so the
-- grants below are not decoration. Callers using the old named arguments
-- (p_choice, p_note) still resolve: p_context has a default.
drop function if exists public.submit_return_reason(text, text);

create function public.submit_return_reason(
  p_choice  text,
  p_note    text  default null,
  p_context jsonb default null
) returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid    uuid := auth.uid();
  v_choice text := lower(btrim(coalesce(p_choice, '')));
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_existing record;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  if v_choice not in ('resuming', 'adding', 'starting', 'reviewing', 'sharing', 'nothing') then
    raise exception 'unknown choice' using errcode = '22023';
  end if;

  select id, choice, message into v_existing
    from public.feedback
   where user_id = v_uid and kind = 'return_reason'
   for update;

  if found then
    if v_note is null or v_existing.message is distinct from public._return_reason_label(v_existing.choice) then
      return false;
    end if;
    update public.feedback
       set message = left(v_note, 500),
           choice  = v_choice
     where id = v_existing.id;
    return true;
  end if;

  insert into public.feedback (user_id, kind, choice, message, context)
  values (v_uid, 'return_reason', v_choice, coalesce(left(v_note, 500), public._return_reason_label(v_choice)), p_context);

  return true;
end $$;

comment on function public.submit_return_reason(text, text, jsonb) is
  'Records the return question. Call once with the choice, then again with the '
  'note — the second call updates the row the first wrote, so a dropped '
  'follow-up costs the note and never the choice. One answer per account, '
  'enforced by feedback_one_return_reason_per_user rather than by the client, '
  'so clearing localStorage cannot reopen it.';

-- ── 6. The reads ────────────────────────────────────────────────────────────
-- New OUT columns change the return type, so this is DROP + CREATE (42P13
-- otherwise), and the drop discards the ACL — re-granted below, as in 0310.
drop function if exists public.admin_list_feedback(integer, integer, text, text);

create function public.admin_list_feedback(
  p_limit  integer default 100,
  p_offset integer default 0,
  p_kind   text    default null,
  p_q      text    default null
) returns table (
  id uuid, user_id uuid, email text, kind text, choice text,
  message text, has_note boolean, has_image boolean,
  url text, viewport text, user_agent text, created_at timestamptz,
  context jsonb, contact_ok boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare v_q text := nullif(trim(coalesce(p_q, '')), '');
begin
  perform public._require_admin();
  p_limit  := greatest(1, least(p_limit, 500));
  p_offset := greatest(0, p_offset);
  return query
  select f.id, f.user_id, u.email::text, f.kind, f.choice,
         f.message,
         (f.message is distinct from public._feedback_label(f.kind, f.choice)) as has_note,
         (f.image_data_url is not null) as has_image,
         f.url, f.viewport, f.user_agent, f.created_at,
         f.context, f.contact_ok
    from public.feedback f
    left join auth.users u on u.id = f.user_id
   where (p_kind is null or f.kind = p_kind)
     and (v_q is null
          or f.message ilike '%' || v_q || '%'
          or f.choice  ilike '%' || v_q || '%'
          or u.email   ilike '%' || v_q || '%')
   order by f.created_at desc
   limit p_limit offset p_offset;
end $$;

-- Every answer, counted by what was asked, what was said, who said it (their
-- role, when they gave one) and how deep they were at the time. The depth is
-- the context recorded WITH the answer when there is one, else today's count —
-- a person's depth when they answered is the one that explains the answer.
--
-- Bands: 0 · 1–12 · 13+ (the trial line) · 80%+ of cap. Anonymous rows (Send
-- feedback without signing in) band as 'anonymous'.
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
  'time, with notes and contact consent. Admin only.';

-- ── 7. The conversion funnel's missing bucket ───────────────────────────────
-- CREATE OR REPLACE keeps the ACL: the signature and return type are unchanged.
-- Body is 0332's exactly, plus the 'Near-cap toast' line and its sort order.
create or replace function public.admin_conversion_funnel(
  p_since date default '2026-06-27'::date,
  p_exclude_internal boolean default true
)
returns table (
  surface text, sort_order integer, exposures bigint, people bigint,
  evaluated bigint, read_feature bigint, toggled_plan bigint, cta bigint,
  intents bigint, checkouts bigint, checkout_errors bigint, config_errors bigint,
  trials bigint, paid bigint, median_dwell_ms numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  perform public._require_admin();
  return query
  with ev as (
    select e.*,
           case
             when coalesce(e.props->>'surface','') = 'public_page' then 'Public pricing page'
             when coalesce(e.props->>'surface','') in ('page')     then 'Pricing page (signed in)'
             when coalesce(e.props->>'header','')  = 'cap-hit'     then 'Cap wall'
             when coalesce(e.props->>'header','')  = 'near-cap'    then 'Near-cap toast'
             when coalesce(e.props->>'header','')  = 'storage'     then 'File/size gate'
             when coalesce(e.props->>'surface','') = 'first_value'
               or coalesce(e.props->>'header','')  = 'first-value' then 'First-value banner'
             when coalesce(e.props->>'via','')     = 'chip'        then 'Upgrade pill'
             when coalesce(e.props->>'via','')     = 'settings'    then 'Settings'
             else 'Other in-app'
           end as surf
      from public.analytics_events e
     where e.occurred_at >= p_since
       and (not p_exclude_internal or e.user_id is null
            or e.user_id not in (select _internal_user_ids()))
  ),
  agg as (
    select surf,
           count(*) filter (where event = 'up_exposure_summary') as exposures,
           count(distinct user_id) filter (where event = 'up_exposure_summary') as people,
           count(*) filter (where event = 'up_exposure_summary'
                              and (coalesce(props->>'feat_rows','[]') <> '[]'
                                   or coalesce((props->>'toggles_n')::int, 0) > 0)) as evaluated,
           count(*) filter (where event = 'up_exposure_summary'
                              and coalesce(props->>'feat_rows','[]') <> '[]') as read_feature,
           count(*) filter (where event = 'up_exposure_summary'
                              and coalesce((props->>'toggles_n')::int, 0) > 0) as toggled_plan,
           count(*) filter (where event = 'up_exposure_summary'
                              and props->>'outcome' = 'cta') as cta,
           count(*) filter (where event = 'pricing_creator_intent') as intents,
           count(*) filter (where event = 'checkout_open') as checkouts,
           count(*) filter (where event = 'checkout_error') as checkout_errors,
           count(*) filter (where event = 'checkout_error' and props->>'kind' = 'config') as config_errors,
           -- A trial start is not revenue and never counts as one. It is its
           -- own column because a trial that vanishes from the funnel is worse
           -- than one counted wrongly: the surface that produced it would show
           -- an exposure and then nothing at all.
           count(distinct props->>'session_id') filter (
             where event = 'subscription_started' and props->>'trial' = 'true') as trials,
           -- A SALE. Keyed on the Stripe checkout session, which the webhook
           -- already dedupes on, so an operator re-send or a Stripe retry stays
           -- single-counted. checkout_success is deliberately gone: it is a
           -- client event latched per pageload and cannot be a revenue count.
           count(distinct props->>'session_id') filter (
             where event = 'subscription_started'
               and coalesce(props->>'trial','false') <> 'true') as paid,
           percentile_cont(0.5) within group (order by (props->>'dwell_ms')::numeric)
             filter (where event = 'up_exposure_summary'
                       and (props->>'dwell_ms') ~ '^[0-9]+$'
                       and (props->>'dwell_ms')::numeric < 600000) as median_dwell_ms
      from ev group by surf
  )
  select a.surf,
         case a.surf
           when 'Cap wall' then 1 when 'Near-cap toast' then 2 when 'Upgrade pill' then 3
           when 'First-value banner' then 4 when 'File/size gate' then 5 when 'Settings' then 6
           when 'Pricing page (signed in)' then 7 when 'Public pricing page' then 8 else 9 end,
         a.exposures, a.people, a.evaluated, a.read_feature, a.toggled_plan,
         a.cta, a.intents, a.checkouts, a.checkout_errors, a.config_errors,
         a.trials, a.paid,
         round(a.median_dwell_ms::numeric)
    from agg a
   where a.exposures > 0 or a.intents > 0 or a.checkouts > 0
      or a.trials > 0 or a.paid > 0
   order by 2;
end;
$function$;

-- ── Grants ──────────────────────────────────────────────────────────────────
-- Since 0311 a new function is born executable by authenticated and
-- service_role. Internal helpers keep neither client role; they run only inside
-- definer functions and the trigger.
revoke execute on function public._upgrade_reason_label(text) from public, anon, authenticated;
revoke execute on function public._role_label(text) from public, anon, authenticated;
revoke execute on function public._feedback_topic_label(text) from public, anon, authenticated;
revoke execute on function public._feedback_label(text, text) from public, anon, authenticated;
revoke execute on function public._feedback_context(jsonb) from public, anon, authenticated;
revoke execute on function public._feedback_before_write() from public, anon, authenticated;

-- Writers: signed-in people only.
revoke execute on function public.submit_upgrade_reason(text, text, jsonb) from public, anon;
grant  execute on function public.submit_upgrade_reason(text, text, jsonb) to authenticated;
revoke execute on function public.submit_role(text, text) from public, anon;
grant  execute on function public.submit_role(text, text) to authenticated;
revoke execute on function public.submit_return_reason(text, text, jsonb) from public, anon;
grant  execute on function public.submit_return_reason(text, text, jsonb) to authenticated;

-- Admin reads: the guard is inside, and anon never gets as far as calling it.
revoke execute on function public.admin_list_feedback(integer, integer, text, text) from public, anon;
grant  execute on function public.admin_list_feedback(integer, integer, text, text) to authenticated, service_role;
revoke execute on function public.admin_feedback_breakdown(date, boolean) from public, anon;
grant  execute on function public.admin_feedback_breakdown(date, boolean) to authenticated, service_role;

-- ── Proofs ──────────────────────────────────────────────────────────────────
-- A REVOKE reporting success proves nothing (0311), and a whitelist nobody
-- exercised is a guess. Check the state.
do $$
declare
  v_bad text := '';
  v_fn  text;
begin
  foreach v_fn in array array[
    'public._upgrade_reason_label(text)', 'public._role_label(text)',
    'public._feedback_topic_label(text)', 'public._feedback_label(text, text)',
    'public._feedback_context(jsonb)', 'public._feedback_before_write()'
  ] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      v_bad := v_bad || ' ' || v_fn || ' is reachable by a client role;';
    end if;
  end loop;

  foreach v_fn in array array[
    'public.submit_upgrade_reason(text, text, jsonb)', 'public.submit_role(text, text)',
    'public.submit_return_reason(text, text, jsonb)',
    'public.admin_list_feedback(integer, integer, text, text)',
    'public.admin_feedback_breakdown(date, boolean)',
    'public.admin_conversion_funnel(date, boolean)'
  ] loop
    if has_function_privilege('anon', v_fn, 'execute') then
      v_bad := v_bad || ' ' || v_fn || ' is reachable by anon;';
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      v_bad := v_bad || ' ' || v_fn || ' is not executable by authenticated;';
    end if;
  end loop;

  -- The superseded overload must be gone, or two signatures answer one name.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'submit_return_reason'
       and pg_get_function_identity_arguments(p.oid) = 'p_choice text, p_note text'
  ) then
    v_bad := v_bad || ' the old submit_return_reason(text, text) survives;';
  end if;

  -- The whitelist keeps scalars it knows and drops everything else.
  if public._feedback_context('{"cards": 3, "path": "/b", "secret": "x", "tier": {"nested": 1}}'::jsonb)
       is distinct from '{"cards": 3, "path": "/b"}'::jsonb then
    v_bad := v_bad || ' _feedback_context kept something it should not;';
  end if;
  if public._feedback_context('[1, 2]'::jsonb) is not null
     or public._feedback_context('{"nope": 1}'::jsonb) is not null then
    v_bad := v_bad || ' _feedback_context stored an empty or non-object context;';
  end if;
  if length(public._feedback_context(jsonb_build_object('path', repeat('x', 500))) ->> 'path') <> 80 then
    v_bad := v_bad || ' _feedback_context did not cap a string at 80;';
  end if;

  -- Every closed list has a label for every member, so no tap-only answer can
  -- reach the NOT NULL message column empty.
  if public._feedback_label('upgrade_reason', 'price') is distinct from 'The price'
     or public._feedback_label('role', 'artist') is distinct from 'Artist or illustrator'
     or public._feedback_label('bug', 'broke') is distinct from 'Something broke'
     or public._feedback_label('return_reason', 'nothing') is distinct from 'Nothing in particular' then
    v_bad := v_bad || ' a label is wrong;';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.feedback'::regclass and conname = 'feedback_kind_check'
       and pg_get_constraintdef(oid) like '%''upgrade_reason''%'
       and pg_get_constraintdef(oid) like '%''role''%'
       and pg_get_constraintdef(oid) like '%''account_deleted''%'
  ) then
    v_bad := v_bad || ' feedback_kind_check does not admit the new kinds (or lost an old one);';
  end if;

  if not exists (select 1 from pg_trigger where tgrelid = 'public.feedback'::regclass
                  and tgname = 'feedback_before_write' and not tgisinternal) then
    v_bad := v_bad || ' feedback_before_write is not attached;';
  end if;

  if v_bad <> '' then
    raise exception '0348:%', v_bad;
  end if;
end $$;

-- The return question's signature changed; tell PostgREST now rather than on
-- its next cache refresh.
notify pgrst, 'reload schema';
