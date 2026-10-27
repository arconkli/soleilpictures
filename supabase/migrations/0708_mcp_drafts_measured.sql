-- 0708 — Drafts, measured (P3b S4): who opened a keep page, what a kept
-- draft's signup is called, and the admin's funnel per host.
--
-- A draft (0705) is what ChatGPT or Claude makes through /mcp for someone
-- without an account; its keep page (/keep/<token>) is where they keep it.
-- Until now the steps between were invisible: a draft made and a draft kept
-- were rows, but not whether anyone opened the page, and a keeper's signup
-- was filed under the assistant that showed the link.
--
--   1. mcp_drafts.first_viewed_at: the first time the keep page read the
--      draft while it was live. The page posts for its bundle
--      (/api/keep/bundle, the Worker, mcp_draft_keep_view), which a link
--      preview never does, so this is a browser that opened it.
--   2. mcp_draft_keep_view stamps it: 0706's, restated with that one
--      statement added (mcpDraftsMigration.test.mjs holds it to that).
--   3. derive_acquisition_channel v5: a first touch on /keep/:token is
--      'mcp_draft', beside 'mcp_connect' and for the same reason (0225).
--      ChatGPT appends utm_source=chatgpt.com to the links it shows and
--      claude.ai sends its referrer, so without this arm a keeper is filed
--      under the assistant's name and "do drafts bring anyone" can't be
--      answered. 0335's, restated with that one arm added. Called on read by
--      every admin roll-up, never stored: no backfill.
--   4. admin_mcp_drafts(p_days, p_exclude_internal), for the admin API tab.

-- ── 1. The first open ────────────────────────────────────────────────────────
alter table public.mcp_drafts add column if not exists first_viewed_at timestamptz;

-- ── 2. The keep page's read, stamping it ─────────────────────────────────────
create or replace function public.mcp_draft_keep_view(p_keep_hash text, p_board_id uuid default null)
returns json
language plpgsql security definer
set search_path = public
as $$
declare
  d          public.mcp_drafts;
  v_target   uuid;
  v_board    record;
  v_snapshot text;
  v_keys     text[];
  v_meta     json;
  v_nav      json;
  v_cards    integer;
  v_limit    integer;
begin
  select * into d from public.mcp_drafts m where m.keep_hash = p_keep_hash;
  if d.id is null then
    return json_build_object('state', 'unknown');
  end if;
  if d.claimed_at is not null then
    return json_build_object('state', 'kept', 'host', d.host);
  end if;
  if d.reaped_at is not null or d.expires_at <= now() or d.workspace_id is null then
    return json_build_object('state', 'expired', 'host', d.host);
  end if;
  -- The first time a browser opened the page on it while it was live (0708).
  update public.mcp_drafts m set first_viewed_at = now() where m.id = d.id and m.first_viewed_at is null;

  v_target := public._mcp_draft_main_board(d.workspace_id);
  if p_board_id is not null and exists (
       select 1 from public.boards b
        where b.id = p_board_id and b.workspace_id = d.workspace_id and b.deleted_at is null) then
    v_target := p_board_id;
  end if;

  select b.id, b.name, b.view, b.cover, b.bg_color into v_board from public.boards b where b.id = v_target;
  select s.doc into v_snapshot from public.board_state s where s.board_id = v_target;

  -- get_share_bundle's three key sets, for this board.
  select coalesce(array_agg(distinct k), '{}'::text[]) into v_keys
  from (
    select i.storage_path as k from public.images i
     where i.storage_path is not null and (i.board_id = v_target or v_target = any(i.referenced_in_board_ids))
    union
    select i.preview_path from public.images i
     where i.preview_path is not null and (i.board_id = v_target or v_target = any(i.referenced_in_board_ids))
    union
    select i.preview_sm_path from public.images i
     where i.preview_sm_path is not null and (i.board_id = v_target or v_target = any(i.referenced_in_board_ids))
  ) s;

  select coalesce(jsonb_object_agg(i.storage_path, jsonb_build_object(
           'blur', i.blur_hash, 'preview', i.preview_path, 'preview_w', i.preview_w, 'preview_h', i.preview_h,
           'preview_sm', i.preview_sm_path, 'preview_sm_w', i.preview_sm_w, 'preview_sm_h', i.preview_sm_h)),
         '{}'::jsonb)::json
    into v_meta
    from public.images i
   where i.storage_path is not null
     and (i.board_id = v_target or v_target = any(i.referenced_in_board_ids))
     and (i.blur_hash is not null or i.preview_path is not null);

  -- Every live cluster in the draft but its root, so the page can move between them.
  select coalesce(json_agg(json_build_object('id', b.id, 'name', b.name) order by b.created_at), '[]'::json)
    into v_nav
    from public.boards b
   where b.workspace_id = d.workspace_id and b.id is distinct from public._mcp_draft_root(d.workspace_id) and b.deleted_at is null;

  v_cards := public._owner_card_count(d.user_id);
  select coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0) into v_limit
    from public.profiles p where p.user_id = d.user_id;

  return json_build_object(
    'state', 'live',
    'host', d.host,
    'expires_at', d.expires_at,
    'card_count', v_cards,
    'card_limit', coalesce(v_limit, 50),
    'bundle', json_build_object(
      'board', json_build_object('id', v_board.id, 'name', v_board.name, 'view', v_board.view,
                                 'cover', v_board.cover, 'bg_color', v_board.bg_color),
      'snapshot', v_snapshot,
      'image_keys', v_keys,
      'image_meta', v_meta,
      'role', 'viewer',
      'root_id', v_target,
      'include_subboards', true,
      'nav_boards', v_nav,
      'join', null));
