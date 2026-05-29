-- 0094_storage_stats_decode_fix.sql — fix the admin Storage panel crashing with
-- 'invalid symbol "." found while decoding base64 sequence'.
--
-- Root cause (0072_storage_tracking.sql): the storage RPCs size Postgres docs
-- with octet_length(decode(col, 'base64')). But:
--   • board_state.doc is BYTEA (0001_init.sql), not base64 text — decoding it
--     throws on the first row whose bytes aren't a valid base64 string, which
--     aborts the whole function and blanks the panel.
--   • board_snapshots.doc_b64 / board_ops.update_b64 ARE base64 text, so decode
--     is correct there, but a single legacy/malformed row still crashes the
--     entire stats query.
--
-- Fix, sized by each column's real type:
--   • board_state.doc (bytea)            → octet_length(doc)        (true bytes)
--   • board_snapshots.doc_b64 (text b64) → public.b64_bytes(doc_b64)
--   • board_ops.update_b64   (text b64)  → public.b64_bytes(update_b64)
-- where b64_bytes() decodes when it can and falls back to an estimate on any
-- malformed row instead of throwing. (0069_compaction_dryrun already sizes ops
-- the crash-proof way with plain octet_length — 0072 was the fragile outlier.)
--
-- The JSON shape, per-tier rollup, R2 totals, ordering, and limits are
-- unchanged, so the dashboard's data contract is identical.

------------------------------------------------------------------
-- 0. Crash-proof decoded-byte size for base64 TEXT columns.
------------------------------------------------------------------
create or replace function public.b64_bytes(t text)
returns bigint language plpgsql immutable parallel safe as $$
begin
  if t is null or t = '' then return 0; end if;
  return octet_length(decode(t, 'base64'));
exception when others then
  -- legacy / malformed row: estimate decoded size (~3 bytes per 4 b64 chars)
  return (octet_length(t) * 3 / 4)::bigint;
end;
$$;

------------------------------------------------------------------
-- 1. admin_storage_stats — totals + per-tier breakdown
------------------------------------------------------------------
create or replace function public.admin_storage_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_out jsonb;
  v_r2_total bigint;
  v_r2_unknown int;
  v_state_total bigint;
  v_snap_total bigint;
  v_ops_total bigint;
  v_by_tier jsonb;
begin
  perform public._require_admin();

  -- R2 totals
  select coalesce(sum(size_bytes), 0)::bigint,
         count(*) filter (where size_bytes is null)::int
    into v_r2_total, v_r2_unknown
  from public.images
  where deleted_at is null;

  -- board_state.doc is BYTEA — octet_length() is its exact stored byte size.
  select coalesce(sum(octet_length(doc)), 0)::bigint
    into v_state_total
  from public.board_state where doc is not null;

  -- board_snapshots.doc_b64 is base64 TEXT; b64_bytes() gives decoded size and
  -- never throws on a malformed row.
  select coalesce(sum(public.b64_bytes(doc_b64)), 0)::bigint
    into v_snap_total
  from public.board_snapshots where doc_b64 is not null and storage = 'inline';

  -- board_ops.update_b64: same treatment.
  begin
    select coalesce(sum(public.b64_bytes(update_b64)), 0)::bigint
      into v_ops_total
    from public.board_ops where update_b64 is not null;
  exception when undefined_column then
    v_ops_total := 0;   -- board_ops schema may not have update_b64 in older deploys
  end;

  -- Per-tier breakdown (R2 + DB combined)
  with img_per_user as (
    select uploaded_by as user_id, sum(coalesce(size_bytes, 0))::bigint as r2_bytes
    from public.images
    where deleted_at is null and uploaded_by is not null
    group by uploaded_by
  ),
  state_per_user as (
    select b.created_by as user_id,
           coalesce(sum(octet_length(bs.doc)), 0)::bigint as db_bytes
    from public.boards b
    left join public.board_state bs on bs.board_id = b.id
    where b.created_by is not null
    group by b.created_by
  ),
  combined as (
    select
      u.id as user_id,
      coalesce(p.tier, 'demo')::text as tier,
      coalesce(i.r2_bytes, 0) as r2_bytes,
      coalesce(s.db_bytes, 0) as db_bytes
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    left join img_per_user   i on i.user_id = u.id
    left join state_per_user s on s.user_id = u.id
  )
  select jsonb_object_agg(tier, row_to_json(t)::jsonb) into v_by_tier
  from (
    select tier,
           sum(r2_bytes)::bigint as r2_bytes,
           sum(db_bytes)::bigint as db_bytes,
           (sum(r2_bytes) + sum(db_bytes))::bigint as total_bytes,
           count(*)::bigint as users
    from combined
    group by tier
  ) t;

  select jsonb_build_object(
    'totals', jsonb_build_object(
      'r2_bytes',        v_r2_total,
      'r2_unknown_rows', v_r2_unknown,
      'db_bytes',        v_state_total + v_snap_total + v_ops_total,
      'db_breakdown', jsonb_build_object(
        'board_state',     v_state_total,
        'board_snapshots', v_snap_total,
        'board_ops',       v_ops_total
      ),
      'grand_total',     v_r2_total + v_state_total + v_snap_total + v_ops_total
    ),
    'by_tier', coalesce(v_by_tier, '{}'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;
revoke all on function public.admin_storage_stats() from public;
grant execute on function public.admin_storage_stats() to authenticated;

------------------------------------------------------------------
-- 2. admin_storage_per_user — paginated, sorted by total bytes desc
------------------------------------------------------------------
create or replace function public.admin_storage_per_user(p_limit int default 20)
returns table(
  user_id      uuid,
  email        text,
  tier         text,
  r2_bytes     bigint,
  db_bytes     bigint,
  total_bytes  bigint,
  image_count  bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  p_limit := greatest(1, least(p_limit, 100));

  return query
  with img_per_user as (
    select uploaded_by as uid,
           sum(coalesce(size_bytes, 0))::bigint as r2_bytes,
           count(*)::bigint as image_count
    from public.images
    where deleted_at is null and uploaded_by is not null
    group by uploaded_by
  ),
  state_per_user as (
    select b.created_by as uid,
           coalesce(sum(octet_length(bs.doc)), 0)::bigint as db_bytes
    from public.boards b
    left join public.board_state bs on bs.board_id = b.id
    where b.created_by is not null
    group by b.created_by
  )
  select
    u.id                              as user_id,
    u.email::text                     as email,
    coalesce(p.tier, 'demo')::text    as tier,
    coalesce(i.r2_bytes, 0)           as r2_bytes,
    coalesce(s.db_bytes, 0)           as db_bytes,
    (coalesce(i.r2_bytes, 0) + coalesce(s.db_bytes, 0))::bigint as total_bytes,
    coalesce(i.image_count, 0)        as image_count
  from auth.users u
  left join public.profiles p   on p.user_id = u.id
  left join img_per_user   i    on i.uid = u.id
  left join state_per_user s    on s.uid = u.id
  order by (coalesce(i.r2_bytes, 0) + coalesce(s.db_bytes, 0)) desc
  limit p_limit;
end;
$$;
revoke all on function public.admin_storage_per_user(int) from public;
grant execute on function public.admin_storage_per_user(int) to authenticated;

revoke all on function public.b64_bytes(text) from public;
grant execute on function public.b64_bytes(text) to authenticated;
