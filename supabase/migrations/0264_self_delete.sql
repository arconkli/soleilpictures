-- 0264_self_delete.sql — let a person delete their own account.
--
-- Three parts, in dependency order.
--
-- 1. FOUR FOREIGN KEYS TO auth.users WERE `ON DELETE NO ACTION`.
--    comments.author, tags.created_by, vote_cards.author and
--    board_templates.created_by. Every other user-referencing FK in the schema
--    is CASCADE or SET NULL; these four were left at the SQL default, which
--    RAISES rather than cascading. So `auth.admin.deleteUser` — the last step
--    of the admin "delete account" action in admin-account-action — has never
--    been able to remove anyone who ever left a comment, made a tag or voted
--    on a card. At the time of writing that is every user who has done more
--    than look around. The advertised GDPR erasure path has been failing on a
--    foreign-key violation, and self-serve deletion cannot exist until it
--    stops.
--
--    SET NULL for the three nullable ones, which matches how the schema
--    already treats authored content everywhere else (board_ops.author_id,
--    board_versions.made_by, images.uploaded_by): the work survives, the
--    authorship link is severed. board_templates.created_by is NOT NULL so it
--    cannot take SET NULL; CASCADE is right there anyway — a template whose
--    author is gone belongs to nobody — and the table is empty today, so this
--    is free.
--
-- 2. my_deletion_impact() — what deletion will actually do to THIS caller, so
--    the confirm dialog can state it instead of warning in the abstract.
--
-- 3. prepare_account_deletion() — the part that must be transactional: shared
--    workspaces you own transfer to their longest-standing other member;
--    workspaces only you are in are deleted with everything inside them.
--    Called by the delete-own-account edge function before it cancels Stripe,
--    anonymizes analytics, and removes the auth user.
--
-- WHY TRANSFER RATHER THAN ORPHAN. workspaces.created_by is SET NULL, and
-- ownership is *derived* from it — so deleting the creator of a shared
-- workspace leaves it with no owner at all. Collaborators keep every board,
-- and nobody can ever rename it, change its icon, or delete it. That is
-- survivable for a rare supervised admin delete. It is not survivable as a
-- button anyone can press.

begin;

-- ── 1. Unblock deletion ─────────────────────────────────────────────────────
alter table public.comments drop constraint if exists comments_author_fkey;
alter table public.comments add constraint comments_author_fkey
  foreign key (author) references auth.users(id) on delete set null;

alter table public.tags drop constraint if exists tags_created_by_fkey;
alter table public.tags add constraint tags_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table public.vote_cards drop constraint if exists vote_cards_author_fkey;
alter table public.vote_cards add constraint vote_cards_author_fkey
  foreign key (author) references auth.users(id) on delete set null;

alter table public.board_templates drop constraint if exists board_templates_created_by_fkey;
alter table public.board_templates add constraint board_templates_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete cascade;