end;
$$;
revoke execute on function public.mcp_draft_keep_view(text, uuid) from public, anon, authenticated;

-- ── 3. The channel ───────────────────────────────────────────────────────────
create or replace function public.derive_acquisition_channel(fs jsonb)
returns text language plpgsql immutable set search_path = public as $fn$
declare
  utm_s text := lower(coalesce(nullif(fs->>'utm_source',''), ''));
  ref   text := lower(coalesce(nullif(fs->>'referrer_host',''), nullif(fs->>'referrer',''), ''));
  lp    text := lower(coalesce(nullif(fs->>'landing_path',''), ''));
  paid  boolean := lower(coalesce(fs->>'utm_medium','')) ~ '(cpc|ppc|paid|paidsocial|paid_social|paid-social|^ad$|^ads$|display|sem)';
  hw    text;
begin
  if fs is null or fs = '{}'::jsonb then return 'direct'; end if;

  -- 1) Paid click-ids win, network-specific.
  if nullif(fs->>'gclid','') is not null or nullif(fs->>'wbraid','') is not null or nullif(fs->>'gbraid','') is not null then return 'google_ads'; end if;
  if nullif(fs->>'msclkid','')   is not null then return 'bing_ads';      end if;
  if nullif(fs->>'ttclid','')    is not null then return 'tiktok_ads';    end if;
  if nullif(fs->>'twclid','')    is not null then return 'x_ads';         end if;
  if nullif(fs->>'rdt_cid','')   is not null or nullif(fs->>'rdt_uuid','') is not null then return 'reddit_ads'; end if;
  if nullif(fs->>'li_fat_id','') is not null then return 'linkedin_ads';  end if;
  if nullif(fs->>'epik','')      is not null then return 'pinterest_ads'; end if;
  if nullif(fs->>'sccid','')     is not null then return 'snapchat_ads';  end if;
  if nullif(fs->>'fbclid','')    is not null then return 'meta_paid';     end if;

  -- 2) Paid via explicit utm tagging on a known network (no click-id).
  if paid then
    if utm_s ~ '(google|adwords)'                            then return 'google_ads';    end if;
    if utm_s ~ '(bing|microsoft|msn)'                        then return 'bing_ads';      end if;
    if utm_s ~ '(facebook|instagram|meta|^fb$|^ig$|fb_|ig_)' then return 'meta_paid';     end if;
    if utm_s ~ 'tiktok'                                      then return 'tiktok_ads';    end if;
    if utm_s ~ '(twitter|^x$)'                               then return 'x_ads';         end if;
    if utm_s ~ 'reddit'                                      then return 'reddit_ads';    end if;
    if utm_s ~ 'linkedin'                                    then return 'linkedin_ads';  end if;
    if utm_s ~ 'pinterest'                                   then return 'pinterest_ads'; end if;
    if utm_s ~ 'snap'                                        then return 'snapchat_ads';  end if;
  end if;

  -- 3) Internal channels. The connect screen leads: it is the most specific
  --    thing we can know about someone who arrived there — they did not come to
  --    look at the product, they came to attach it to an assistant they use.
  if lp like '/oauth/authorize%' then return 'mcp_connect'; end if;
  -- A keep page (0708): signed up to keep what an assistant made for them.
  if lp like '/keep/%' then return 'mcp_draft'; end if;
  if nullif(fs->>'ref','')         is not null                           then return 'referral';     end if;
  if nullif(fs->>'share_token','') is not null or utm_s = 'share_link'   then return 'share_link';   end if;
  if nullif(fs->>'public_slug','') is not null or utm_s = 'public_board' then return 'public_board'; end if;

  -- 4) Organic / referral by explicit utm_source.
  if utm_s <> '' then
    -- 4a) AI assistants FIRST. ChatGPT strips its referrer on about half its
    --     clicks and appends utm_source=chatgpt.com; before this arm that fell
    --     to the verbatim fallback and never grouped with the referrer form.
    --     'meta.ai' must beat the meta_organic arm's bare 'meta' below.
    if utm_s ~ '(chatgpt|openai)'    then return 'chatgpt';    end if;
    if utm_s ~ 'perplexity'          then return 'perplexity'; end if;
    if utm_s ~ 'gemini'              then return 'gemini';     end if;
    if utm_s ~ '(claude|anthropic)'  then return 'claude';     end if;
    if utm_s ~ 'copilot'             then return 'copilot';    end if;
    if utm_s ~ '(grok|^x\.ai$)'      then return 'grok';       end if;
    if utm_s ~ '(mistral|deepseek|meta\.ai|duck\.ai|phind|you\.com|poe\.com|t3\.chat|kagi)' then return 'ai'; end if;
    if utm_s ~ '(facebook|instagram|meta|^fb$|^ig$)' then return 'meta_organic'; end if;
    if utm_s ~ 'tiktok'        then return 'tiktok';    end if;
    if utm_s ~ 'reddit'        then return 'reddit';    end if;
    if utm_s ~ '(twitter|^x$)' then return 'x';         end if;
    if utm_s ~ 'linkedin'      then return 'linkedin';  end if;
    if utm_s ~ 'pinterest'     then return 'pinterest'; end if;
    if utm_s ~ 'snap'          then return 'snapchat';  end if;
    if utm_s ~ 'youtube'       then return 'youtube';   end if;
    if utm_s ~ '(google|adwords)'     then return 'google'; end if;
    if utm_s ~ '(bing|microsoft|msn)' then return 'bing';   end if;
    return utm_s;
  end if;

  -- 5) Organic / referral by external referrer host.
  if ref <> '' then
    -- 5a) AI assistants ahead of the search engines that own their domains.
    if ref ~ '(chatgpt\.com|chat\.openai\.com|openai\.com)' then return 'chatgpt';    end if;
    if ref ~ 'perplexity'                                    then return 'perplexity'; end if;
    if ref ~ 'gemini\.google\.com'                           then return 'gemini';     end if;
    if ref ~ '(claude\.ai|claude\.com)'                      then return 'claude';     end if;
    if ref ~ 'copilot\.(microsoft\.com|cloud\.microsoft)'    then return 'copilot';    end if;
    if ref ~ '(grok\.com|(^|[.])x[.]ai($|[:/]))'             then return 'grok';       end if;
    if ref ~ '(mistral\.ai|deepseek\.com|meta\.ai|duck\.ai|kagi\.com/assistant|phind\.com|you\.com|poe\.com|t3\.chat|notebooklm\.google\.com|aistudio\.google\.com|m365\.cloud\.microsoft)' then return 'ai'; end if;
    if ref ~ '(facebook|instagram|fb[.]com|fb[.]me|l[.]facebook|lm[.]facebook)' then return 'meta_organic'; end if;
    if ref ~ 'tiktok'                                                then return 'tiktok';     end if;
    if ref ~ 'reddit'                                                then return 'reddit';     end if;
    if ref ~ '(twitter|(^|[.])t[.]co($|[:/])|(^|[.])x[.]com($|[:/]))' then return 'x';         end if;
    if ref ~ 'linkedin'                                             then return 'linkedin';   end if;
    if ref ~ 'pinterest'                                            then return 'pinterest';  end if;
    if ref ~ 'snapchat'                                             then return 'snapchat';   end if;
    if ref ~ 'youtube'                                              then return 'youtube';    end if;
    if ref ~ 'google[.]'                                            then return 'google';     end if;
    if ref ~ '(bing[.]|microsoft)'                                  then return 'bing';       end if;
    if ref ~ 'duckduckgo'                                           then return 'duckduckgo'; end if;
    if ref ~ 'yahoo'                                                then return 'yahoo';      end if;
    if ref ~ '(ecosia|baidu|yandex|brave|qwant|startpage)'          then return 'search';     end if;
    hw := split_part(regexp_replace(regexp_replace(ref, '^https?://', '', 'i'), '^www[.]', '', 'i'), '/', 1);
    hw := split_part(hw, ':', 1);
    if position('.' in hw) > 0 then
      hw := split_part(hw, '.', greatest(1, array_length(string_to_array(hw, '.'), 1) - 1));
    end if;
    return coalesce(nullif(hw, ''), 'referral');
  end if;

  return 'direct';
