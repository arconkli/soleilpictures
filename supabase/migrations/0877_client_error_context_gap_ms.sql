-- 0877_client_error_context_gap_ms.sql
--
-- The app now reports a gap in milliseconds with some failures (a frame gap or
-- freeze in lib/perfReport.js, the page-crash report in App.jsx) as
-- context.gap_ms, and
-- lib/errorCore.js's ERROR_CONTEXT_KEYS lists it. The server's twin,
-- _client_error_context (0580), kept only the keys it knew, so gap_ms was
-- dropped on arrival and the Issues view never saw it.
--
-- gap_ms joins the allowlist exactly as 'ms' is kept: a JSON number, rounded
-- and clamped by _error_ctx_int, anything else dropped. Every other key, and
-- the function around them (sql, immutable, search_path public, no SECURITY
-- DEFINER), is 0580's word for word. create or replace keeps its grants:
-- service_role only, no client role, which the block below proves.
-- errorCore.test.mjs holds the two key lists equal.

begin;

create or replace function public._client_error_context(p jsonb)
returns jsonb
language sql
immutable
set search_path to 'public'
as $$
  select case when p is null or jsonb_typeof(p) <> 'object' then null else
    nullif(jsonb_strip_nulls(jsonb_build_object(
      'op',       public._error_ctx_s(p->'op'),
      'code',     public._error_ctx_s(p->'code'),
      'surface',  public._error_ctx_s(p->'surface'),
      'vis',      public._error_ctx_s(p->'vis'),
      'net',      public._error_ctx_s(p->'net'),
      'tag',      public._error_ctx_s(p->'tag'),
      'host',     public._error_ctx_s(p->'host'),
      'phase',    public._error_ctx_s(p->'phase'),
      'group',    public._error_ctx_s(p->'group'),
      'board_id', case when jsonb_typeof(p->'board_id') = 'string'
                        and (p->>'board_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       then lower(p->>'board_id') end,
      'online',   case when jsonb_typeof(p->'online') = 'boolean' then p->'online' end,
      'attempt',  public._error_ctx_int(p->'attempt'),
      'ms',       public._error_ctx_int(p->'ms'),
      'gap_ms',   public._error_ctx_int(p->'gap_ms'),
      'http',     case when jsonb_typeof(p->'http') = 'object' then
                    nullif(jsonb_strip_nulls(jsonb_build_object(
                      'method', public._error_ctx_s(p->'http'->'method'),
                      'svc',    public._error_ctx_s(p->'http'->'svc'),
                      'route',  public._error_ctx_s(p->'http'->'route'),
                      'pg',     public._error_ctx_s(p->'http'->'pg'),
                      'status', public._error_ctx_int(p->'http'->'status'),
                      'ms',     public._error_ctx_int(p->'http'->'ms'))), '{}'::jsonb)
                  end)), '{}'::jsonb)
  end
$$;

revoke all on function public._client_error_context(jsonb) from public, anon, authenticated;

do $proof$
begin
  -- The 0311 habit: effective privileges, PUBLIC included.
  if has_function_privilege('anon', 'public._client_error_context(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public._client_error_context(jsonb)', 'execute') then
    raise exception '0877: a client role can run _client_error_context';
  end if;
  if public._client_error_context('{"gap_ms": 1500.4, "ms": 20}'::jsonb) <> '{"gap_ms": 1500, "ms": 20}'::jsonb then
    raise exception '0877: gap_ms is not kept like ms';
  end if;
  if public._client_error_context('{"gap_ms": "soon", "nope": 1}'::jsonb) is not null then
    raise exception '0877: a non-number gap_ms or an unknown key survives';
  end if;
end $proof$;

commit;
