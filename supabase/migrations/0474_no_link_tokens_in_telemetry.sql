-- 0474 — a link's token is never kept in an event or an error report
-- (owner, 2026-10-20).
--
-- A share link (/share/<token>), a shared file (/f/<token>) and a shared
-- template (/t/<token>) open what they point at to anyone who holds the token.
-- Events kept it anyway, and nothing read it from them:
--   * share_token / lt_share_token — the first- and latest-touch bags ride on
--     every event of a visit that arrived through a link;
--   * utm_campaign / lt_utm_campaign — the share, file and template pages'
--     sign-up links set the campaign to the token;
--   * landing_path, and an href — the page's path;
--   * path, the column every event records its page in;
--   * share_token / file_token passed by hand on a few events.
-- The sharer's credit reads profiles.first_source, which keeps the token and
-- is not touched here, and the channel reads utm_source. Error reports kept the
-- token the same way, in path and in stack traces.
--
-- (1) _redact_link_text(text): every /share|f|t/<uuid> becomes /<route>/:token,
--     anywhere in the text. _redact_link_tokens(jsonb): share_token,
--     lt_share_token, file_token and lt_file_token are dropped; a UUID in
--     utm_campaign or lt_utm_campaign becomes :token; every other top-level
--     string has its link paths redacted. Board ids and other UUIDs that open
--     nothing are left alone. A row with nothing to redact — nearly all of
--     them — is returned as it came, without being rebuilt.
-- (2) The rows already stored are redacted the same way, in both event tables
--     and in client_errors.
-- (3) analytics_events_c_redact_links, before insert: every row, from any
--     client version or from SQL, is redacted before divert_synthetic copies it
--     to the archive ('c' sorts after the caller guard and the country stamp,
--     before 'divert'). client_errors_redact_links does the same for path,
--     message, stack and component_stack. Both trigger functions are SECURITY
--     DEFINER so the helpers can stay closed to every client role.
--     The triggers are created last: CREATE TRIGGER locks the table against
--     inserts until commit, and the clients' events must not queue behind the
--     redaction of history. Rows that land while (2) runs are caught up once the
--     triggers exist.