end;
$fn$;

-- ── 4. The admin's funnel: drafts per host ───────────────────────────────────
-- For drafts made in the last p_days (1 to 90; a draft's row outlives that by
-- its 90-day tombstone, 0705), per host: made; opened on the keep page; kept,
-- and of those kept by an account made after the draft was (the draft brought
-- it); came back, a day of activity after the day it was kept
-- (user_active_day); ran out; still live. opened_late counts keep pages
-- opened on a draft that had already run out (keep_page_view, state
-- 'expired'): whether the lifetime is too short. Then the latest drafts one
-- by one. Ids, counts and times only: never a token, a hash, an address or
-- anything in a draft. A draft kept by someone internal is left out; one
-- nobody kept can't be told apart, so a test draft counts as made.
create or replace function public.admin_mcp_drafts(
  p_days integer default 30,
  p_exclude_internal boolean default true
)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_days int := least(greatest(coalesce(p_days, 30), 1), 90);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_out jsonb;
begin
  perform public._require_admin();

  with internal as (
    select iu.user_id from public._internal_user_ids() iu where p_exclude_internal
  ),
  d as (
    select m.id, m.host, m.created_at, m.last_used_at, m.expires_at, m.first_viewed_at, m.claimed_at,
           case when m.claimed_at is not null then 'kept'
                when m.reaped_at is not null or m.expires_at <= now() or m.workspace_id is null then 'expired'
                else 'live' end as state,
           case when m.claimed_at is null then null
                when u.created_at >= m.created_at then 'new'
                else 'existing' end as keeper,
           m.claimed_at is not null and exists (
             select 1 from public.user_active_day a
              where a.user_id = m.claimed_by
                and a.day > (m.claimed_at at time zone 'utc')::date) as came_back
      from public.mcp_drafts m
      left join auth.users u on u.id = m.claimed_by
     where m.created_at >= v_since
       and not exists (select 1 from internal i where i.user_id = m.claimed_by)
  ),
  per_host as (
    select d.host,
           count(*) as made,
           count(*) filter (where d.first_viewed_at is not null) as opened,
           count(*) filter (where d.state = 'kept') as kept,
           count(*) filter (where d.keeper = 'new') as kept_new,
           count(*) filter (where d.came_back) as came_back,
           count(*) filter (where d.state = 'expired') as expired,
           count(*) filter (where d.state = 'live') as live
      from d
     group by d.host
  ),
  late as (
    -- A client writes these, so its host is taken only from the three there are.
    select case when e.props->>'host' in ('chatgpt', 'claude') then e.props->>'host' else 'other' end as host,
           count(*) as n
      from public.analytics_events e
     where e.event = 'keep_page_view' and e.props->>'state' = 'expired'
       and e.occurred_at >= v_since
       and not exists (select 1 from internal i where i.user_id = e.user_id)
     group by 1
  )
  select jsonb_build_object(
    'days', v_days,
    'hosts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'host', hs.host, 'made', coalesce(p.made, 0), 'opened', coalesce(p.opened, 0),
               'kept', coalesce(p.kept, 0), 'kept_new', coalesce(p.kept_new, 0),
               'came_back', coalesce(p.came_back, 0), 'expired', coalesce(p.expired, 0),
               'live', coalesce(p.live, 0), 'opened_late', coalesce(l.n, 0))
             order by coalesce(p.made, 0) desc, hs.host)
        from (select ph.host from per_host ph union select lt.host from late lt) hs
        left join per_host p on p.host = hs.host
        left join late l on l.host = hs.host), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'host', r.host, 'state', r.state, 'made_at', r.created_at,
               'last_used_at', r.last_used_at, 'opened_at', r.first_viewed_at, 'kept_at', r.claimed_at,
               'keeper', r.keeper, 'came_back', r.came_back, 'expires_at', r.expires_at)
             order by r.touched_at desc, r.id)
        from (select d.*, greatest(d.created_at, d.last_used_at, d.first_viewed_at, d.claimed_at) as touched_at
                from d
               order by touched_at desc, d.id
               limit 25) r), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$function$;
