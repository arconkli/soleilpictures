// AdminMultiplayerSection — how many clusters actually hold two humans, and
// the sharing funnel that would put them there.
//
// This panel exists because the Referrals panel next to it answers a
// DIFFERENT question and the two were easy to conflate. "Shares driving
// signups" (0193) counts people who signed up for the PRODUCT after landing
// on a /share link — a real and working loop. Joining a CLUSTER is a separate
// event, an order of magnitude rarer, and had no card anywhere in the admin.
//
// The funnel row is deliberately a chain of absolute counts rather than a
// stack of rates: at these volumes a percentage invites over-reading, and the
// interesting fact is usually which step is flatly zero.
//
// `data` shape (from admin_multiplayer_stats, migration 0226):
//   { window_days, multiplayer_is_all_time,
//     multiplayer: { workspaces_total, workspaces_multiplayer, clusters_total,
//                    clusters_shared_directly, people_in_someone_elses_space,
//                    owners_who_granted_access, joins_via_invite_link },
//     funnel: { owners_with_a_real_cluster, opened_share_dialog, copied_a_link,
//               sent_an_email_invite, view_links_created, invite_links_created,
//               invite_link_views, invite_link_join_clicks, invite_link_claimed,
//               invite_link_claim_failed } }

import { formatCount } from '../../../../lib/adminFormat.js';
import { AdminStatCard } from '../../AdminStatCard.jsx';
import { RateCell } from '../../SmallN.jsx';

export function AdminMultiplayerSection({ data, days = 30 }) {
  const d = data || null;
  const windowLabel = days > 0 ? `last ${days}d` : 'all time';

  if (!d) {
    return (
      <section className="admin-chart-panel admin-chart-panel-wide">
        <header className="admin-chart-head">
          <h3 className="admin-chart-title">Multiplayer</h3>
          <span className="admin-chart-sub t-meta">clusters with a second human · {windowLabel}</span>
        </header>
        <div className="admin-empty">Multiplayer stats unavailable.</div>
      </section>
    );
  }

  const m = d.multiplayer || {};
  const f = d.funnel || {};

  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Multiplayer</h3>
        <span className="admin-chart-sub t-meta">
          a second human INSIDE a cluster — not a signup from one · state is all-time, funnel is {windowLabel}
        </span>
      </header>

      <div className="admin-stat-grid">
        <AdminStatCard
          label="Shared clusters"
          value={formatCount(m.clusters_shared_directly)}
          sub={`of ${formatCount(m.clusters_total)} clusters`}
          title="Clusters named by a board_shares row — someone other than the owner has explicit access. Counting via workspace membership instead would inflate this badly: a handful of multiplayer workspaces contain dozens of clusters between them, implying acts of sharing that never happened."
          accent />
        <AdminStatCard
          label="People in someone else's space"
          value={formatCount(m.people_in_someone_elses_space)}
          sub="hold access they didn't create"
          title="Distinct humans who are either a board_shares grantee or a member of a workspace someone else created. Deduped across both. This is the headline multiplayer number." />
        <AdminStatCard
          label="Multiplayer workspaces"
          value={formatCount(m.workspaces_multiplayer)}
          sub={`of ${formatCount(m.workspaces_total)} workspaces`}
          title="Workspaces with 2+ distinct members. Everyone is a member of their own workspace, so the bar is a SECOND member." />
        <AdminStatCard
          label="Owners who granted access"
          value={formatCount(m.owners_who_granted_access)}
          sub="ever invited anyone"
          title="Distinct users named as board_shares.invited_by — the supply side of the loop." />
        <AdminStatCard
          label="Joins via invite link"
          value={formatCount(m.joins_via_invite_link)}
          sub="board_shares.via_link_token"
          title="Access granted through a claimable invite link (0189). The single binary health check on that path: it sat at zero from ship until the claim was fixed, while the links themselves were being created and clicked."
          accent />
      </div>

      <div className="admin-detail-subhead" style={{ marginTop: 18 }}>
        Sharing funnel · {windowLabel}
      </div>
      <div className="admin-stat-grid">
        <AdminStatCard
          label="Could share"
          value={formatCount(f.owners_with_a_real_cluster)}
          sub="own a cluster with 5+ cards"
          title="ALL-TIME denominator, on purpose: a dormant owner is still someone who could share, and windowing this makes the ratio below meaningless." />
        <AdminStatCard
          label="Opened Share"
          value={formatCount(f.opened_share_dialog)}
          sub={<>of those who could · <RateCell numer={f.opened_share_dialog} denom={f.owners_with_a_real_cluster} /></>}
          title="Distinct users who opened the share surface by any route (toolbar, ⌘K, sidebar context menu, nudge CTA). Historically the narrowest step by far — the dialog converts well once reached." />
        <AdminStatCard
          label="Copied a link"
          value={formatCount(f.copied_a_link)}
          sub="put one on the clipboard"
          title="Distinct users who actually copied a link. Dark before the share_link_copied event existed — every copy made inside the modal was invisible, so this reads 0 for any window predating it." />
        <AdminStatCard
          label="Links created"
          value={formatCount(f.view_links_created)}
          sub={`${formatCount(f.invite_links_created)} invite · ${formatCount(f.sent_an_email_invite)} emailed`}
          title="View-only links minted, with claimable invite links and distinct email-inviting users alongside." />
      </div>

      <div className="admin-detail-subhead" style={{ marginTop: 18 }}>
        Invite link: view → click → join · {windowLabel}
      </div>
      <div className="admin-stat-grid">
        <AdminStatCard
          label="Link previews"
          value={formatCount(f.invite_link_views)}
          sub="join card rendered" />
        <AdminStatCard
          label="Join clicked"
          value={formatCount(f.invite_link_join_clicks)}
          sub={<>of previews · <RateCell numer={f.invite_link_join_clicks} denom={f.invite_link_views} /></>} />
        <AdminStatCard
          label="Joined"
          value={formatCount(f.invite_link_claimed)}
          sub={<>of clicks · <RateCell numer={f.invite_link_claimed} denom={f.invite_link_join_clicks} /></>}
          title="Server-fired invite_link_claimed. Note this fires only on the fresh-join branch — 'upgraded', 'already' and 'noop' claims return early and are counted by invite_link_claim_result instead."
          accent />
        <AdminStatCard
          label="Claim errors"
          value={formatCount(f.invite_link_claim_failed)}
          sub="raised after sign-in"
          title="claim_collab_link raised. Any sustained non-zero here means the join path is broken again — it previously ran at 100% on a Postgres ambiguity error, fixed in 0199." />
      </div>
    </section>
  );
}
