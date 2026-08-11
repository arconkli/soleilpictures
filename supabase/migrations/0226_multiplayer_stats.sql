-- 0226 — admin_multiplayer_stats: measure MULTIPLAYER, not signups.
--
-- The Referrals panel could answer "how many people signed up from a shared
-- cluster" but had no card for "how many clusters have two humans in them",
-- which made the state of the collaboration loop easy to misread: the
-- "Shares driving signups" roll-up (0193) counts people who joined the
-- PRODUCT after landing on a /share link, and reads as if they had joined a
-- cluster. Those are different populations by an order of magnitude.
--
-- A sibling RPC rather than another CREATE OR REPLACE of admin_referral_stats:
-- that function has been rewritten four times (0164 → 0170 → 0185 → 0190) and
-- every rewrite has to reproduce the previous body verbatim. Nothing here
-- belongs inside it.
--
-- STATE vs FLOW. The multiplayer block is deliberately ALL-TIME: "does anyone
-- share a space with anyone" is a state of the world, and a 30-day window on
-- it answers a question nobody asked. The funnel block is windowed, because
-- those are events. Both are labelled as such in the payload so the UI can't
-- quietly present one as the other.
--
-- Definitions, stated exactly, because the loose ones are misleading:
--   • a workspace is multiplayer when ≥2 distinct people are members. Every
--     user is a member of their own workspace, so the bar is a SECOND member.
--   • a cluster is shared directly when a board_shares row names it. Counting
--     "clusters with two humans" by walking workspace membership inflates the
--     number badly — six multiplayer workspaces contain 86 clusters between
--     them, and reporting 86 would imply 86 acts of sharing that never happened.
--   • people_in_someone_elses_space counts humans holding access they did not
--     create: a board_shares grantee, or a member of a workspace someone else
--     created. Deduped across both.
--
-- Applied via Supabase MCP.

create or replace function public.admin_multiplayer_stats(
  p_days integer default 30,
  p_exclude_internal boolean default true
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_since timestamptz;
  v_out   jsonb;
begin
  perform public._require_admin();

  v_since := case
    when p_days is null or p_days <= 0 then null
    else now() - (p_days || ' days')::interval
  end;

  with internal as (
    select iu.user_id from public._internal_user_ids() iu
    where p_exclude_internal
  ),

  -- ── STATE (all-time) ───────────────────────────────────────────────────
  ws_member_counts as (
    select wm.workspace_id, count(distinct wm.user_id) as members
    from workspace_members wm
    where wm.user_id not in (select user_id from internal)
    group by 1
  ),
  -- Access somebody else granted you. board_shares is the explicit per-cluster
  -- grant; workspace_members minus the creator is the whole-workspace grant.
  borrowed_access as (
    select bs.user_id
    from board_shares bs
    where bs.user_id not in (select user_id from internal)
    union
    select wm.user_id
    from workspace_members wm
    join workspaces w on w.id = wm.workspace_id
    where wm.user_id is distinct from w.created_by
      and wm.user_id not in (select user_id from internal)
  ),
  state as (
    select
      (select count(*) from workspaces)                                             as workspaces_total,
      (select count(*) from ws_member_counts where members >= 2)                    as workspaces_multiplayer,
      (select count(distinct bs.board_id) from board_shares bs)                     as clusters_shared_directly,
      (select count(*) from boards where deleted_at is null)                        as clusters_total,
      (select count(*) from borrowed_access)                                        as people_in_someone_elses_space,
      (select count(distinct bs.invited_by) from board_shares bs
        where bs.invited_by is not null
          and bs.invited_by not in (select user_id from internal))                  as owners_who_granted_access,
      (select count(*) from board_shares bs where bs.via_link_token is not null)    as joins_via_invite_link
  ),

  -- ── FLOW (windowed) ────────────────────────────────────────────────────
  ev as (
    select e.event, e.user_id, e.session_id
    from analytics_events e
    where (v_since is null or e.occurred_at >= v_since)
      and (not p_exclude_internal
           or (e.user_id is null or e.user_id not in (select user_id from internal)))
  ),
  links as (
    select l.*
    from public_share_links l
    where (v_since is null or l.created_at >= v_since)
      and (not p_exclude_internal
           or l.created_by is null
           or l.created_by not in (select user_id from internal))
  ),
  flow as (
    select
      (select count(*) from links where kind = 'invite')                            as invite_links_created,
      (select count(*) from links where (kind || '') = 'view')                      as view_links_created,
      (select count(*) from ev where event = 'invite_link_view')                    as invite_link_views,
      (select count(*) from ev where event = 'invite_link_join_click')              as invite_link_join_clicks,
      (select count(*) from ev where event = 'invite_link_claimed')                 as invite_link_claimed,
      (select count(*) from ev where event = 'invite_link_claim_failed')            as invite_link_claim_failed,
      (select count(distinct user_id) from ev where event = 'share_open')           as opened_share_dialog,
      (select count(distinct user_id) from ev where event = 'share_link_copied')    as copied_a_link,
      (select count(distinct user_id) from ev where event = 'invite_sent')          as sent_an_email_invite,
      -- The denominator the share funnel never had: owners holding a cluster
      -- worth sending. All-time on purpose — a dormant owner is still someone
      -- who could share, and windowing this made the ratio meaningless.
      (select count(*) from (
         select b.created_by
         from boards b
         where b.deleted_at is null
           and b.created_by is not null
           and b.created_by not in (select user_id from internal)
         group by b.created_by
         having coalesce(sum(b.card_count), 0) >= 5
       ) o)                                                                          as owners_with_a_real_cluster
  )
  select jsonb_build_object(
    'window_days', p_days,
    'multiplayer_is_all_time', true,
    'multiplayer', jsonb_build_object(
      'workspaces_total',               s.workspaces_total,
      'workspaces_multiplayer',         s.workspaces_multiplayer,
      'clusters_total',                 s.clusters_total,
      'clusters_shared_directly',       s.clusters_shared_directly,
      'people_in_someone_elses_space',  s.people_in_someone_elses_space,
      'owners_who_granted_access',      s.owners_who_granted_access,
      'joins_via_invite_link',          s.joins_via_invite_link
    ),
    'funnel', jsonb_build_object(
      'owners_with_a_real_cluster', f.owners_with_a_real_cluster,
      'opened_share_dialog',        f.opened_share_dialog,
      'copied_a_link',              f.copied_a_link,
      'sent_an_email_invite',       f.sent_an_email_invite,
      'view_links_created',         f.view_links_created,
      'invite_links_created',       f.invite_links_created,
      'invite_link_views',          f.invite_link_views,
      'invite_link_join_clicks',    f.invite_link_join_clicks,
      'invite_link_claimed',        f.invite_link_claimed,
      'invite_link_claim_failed',   f.invite_link_claim_failed
    )
  )
  into v_out
  from state s cross join flow f;

  return v_out;
end;
$$;

revoke all on function public.admin_multiplayer_stats(integer, boolean) from public;
grant execute on function public.admin_multiplayer_stats(integer, boolean) to authenticated;
