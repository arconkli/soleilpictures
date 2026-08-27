// AdminTemplatesTab — moderation for the public grid-template gallery
// (migration 0266).
//
// Unlike AdminApprovalsTab, which is a REVIEW QUEUE, this is a TAKEDOWN
// SURFACE: templates publish immediately and this is where one gets pulled. The
// reason that asymmetry is defensible is what a template actually contains — a
// fraction tree, about a kilobyte of geometry. There are no images, no cell
// content and nothing from the board it came from, so the only author-written
// strings that reach a public page are the name, title and description. That is
// a small enough surface to police after the fact.
//
// Structure is otherwise the sibling of AdminApprovalsTab: useAdminData for the
// epoch-guarded fetch, AdminToolbar/AdminAsync for the shell.

import { useCallback, useState } from 'react';
import { useFeedback } from '../../components/AppFeedback.jsx';
import { Inbox } from '../../lib/icons.js';
import { fmtDate } from '../../lib/adminFormat.js';
import { useAdminData } from './useAdminData.js';
import { AdminToolbar, AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { GridLayoutThumb } from '../../components/GridLayoutThumb.jsx';
import { sanitizeLayout } from '../../lib/gridLayout.js';
import {
  adminListGridLayouts, adminTakeDownGridLayout, adminRestoreGridLayout,
} from '../../lib/boardsApi.js';

const SITE_ORIGIN = 'https://clusters.soleilpictures.com';

const FILTERS = [
  { id: 'published',  label: 'Live' },
  { id: 'taken_down', label: 'Taken down' },
  { id: 'all',        label: 'All' },
];

// Free text is still allowed; these just make the common calls one tap.
const TAKEDOWN_REASONS = [
  'Inappropriate name or description',
  'Spam',
  'Duplicate of an existing template',
  'Low quality / not a usable layout',
];

export function AdminTemplatesTab() {
  const feedback = useFeedback();
  const [filter, setFilter] = useState('published');
  const [busyId, setBusyId] = useState(null);

  const { data, loading, error, refreshing, lastUpdated, refresh } = useAdminData(
    () => adminListGridLayouts(filter === 'all' ? null : filter),
    [filter],
  );
  const rows = Array.isArray(data) ? data : [];

  const takeDown = useCallback(async (row) => {
    const reason = await feedback.prompt({
      title: `Take down “${row.title}”?`,
      label: 'Reason (recorded, not shown publicly)',
      placeholder: 'Why is this coming down?',
      confirmLabel: 'Take down',
      suggestions: TAKEDOWN_REASONS,
    });
    if (reason === null || reason === undefined) return;
    setBusyId(row.layout_id);
    try {
      await adminTakeDownGridLayout(row.layout_id, reason);
      // The author keeps their copy — takedown only clears published_at. So do
      // everyone who already used it: use_public_grid_layout COPIES rather than
      // granting access, which is what stops a takedown reaching into libraries.
      feedback.toast({ message: 'Taken down. The author keeps their own copy.' });
      refresh();
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Could not take down: ' + (e.message || e) });
    } finally { setBusyId(null); }
  }, [feedback, refresh]);

  const restore = useCallback(async (row) => {
    setBusyId(row.layout_id);
    try {
      await adminRestoreGridLayout(row.layout_id);
      feedback.toast({ message: 'Back in the gallery.' });
      refresh();
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Could not restore: ' + (e.message || e) });
    } finally { setBusyId(null); }
  }, [feedback, refresh]);

  return (
    <section className="admin-card">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Public grid templates</h3>
        <span className="admin-chart-sub t-meta">
          Templates publish immediately — this is a takedown surface, not a queue. A template is
          layout geometry only, so the only author-written text on a public page is its name and
          description. Live ones appear at <code>/templates</code>.
        </span>
      </header>

      <AdminToolbar onRefresh={refresh} refreshing={refreshing} lastUpdated={lastUpdated}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`admin-action ${filter === f.id ? 'admin-action-primary' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
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
          title: filter === 'published' ? 'No published templates yet' : 'Nothing here',
          body: filter === 'published'
            ? 'When someone publishes a grid template, it appears here and at /templates.'
            : 'No templates match this filter.',
        }}
      >
        <div className={`admin-approvals-list ${refreshing ? 'is-refreshing' : ''}`}>
          {rows.map((r) => {
            const live = !!r.published_at;
            const busy = busyId === r.layout_id;
            const tree = sanitizeLayout(r.body?.layout);
            return (
              <div key={r.layout_id} className="admin-approval-row">
                {tree && (
                  <div className="admin-tpl-thumb" aria-hidden="true">
                    <GridLayoutThumb tree={tree} title={r.title} />
                  </div>
                )}
                <div className="admin-approval-main">
                  <div className="admin-approval-titleline">
                    <span className="admin-approval-name">{r.title || r.name || 'Untitled'}</span>
                    {live
                      ? <span className="admin-status admin-status-accepted">Live</span>
                      : <span className="admin-status admin-status-rejected">Taken down</span>}
                  </div>
                  <div className="admin-approval-meta t-meta">
                    /templates · {r.use_count ?? 0} {r.use_count === 1 ? 'use' : 'uses'}
                    {r.published_at ? ` · published ${fmtDate(r.published_at)}` : ''}
                    {r.taken_down_at ? ` · down ${fmtDate(r.taken_down_at)}` : ''}
                  </div>
                  {r.description && <div className="admin-approval-desc">{r.description}</div>}
                  {r.review_reason && <div className="admin-approval-desc t-meta">Reason: {r.review_reason}</div>}
                </div>
                <div className="admin-approval-actions">
                  <a className="admin-action" href={`${SITE_ORIGIN}/templates`} target="_blank" rel="noopener noreferrer">
                    View gallery
                  </a>
                  {live
                    ? <button type="button" className="admin-action admin-action-danger" disabled={busy} onClick={() => takeDown(r)}>
                        {busy ? '…' : 'Take down'}
                      </button>
                    : <button type="button" className="admin-action admin-action-primary" disabled={busy} onClick={() => restore(r)}>
                        {busy ? '…' : 'Restore'}
                      </button>}
                </div>
              </div>
            );
          })}
        </div>
      </AdminAsync>
    </section>
  );
}
