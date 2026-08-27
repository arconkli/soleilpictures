-- 0270_grid_layout_origin.sql
--
-- Where a saved template came from, so the panel can separate "Yours" from
-- "Downloaded".
--
-- Both ways of acquiring somebody else's template — claiming a share link, and
-- using one from the public gallery — insert a COPY into the caller's library.
-- That copy semantics is deliberate (revoking a link or taking a template down
-- must not reach into anyone's library), but it left every copy sitting in the
-- same list as the ones you built yourself, indistinguishable.
--
-- NOT CLIENT-WRITABLE, on purpose. `origin` is absent from the column-list
-- INSERT/UPDATE grants in 0265: a direct insert (saveGridLayout) takes the
-- 'own' default, and the two functions that create copies are SECURITY DEFINER
-- so they set it without needing a grant. The effect is that a downloaded
-- template cannot quietly relabel itself as one you made.

alter table public.grid_layouts
  add column if not exists origin text not null default 'own'
  check (origin in ('own', 'link', 'gallery'));

comment on column public.grid_layouts.origin is
  'Where this row came from: own = made here, link = claimed from a share link, gallery = taken from /templates. Set by the claim/use RPCs only; deliberately absent from the client column grants so a copy cannot relabel itself.';

-- The two copy paths now stamp their origin. Bodies are otherwise unchanged
-- from 0265/0266 — see those files for the idempotency and copy-not-grant
-- reasoning.
create or replace function public.claim_grid_layout_link(p_token uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_src  record;
  v_dup  uuid;
  v_new  uuid;
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  select id, name, body, created_by into v_src
  from grid_layouts
  where share_token = p_token and deleted_at is null;
  if v_src.id is null then
    raise exception 'this link is no longer live' using errcode = 'P0002';
  end if;
  if v_src.created_by = auth.uid() then
    return v_src.id;
  end if;
  select id into v_dup
  from grid_layouts
  where created_by = auth.uid() and deleted_at is null
    and body = v_src.body and name = v_src.name
  limit 1;
  if v_dup is not null then
    return v_dup;
  end if;
  insert into grid_layouts (workspace_id, name, body, scope, created_by, origin)
  values (null, v_src.name, v_src.body, 'user', auth.uid(), 'link')
  returning id into v_new;
  return v_new;
end $$;
revoke all on function public.claim_grid_layout_link(uuid) from public, anon, authenticated;
grant execute on function public.claim_grid_layout_link(uuid) to authenticated;

create or replace function public.use_public_grid_layout(p_slug text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id  uuid;
  v_src record;
  v_dup uuid;
  v_new uuid;
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  v_id := public._resolve_published_grid_layout(p_slug);
  if v_id is null then
    raise exception 'no such template' using errcode = 'P0002';
  end if;
  select id, name, body, created_by into v_src from grid_layouts where id = v_id;
  if v_src.created_by = auth.uid() then
    return v_src.id;
  end if;
  select id into v_dup from grid_layouts
  where created_by = auth.uid() and deleted_at is null
    and body = v_src.body and name = v_src.name
  limit 1;
  if v_dup is not null then
    return v_dup;
  end if;
  insert into grid_layouts (workspace_id, name, body, scope, created_by, origin)
  values (null, v_src.name, v_src.body, 'user', auth.uid(), 'gallery')
  returning id into v_new;
  update public_grid_layouts set use_count = use_count + 1 where layout_id = v_id;
  return v_new;
end $$;
revoke all on function public.use_public_grid_layout(text) from public, anon, authenticated;
grant execute on function public.use_public_grid_layout(text) to authenticated;
