-- 0707 — a draft's keep link is a link token too.
--
-- /keep/<token> is a draft's keep page (worker-keep.js, lib/mcpDrafts.js): it
-- shows what ChatGPT or Claude made for someone without an account, and lets
-- whoever holds the link keep it. So its token is a key, like a share link's,
-- and 0474's rule holds for it: never in an event or an error report. 0474's
-- two helpers learn the route; the triggers that call them, and everything
-- else 0474 made, are unchanged. linkTokens.js and the pixel's guard in
-- index.html learn it in the same commit, and linkTokens.test.mjs holds the
-- four places to one list of routes.
--
-- Nothing stored needs redacting: the first keep link was minted on
-- 2026-10-27, by drafts on preview, and no page served /keep/ before this.
-- The proof holds every stored row to the new helpers, as 0474's did; the
-- three tables are small enough to read whole.

-- ── 1. The redaction, with /keep/ ───────────────────────────────────────────
create or replace function public._redact_link_text(p text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select regexp_replace(p,
    '(/(?:share|f|t|keep)/)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
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
         and p::text !~* '/(share|f|t|keep)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
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
                          '(/(?:share|f|t|keep)/)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
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

-- ── 2. Prove it (a REVOKE that reports success proves nothing) ──────────────
do $proof$
declare
  v_bad text := '';
  v_role text;
  v_fn text;
  v_tok constant text := '00000000-0000-4000-8000-000000000001';
  v_board constant text := '00000000-0000-4000-8000-000000000002';
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_fn in array array['public._redact_link_text(text)', 'public._redact_link_tokens(jsonb)'] loop
      if has_function_privilege(v_role, v_fn, 'execute') then
        v_bad := v_bad || ' ' || v_role || ' can execute ' || v_fn || ';';
      end if;
    end loop;
  end loop;
  foreach v_fn in array array['public._redact_link_text(text)', 'public._redact_link_tokens(jsonb)'] loop
    if not has_function_privilege('service_role', v_fn, 'execute') then
      v_bad := v_bad || ' service_role cannot execute ' || v_fn || ';';
    end if;
  end loop;

  -- 0474's samples, unchanged, and the keep page's.
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
     or public._redact_link_text(null) is not null
     or public._redact_link_text('/keep/' || v_tok) is distinct from '/keep/:token'
     or public._redact_link_text('/KEEP/' || upper(v_tok) || '?b=' || v_board) is distinct from '/KEEP/:token?b=' || v_board
     or public._redact_link_tokens(jsonb_build_object('landing_path', '/keep/' || v_tok, 'board_id', v_board))
          is distinct from jsonb_build_object('landing_path', '/keep/:token', 'board_id', v_board)
     or public._redact_link_text('/keeper/' || v_tok) is distinct from '/keeper/' || v_tok then
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
    v_bad := v_bad || ' a stored row holds a link token;';
  end if;

  if v_bad <> '' then
    raise exception '0707:%', v_bad;
  end if;
end $proof$;
