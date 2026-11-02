-- 0840_admin_posts_source.sql — where the admin phone panel's Posts tab reads
-- from (the owner, 2026-11-01: "make our tiktok posts downloaded thing into like
-- a mobile admin panel").
--
-- The daily TikTok slideshows are published to a private page whose address is
-- itself the secret, and "Posted" is a message on a private push topic. Neither
-- belongs in this public repo or in the browser bundle, so they live in one row
-- here and only the Worker's /api/admin/posts/… route reads them, as the
-- signed-in admin (userRpc), to fetch the page's files on the admin's behalf.
--
-- admin_posts_source: a single row (id = true), RLS on, no policies, every grant
-- revoked: nothing reads it but the definer function below.
--
-- New: admin_posts_source(), admin only (_require_admin), EXECUTE for
-- authenticated and service_role only (0311). Returns {base, topic} or null
-- when the row isn't there yet.

begin;

set local lock_timeout = '3s';

create table if not exists public.admin_posts_source (
  id boolean primary key default true check (id),
  base text not null check (base ~ '^https://[^\s]+/$'),
  topic text not null check (topic ~ '^[A-Za-z0-9_-]{1,64}$'),
  updated_at timestamptz not null default now()
);

alter table public.admin_posts_source enable row level security;
revoke all on table public.admin_posts_source from public, anon, authenticated;

create or replace function public.admin_posts_source()
returns jsonb
language plpgsql stable
security definer
set search_path = 'public'
as $$
declare
  r public.admin_posts_source%rowtype;
begin
  perform public._require_admin();
  select * into r from public.admin_posts_source where id;
  if not found then
    return null;
  end if;
  return jsonb_build_object('base', r.base, 'topic', r.topic);
end
$$;

revoke execute on function public.admin_posts_source() from public, anon;
grant execute on function public.admin_posts_source() to authenticated, service_role;

-- ── 0311: prove the grants ───────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.admin_posts_source()', 'execute') then
    raise exception '0840: anon can execute admin_posts_source';
  end if;
  if not has_function_privilege('authenticated', 'public.admin_posts_source()', 'execute') then
    raise exception '0840: authenticated cannot execute admin_posts_source';
  end if;
  if not has_function_privilege('service_role', 'public.admin_posts_source()', 'execute') then
    raise exception '0840: service_role cannot execute admin_posts_source';
  end if;
  if has_table_privilege('anon', 'public.admin_posts_source', 'select')
     or has_table_privilege('authenticated', 'public.admin_posts_source', 'select') then
    raise exception '0840: admin_posts_source is readable by a client role';
  end if;
end
$$;

commit;