revoke execute on function public.admin_mcp_drafts(integer, boolean) from public, anon;
grant execute on function public.admin_mcp_drafts(integer, boolean) to authenticated, service_role;

-- ── 5. The 0311 habit: prove the grants, then the behaviour ──────────────────
do $proof$
declare
  v_sig  text := 'public.admin_mcp_drafts(integer, boolean)';
  v_view text := 'public.mcp_draft_keep_view(text, uuid)';
  v_def  text;
begin
  if to_regprocedure(v_sig) is null then
    raise exception '0708: % is missing', v_sig;
  end if;
  if has_function_privilege('anon', v_sig, 'execute') then
    raise exception '0708: % is reachable signed out', v_sig;
  end if;
  if not has_function_privilege('authenticated', v_sig, 'execute')
     or not has_function_privilege('service_role', v_sig, 'execute') then
    raise exception '0708: % lost its grant', v_sig;
  end if;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname = 'admin_mcp_drafts') <> 1 then
    raise exception '0708: an overload sits beside admin_mcp_drafts';
  end if;
  v_def := pg_get_functiondef(v_sig::regprocedure);
  if v_def not like '%perform public._require_admin();%'
     or v_def not like '%public._internal_user_ids()%' then
    raise exception '0708: % lost its gate or the people it leaves out', v_sig;
  end if;
  if not (select p.prosecdef from pg_proc p where p.oid = v_sig::regprocedure) then
    raise exception '0708: % is not security definer', v_sig;
  end if;

  -- The keep view stays the Worker's alone, and writes the first open.
  if has_function_privilege('anon', v_view, 'execute')
     or has_function_privilege('authenticated', v_view, 'execute') then
    raise exception '0708: % is callable from outside', v_view;
  end if;
  if pg_get_functiondef(v_view::regprocedure)
       not like '%set first_viewed_at = now() where m.id = d.id and m.first_viewed_at is null;%' then
    raise exception '0708: % does not stamp the first open', v_view;
  end if;
  if (select p.provolatile from pg_proc p where p.oid = v_view::regprocedure) <> 'v' then
    raise exception '0708: % must stay volatile to write', v_view;
  end if;
  if has_column_privilege('authenticated', 'public.mcp_drafts', 'first_viewed_at', 'select')
     or has_column_privilege('anon', 'public.mcp_drafts', 'first_viewed_at', 'select') then
    raise exception '0708: a client can read mcp_drafts.first_viewed_at';
  end if;

  -- The channel: a keep page is its own whatever brought them to it, a paid
  -- click still wins, and 0335's arms are as they were.
  assert public.derive_acquisition_channel('{"landing_path":"/keep/:token"}'::jsonb) = 'mcp_draft', 'keep page';
  assert public.derive_acquisition_channel('{"landing_path":"/keep/:token","utm_source":"chatgpt.com"}'::jsonb) = 'mcp_draft', 'keep page from ChatGPT';
  assert public.derive_acquisition_channel('{"landing_path":"/keep/:token","referrer_host":"claude.ai"}'::jsonb) = 'mcp_draft', 'keep page from Claude';
  assert public.derive_acquisition_channel('{"landing_path":"/keepsake","utm_source":"chatgpt.com"}'::jsonb) = 'chatgpt', 'only /keep/ itself';
  assert public.derive_acquisition_channel('{"landing_path":"/keep/:token","gclid":"x"}'::jsonb) = 'google_ads', 'a paid click still wins';
  assert public.derive_acquisition_channel('{"landing_path":"/oauth/authorize","utm_source":"chatgpt.com"}'::jsonb) = 'mcp_connect', 'connect screen still leads';
  assert public.derive_acquisition_channel('{"utm_source":"chatgpt.com"}'::jsonb) = 'chatgpt', 'utm chatgpt.com';
  assert public.derive_acquisition_channel('{"referrer_host":"gemini.google.com"}'::jsonb) = 'gemini', 'ref gemini beats google';
  assert public.derive_acquisition_channel('{"utm_source":"meta.ai"}'::jsonb) = 'ai', 'utm meta.ai beats meta_organic';
  assert public.derive_acquisition_channel('{}'::jsonb) = 'direct', 'empty bag';
end $proof$;