-- ── 1. The redaction ────────────────────────────────────────────────────────
create or replace function public._redact_link_text(p text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select regexp_replace(p,
    '(/(?:share|f|t)/)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
    '\1:token', 'gi')
$$;

create or replace function public._redact_link_tokens(p jsonb)
returns jsonb
language sql
immutable
set search_path to 'public'
as $$
  select case
    when p is null or jsonb_typeof(p) <> 'object' then p
    when not (p ?| array['share_token', 'lt_share_token', 'file_token', 'lt_file_token'])
         and coalesce(p->>'utm_campaign', '') !~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
         and coalesce(p->>'lt_utm_campaign', '') !~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
         and p::text !~* '/(share|f|t)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      then p
    else coalesce((
      select jsonb_object_agg(kv.k,
               case
                 when jsonb_typeof(kv.v) <> 'string' then kv.v
                 when kv.k in ('utm_campaign', 'lt_utm_campaign')
                   then to_jsonb(regexp_replace(kv.v #>> '{}',
                          '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
                          ':token', 'gi'))
                 else to_jsonb(regexp_replace(kv.v #>> '{}',
                          '(/(?:share|f|t)/)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
                          '\1:token', 'gi'))
               end)
        from jsonb_each(p) as kv(k, v)
       where kv.k not in ('share_token', 'lt_share_token', 'file_token', 'lt_file_token')
    ), '{}'::jsonb)
  end
$$;

revoke all on function public._redact_link_text(text) from public, anon, authenticated;
revoke all on function public._redact_link_tokens(jsonb) from public, anon, authenticated;
grant execute on function public._redact_link_text(text) to service_role;
grant execute on function public._redact_link_tokens(jsonb) to service_role;

-- ── 2. What is already stored ───────────────────────────────────────────────
update public.analytics_events
   set props = public._redact_link_tokens(props),
       path = public._redact_link_text(path)
 where public._redact_link_tokens(props) is distinct from props
    or public._redact_link_text(path) is distinct from path;

update public.analytics_events_synthetic
   set props = public._redact_link_tokens(props),
       path = public._redact_link_text(path)
 where public._redact_link_tokens(props) is distinct from props
    or public._redact_link_text(path) is distinct from path;

update public.client_errors
   set path = public._redact_link_text(path),
       message = public._redact_link_text(message),
       stack = public._redact_link_text(stack),
       component_stack = public._redact_link_text(component_stack)
 where public._redact_link_text(path) is distinct from path
    or public._redact_link_text(message) is distinct from message
    or public._redact_link_text(stack) is distinct from stack
    or public._redact_link_text(component_stack) is distinct from component_stack;

-- ── 3. On the way in ────────────────────────────────────────────────────────
create or replace function public._tg_redact_event_links()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  new.props := public._redact_link_tokens(new.props);
  new.path := public._redact_link_text(new.path);
  return new;
end $$;

create or replace function public._tg_redact_client_error_links()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  new.path := public._redact_link_text(new.path);
  new.message := public._redact_link_text(new.message);
  new.stack := public._redact_link_text(new.stack);
  new.component_stack := public._redact_link_text(new.component_stack);
  return new;
end $$;

revoke all on function public._tg_redact_event_links() from public, anon, authenticated;
revoke all on function public._tg_redact_client_error_links() from public, anon, authenticated;

-- ── 4. Prove the redaction, before any table is locked ─────────────────────
-- (a REVOKE that reports success proves nothing)
do $proof$
declare
  v_bad text := '';
  v_role text;
  v_fn text;
  v_tok constant text := '00000000-0000-4000-8000-000000000001';
  v_board constant text := '00000000-0000-4000-8000-000000000002';
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_fn in array array['public._redact_link_text(text)', 'public._redact_link_tokens(jsonb)',
                                'public._tg_redact_event_links()', 'public._tg_redact_client_error_links()'] loop
      if has_function_privilege(v_role, v_fn, 'execute') then
        v_bad := v_bad || ' ' || v_role || ' can execute ' || v_fn || ';';
      end if;
    end loop;
  end loop;

  if public._redact_link_tokens(jsonb_build_object(
       'share_token', v_tok, 'lt_share_token', v_tok, 'file_token', v_tok, 'lt_file_token', v_tok,
       'utm_source', 'share_link', 'utm_campaign', v_tok, 'lt_utm_campaign', 'share_link/' || upper(v_tok),
       'landing_path', '/share/' || v_tok, 'href', 'https://clusters.soleilpictures.com/f/' || v_tok || '?x=1',
       'board_id', v_board, 'path_b', '/b/' || v_board, 'n', 3, 'ok', true))
     is distinct from jsonb_build_object(
       'utm_source', 'share_link', 'utm_campaign', ':token', 'lt_utm_campaign', 'share_link/:token',
       'landing_path', '/share/:token', 'href', 'https://clusters.soleilpictures.com/f/:token?x=1',
       'board_id', v_board, 'path_b', '/b/' || v_board, 'n', 3, 'ok', true)
     or public._redact_link_tokens('{}'::jsonb) is distinct from '{}'::jsonb
     or public._redact_link_tokens(null) is not null
     or public._redact_link_text('/T/' || upper(v_tok) || '/') is distinct from '/T/:token/'
     or public._redact_link_text('at https://x/share/' || v_tok || ':1:20') is distinct from 'at https://x/share/:token:1:20'
     or public._redact_link_text(null) is not null then
    v_bad := v_bad || ' the redaction gets a sample wrong;';
  end if;

  if exists (select 1 from public.analytics_events
              where public._redact_link_tokens(props) is distinct from props
                 or public._redact_link_text(path) is distinct from path)
     or exists (select 1 from public.analytics_events_synthetic
                 where public._redact_link_tokens(props) is distinct from props
                    or public._redact_link_text(path) is distinct from path)
     or exists (select 1 from public.client_errors
                 where public._redact_link_text(path) is distinct from path
                    or public._redact_link_text(message) is distinct from message
                    or public._redact_link_text(stack) is distinct from stack
                    or public._redact_link_text(component_stack) is distinct from component_stack) then
    v_bad := v_bad || ' a stored row still holds a link token;';
  end if;

  if v_bad <> '' then
    raise exception '0474:%', v_bad;
  end if;
end $proof$;

-- ── 5. The triggers, then whatever landed while history was redacted ───────
create or replace trigger analytics_events_c_redact_links
  before insert on public.analytics_events
  for each row execute function public._tg_redact_event_links();

create or replace trigger client_errors_redact_links
  before insert on public.client_errors
  for each row execute function public._tg_redact_client_error_links();

update public.analytics_events
   set props = public._redact_link_tokens(props),
       path = public._redact_link_text(path)
 where received_at >= now() - interval '15 minutes'
   and (public._redact_link_tokens(props) is distinct from props
        or public._redact_link_text(path) is distinct from path);

update public.analytics_events_synthetic
   set props = public._redact_link_tokens(props),
       path = public._redact_link_text(path)
 where received_at >= now() - interval '15 minutes'
   and (public._redact_link_tokens(props) is distinct from props
        or public._redact_link_text(path) is distinct from path);

update public.client_errors
   set path = public._redact_link_text(path),
       message = public._redact_link_text(message),
       stack = public._redact_link_text(stack),
       component_stack = public._redact_link_text(component_stack)
 where occurred_at >= now() - interval '15 minutes'
   and (public._redact_link_text(path) is distinct from path
        or public._redact_link_text(message) is distinct from message
        or public._redact_link_text(stack) is distinct from stack
        or public._redact_link_text(component_stack) is distinct from component_stack);

do $proof_triggers$
declare
  v_names text;
begin
  -- The redaction runs before the divert, so the archive gets redacted rows too.
  select string_agg(t.tgname, ',' order by t.tgname) into v_names
    from pg_trigger t
   where t.tgrelid = 'public.analytics_events'::regclass and not t.tgisinternal
     and t.tgenabled = 'O' and (t.tgtype & 2) <> 0 and (t.tgtype & 4) <> 0;
  if v_names is distinct from 'analytics_events_a_caller_guard,analytics_events_b_stamp_country,'
                               'analytics_events_c_redact_links,analytics_events_divert_synthetic' then
    raise exception '0474: the before-insert triggers on analytics_events are %', coalesce(v_names, 'none');
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.client_errors'::regclass
                    and t.tgname = 'client_errors_redact_links' and t.tgenabled = 'O'
                    and t.tgfoid = 'public._tg_redact_client_error_links()'::regprocedure
                    and (t.tgtype & 2) <> 0 and (t.tgtype & 4) <> 0) then
    raise exception '0474: client_errors_redact_links is not an enabled before-insert trigger';
  end if;
end $proof_triggers$;

notify pgrst, 'reload schema';
