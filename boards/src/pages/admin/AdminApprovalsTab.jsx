// AdminApprovalsTab — the dedicated moderation queue for self-serve "Publish to
// Explore" requests (migrations 0169 + 0171). A board owner/editor submits their
// board from the Share modal; it lands here (invisible publicly) until an admin
// approves (publishes to /c/<slug> + /explore) or rejects with a reason.
//
// Supersedes the old AdminExploreSubmissions block that was buried inside the
// Discover tab and vanished when empty. Here it's a first-class tab with a
// pending-count badge in the nav (AdminPage), board preview before deciding, a
// polished reject dialog with canned reasons, and approved/rejected history.

import { useCallback, useEffect, useState } from 'react';
import { useFeedback } from '../../components/AppFeedback.jsx';
import { Inbox } from '../../lib/icons.js';
import { fmtDate } from '../../lib/adminFormat.js';
import { useAdminData } from './useAdminData.js';
import { AdminToolbar, AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { AdminBoardPreviewModal } from '../../components/AdminBoardPreviewModal.jsx';
import {
  adminListPublicBoardSubmissions, adminReviewPublicBoard,
  adminUnpublishBoard, adminPublicBoardSubmissionCounts, pingIndexNow,
} from '../../lib/boardsApi.js';

const SITE_ORIGIN = 'https://clusters.soleilpictures.com';

const FILTERS = [
  { id: 'pending',  label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'all',      label: 'All' },
];

// One-tap rejection reasons (shown to the submitter). Free text still allowed.
const REJECT_REASONS = [
  'Low quality',
  'Off-topic / spam',
  'Needs more original images',
  'Inappropriate content',
  'Duplicate of an existing page',
];

function statusChip(row) {
  if (row.published_at) return <span className="admin-status admin-status-accepted">Live</span>;
  switch (row.review_status) {
    case 'pending':  return <span className="admin-status admin-status-pending">Pending</span>;
    case 'rejected': return <span className="admin-status admin-status-rejected">Rejected</span>;
    case 'approved': return <span className="admin-status admin-status-canceled">Approved · offline</span>;
    default:         return <span className="admin-status admin-status-canceled">{row.review_status || '—'}</span>;
  }
}

export function AdminApprovalsTab({ onCountsChange }) {
  const feedback = useFeedback();
  const [filter, setFilter] = useState('pending');
  const [busyId, setBusyId] = useState(null);
  const [counts, setCounts] = useState({ pending: 0, approved: 0, rejected: 0 });
  const [preview, setPreview] = useState(null);   // { board_id, board_name, slug }

  const { data, loading, error, refreshing, lastUpdated, refresh } = useAdminData(
    () => adminListPublicBoardSubmissions(filter === 'all' ? null : filter),
    [filter],
  );
  const rows = Array.isArray(data) ? data : [];

  const refreshCounts = useCallback(() => {
    adminPublicBoardSubmissionCounts()
      .then((c) => { setCounts(c); try { onCountsChange?.(c); } catch (_) {} })
      .catch(() => {});
  }, [onCountsChange]);
  useEffect(() => { refreshCounts(); }, [refreshCounts]);

  const afterChange = () => { refresh(); refreshCounts(); };

  const review = async (row, approve) => {
    if (busyId) return;
    let reason = null;
    if (!approve) {
      reason = await feedback.prompt({
        title: 'Reject submission',
        message: `Don’t publish “${row.board_name || row.slug}” to Explore. Your reason is shown to the submitter.`,
        label: 'Reason (optional)',
        placeholder: 'e.g. Needs more original images',
        confirmLabel: 'Reject',
        suggestions: REJECT_REASONS,
      });
      if (reason === null) return;   // cancelled
    }
    setBusyId(row.board_id);
    try {
      const res = await adminReviewPublicBoard({ boardId: row.board_id, approve, reason });
      if (approve && res?.slug) { try { await pingIndexNow(res.slug); } catch (_) {} }
      feedback.toast({ type: 'success', message: approve ? `Published /c/${res?.slug}` : 'Submission rejected.' });
      afterChange();
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Review failed: ' + (e?.message || e) });
    } finally {
      setBusyId(null);
    }
  };

  const unpublish = async (row) => {
    if (busyId) return;
    const ok = await feedback.confirm({
      title: 'Unpublish board',
      message: `Remove /c/${row.slug} from Explore and de-index it? The slug stays reserved.`,
      confirmLabel: 'Unpublish',
      danger: true,
    });
    if (!ok) return;
    setBusyId(row.board_id);
    try {
      await adminUnpublishBoard(row.board_id);
      feedback.toast({ type: 'success', message: 'Unpublished.' });
      afterChange();
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Unpublish failed: ' + (e?.message || e) });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="admin-section">
      <section className="admin-chart-panel admin-chart-panel-wide">
        <header className="admin-chart-head">
          <h3 className="admin-chart-title">Public board requests</h3>
          <span className="admin-chart-sub t-meta">
            Users submit boards to go public via Share → “Publish to Explore”. Approving publishes them
            to <code>/c/&lt;slug&gt;</code> + the <code>/explore</code> index; rejecting tells the submitter why.
          </span>
        </header>

        <AdminToolbar onRefresh={afterChange} refreshing={refreshing} lastUpdated={lastUpdated}>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`admin-action ${filter === f.id ? 'admin-action-primary' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}{f.id !== 'all' && counts[f.id] != null ? ` (${counts[f.id]})` : ''}
            </button>
          ))}
        </AdminToolbar>

        <AdminAsync
          loading={loading}
          error={error}
          onRetry={refresh}
          skeleton={<AdminSkeleton variant="list" rows={4} />}
          isEmpty={rows.length === 0}
          empty={{
            icon: Inbox,
            title: filter === 'pending' ? 'No requests waiting' : 'Nothing here',
            body: filter === 'pending'
              ? 'When a user submits a board to Explore, it shows up here for review.'
              : 'No submissions match this filter yet.',
          }}
        >
          <div className={`admin-approvals-list ${refreshing ? 'is-refreshing' : ''}`}>
            {rows.map((r) => {
              const isLive = !!r.published_at;
              const busy = busyId === r.board_id;
              return (
                <div key={r.board_id} className="admin-approval-row">
                  <div className="admin-approval-main">
                    <div className="admin-approval-titleline">
                      <span className="admin-approval-name">{r.seo_title || r.board_name || 'Untitled board'}</span>
                      {statusChip(r)}
                    </div>
                    <div className="admin-approval-meta t-meta">
                      /c/{r.slug} · {r.image_count ?? '?'} images · {r.card_count ?? '?'} cards
                      {' · '}{r.submitter_email || 'unknown'}
                      {r.submitted_at ? ` · ${fmtDate(r.submitted_at)}` : ''}
                    </div>
                    {r.seo_description && <div className="admin-approval-desc">{r.seo_description}</div>}
                    {r.review_status === 'rejected' && r.review_reason && (
                      <div className="admin-approval-reason t-meta">Rejected: {r.review_reason}</div>
                    )}
                  </div>

                  <div className="admin-approval-actions">
                    <button type="button" className="admin-action" disabled={busy}
                            onClick={() => setPreview({ board_id: r.board_id, board_name: r.board_name, slug: r.slug })}>
                      Preview
                    </button>
                    {isLive && (
                      <a className="admin-action" href={`${SITE_ORIGIN}/c/${r.slug}`} target="_blank" rel="noopener noreferrer">
                        View ↗
                      </a>
                    )}
                    {!isLive && (
                      <button type="button" className="admin-action admin-action-primary" disabled={busy}
                              onClick={() => review(r, true)}>
                        {r.review_status === 'pending' ? 'Approve' : 'Publish'}
                      </button>
                    )}
                    {isLive ? (
                      <button type="button" className="admin-action admin-action-danger" disabled={busy}
                              onClick={() => unpublish(r)}>
                        Unpublish
                      </button>
                    ) : r.review_status !== 'rejected' ? (
                      <button type="button" className="admin-action admin-action-danger" disabled={busy}
                              onClick={() => review(r, false)}>
                        Reject
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </AdminAsync>
      </section>

      {preview && (
        <AdminBoardPreviewModal
          boardId={preview.board_id}
          boardName={preview.board_name}
          slug={preview.slug}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