-- ── 2. What will happen ─────────────────────────────────────────────────────
-- Read-only. Safe to call as often as the dialog likes.
create or replace function public.my_deletion_impact()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with me as (select auth.uid() as uid),
  -- Workspaces this caller created, split by whether anyone else is in them.
  mine as (
    select w.id, w.name,
           (select count(*) from workspace_members m
             where m.workspace_id = w.id and m.user_id <> (select uid from me)) as others
    from workspaces w
    where w.created_by = (select uid from me)
  ),
  -- The longest-standing other member is who a shared workspace goes to.
  heir as (
    select m2.workspace_id, m2.user_id,
           coalesce(nullif(p.display_name, ''), 'a collaborator') as name
    from workspace_members m2
    left join profiles p on p.user_id = m2.user_id
    where m2.workspace_id in (select id from mine where others > 0)
      and m2.user_id <> (select uid from me)
      and m2.created_at = (
        select min(m3.created_at) from workspace_members m3
        where m3.workspace_id = m2.workspace_id and m3.user_id <> (select uid from me)
      )
  )
  select jsonb_build_object(
    'workspaces_deleted', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name)
      from mine where others = 0), '[]'::jsonb),
    'workspaces_transferred', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'to_name', h.name) order by m.name)
      from mine m join heir h on h.workspace_id = m.id
      where m.others > 0), '[]'::jsonb),
    -- Clusters that go with the deleted workspaces. Excludes trashed ones:
    -- they are already gone as far as the reader is concerned.
    'clusters_deleted', coalesce((
      select count(*) from boards b
      where b.workspace_id in (select id from mine where others = 0)
        and b.deleted_at is null), 0),
    -- Shared workspaces you are only a MEMBER of: you leave, nothing is lost.
    'memberships_dropped', coalesce((
      select count(*) from workspace_members m
      join workspaces w on w.id = m.workspace_id
      where m.user_id = (select uid from me)
        and w.created_by is distinct from (select uid from me)), 0),
    'subscription_active', exists (
      select 1 from subscriptions s
      where s.user_id = (select uid from me)
        and s.status in ('active', 'trialing'))
  );
$$;

-- `revoke ... from public` does NOT cover `anon` or `authenticated`: Supabase
-- grants EXECUTE on new public functions to those NAMED roles by default, and
-- PUBLIC is a different thing. Both have to be named explicitly, which the
-- first application of this migration missed — it left prepare_account_deletion
-- callable by anon for a few minutes. Revoke from anon, then grant what is wanted.
revoke all on function public.my_deletion_impact() from public;
revoke all on function public.my_deletion_impact() from anon;
grant execute on function public.my_deletion_impact() to authenticated;

-- ── 3. Hand over, then clear out ────────────────────────────────────────────
-- Takes the subject as a parameter and is granted to service_role ONLY, which
-- is the same shape as anonymize_user_analytics / anonymize_user_client_errors
-- and for the same reason: it runs from an edge function that has already
-- established who the caller is and made them re-type their own address. A
-- service-role client has no auth.uid() to key on, and granting an
-- unconfirmable "destroy my workspaces" call to `authenticated` would put it
-- one fetch away from any signed-in page.
create or replace function public.prepare_account_deletion(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_xfer int := 0;
  v_del  int := 0;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required' using errcode = '22004';
  end if;

  -- Shared workspaces: hand to the longest-standing other member. Ownership is
  -- derived from created_by, so this is the whole transfer.
  with heir as (
    select w.id as workspace_id,
           (select m.user_id from workspace_members m
             where m.workspace_id = w.id and m.user_id <> p_user_id
             order by m.created_at asc, m.user_id asc
             limit 1) as to_user
    from workspaces w
    where w.created_by = p_user_id
      and exists (select 1 from workspace_members m
                   where m.workspace_id = w.id and m.user_id <> p_user_id)
  )
  update workspaces w
     set created_by = h.to_user
    from heir h
   where w.id = h.workspace_id and h.to_user is not null;
  get diagnostics v_xfer = row_count;

  -- Whatever is left is a workspace only this account is in. Boards, cards,
  -- comments, tags, images and the rest all cascade from the workspaces row.
  delete from workspaces w
   where w.created_by = p_user_id
     and not exists (select 1 from workspace_members m
                      where m.workspace_id = w.id and m.user_id <> p_user_id);
  get diagnostics v_del = row_count;

  return jsonb_build_object('workspaces_transferred', v_xfer,
                            'workspaces_deleted', v_del);
end;
$$;

-- Anon most of all: this takes an ARBITRARY user id and destroys that user's
-- workspaces, so a default grant here is a "delete anyone's work" endpoint.
revoke all on function public.prepare_account_deletion(uuid) from public;
revoke all on function public.prepare_account_deletion(uuid) from anon;
revoke all on function public.prepare_account_deletion(uuid) from authenticated;
grant execute on function public.prepare_account_deletion(uuid) to service_role;

commit;
