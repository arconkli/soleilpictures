// Shared async-state primitives for the admin tabs: one loading
// affordance (layout-stable skeletons), one error surface (with Retry),
// one empty surface (the app's EmptyState) — so every tab loads, fails,
// and empties the same way. The cardinal rule: empty is only shown when
// !loading && !error, so a fetch failure never masquerades as "no data".

import { Icon } from '../../components/Icon.jsx';
import { EmptyState } from '../../components/EmptyState.jsx';
import { relativeTime, fmtDateTime } from '../../lib/adminFormat.js';
import { ArrowsClockwise, Warning, Inbox } from '../../lib/icons.js';

// ── Skeleton ─────────────────────────────────────────────────────────
// variant: 'table' | 'cards' | 'chart' | 'list'
export function AdminSkeleton({ variant = 'table', rows = 6, cols = 5 }) {
  if (variant === 'cards') {
    return (
      <div className="admin-stat-grid" aria-busy="true" aria-hidden="true">
        {Array.from({ length: rows || 4 }).map((_, i) => (
          <div key={i} className="admin-stat-card">
            <div className="admin-skeleton admin-skeleton-line" style={{ width: '40%', height: 10 }} />
            <div className="admin-skeleton admin-skeleton-line" style={{ width: '70%', height: 26, marginTop: 10 }} />
            <div className="admin-skeleton admin-skeleton-line" style={{ width: '55%', height: 9, marginTop: 10 }} />
          </div>
        ))}
      </div>
    );
  }
  if (variant === 'chart') {
    return (
      <div className="admin-skeleton admin-skeleton-block" aria-busy="true" aria-hidden="true"
           style={{ height: 240, borderRadius: 'var(--radius-lg)' }} />
    );
  }
  if (variant === 'list') {
    return (
      <div className="admin-skeleton-list" aria-busy="true" aria-hidden="true">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="admin-skeleton admin-skeleton-line" style={{ height: 18, margin: '10px 0' }} />
        ))}
      </div>
    );
  }
  // table
  return (
    <div className="admin-skeleton-table" aria-busy="true" aria-hidden="true">
      <div className="admin-skeleton-row admin-skeleton-row-head">
        {Array.from({ length: cols }).map((_, c) => (
          <div key={c} className="admin-skeleton admin-skeleton-line" style={{ height: 10, width: `${40 + (c % 3) * 20}%` }} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="admin-skeleton-row">
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="admin-skeleton admin-skeleton-line" style={{ height: 14, width: `${50 + ((r + c) % 4) * 12}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Error, with Retry ────────────────────────────────────────────────
export function AdminError({ error, onRetry }) {
  return (
    <div className="admin-error" role="alert">
      <Icon as={Warning} size={28} className="admin-error-icon" />
      <div className="admin-error-body">
        <div className="admin-error-title">Couldn’t load this data</div>
        <div className="admin-error-detail t-meta">{error || 'Something went wrong.'}</div>
      </div>
      {onRetry && (
        <button type="button" className="admin-action" onClick={onRetry}>
          <Icon as={ArrowsClockwise} size={14} /> Retry
        </button>
      )}
    </div>
  );
}

// ── Toolbar: filters on the left, Refresh + "updated …" on the right ──
export function AdminToolbar({ onRefresh, refreshing, lastUpdated, children }) {
  return (
    <div className="admin-toolbar">
      <div className="admin-toolbar-left">{children}</div>
      <div className="admin-toolbar-right">
        {lastUpdated != null && (
          <span className="admin-toolbar-updated t-meta" title={fmtDateTime(lastUpdated)}>
            updated {relativeTime(lastUpdated)}
          </span>
        )}
        {onRefresh && (
          <button
            type="button"
            className="admin-action admin-refresh"
            onClick={onRefresh}
            disabled={refreshing}
            title="Refresh"
            aria-label="Refresh"
          >
            <Icon as={ArrowsClockwise} size={14} className={refreshing ? 'admin-spin' : ''} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Async boundary ───────────────────────────────────────────────────
// Renders skeleton → error(+retry) → empty → children, guaranteeing the
// three states are mutually exclusive and empty never shadows an error.
//   <AdminAsync loading={loading} error={error} onRetry={refresh}
//               skeleton={<AdminSkeleton variant="table" />}
//               isEmpty={rows.length === 0}
//               empty={{ icon: Inbox, title: 'Nothing yet', body: '…' }}>
//     …content…
//   </AdminAsync>
export function AdminAsync({
  loading, error, onRetry, skeleton,
  isEmpty = false, empty,
  children,
}) {
  if (loading) return skeleton || <AdminSkeleton />;
  if (error)   return <AdminError error={error} onRetry={onRetry} />;
  if (isEmpty) {
    return (
      <EmptyState
        icon={empty?.icon || Inbox}
        title={empty?.title || 'Nothing here yet'}
        body={empty?.body}
        action={empty?.action}
      />
    );
  }
  return children;
}
