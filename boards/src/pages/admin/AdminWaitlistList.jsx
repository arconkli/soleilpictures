// AdminWaitlistList — left pane of the two-pane Waitlist tab.
//
// Controlled/presentational: a sticky toolbar (search + status + contacted
// filters), an optional bulk-action bar when rows are checked, a scrollable
// listbox of compact entry rows (checkbox · email · status · scheduled ·
// contacted badge), and pagination. The shell owns all state + handlers.

import { useEffect, useRef } from 'react';
import { Icon } from '../../components/Icon.jsx';
import { ArrowsClockwise, Inbox, Check, RotateCcw } from '../../lib/icons.js';
import { relativeTime } from '../../lib/adminFormat.js';
import { StatusPill } from './AdminPills.jsx';
import { AdminAsync, AdminSkeleton } from './AdminStates.jsx';

const STATUS = ['pending', 'accepted', 'rejected', 'canceled'];
const CONTACTED = [
  { value: '',    label: 'Contacted: all' },
  { value: 'no',  label: 'Not contacted' },
  { value: 'yes', label: 'Contacted' },
];

function EntryRow({ row, selected, checked, onSelect, onToggleCheck }) {
  return (
    <li
      id={`admin-wl-${row.id}`}
      role="option"
      aria-selected={selected}
      className={`admin-user-row ${selected ? 'is-selected' : ''}`}
      onClick={() => onSelect(row.id)}
    >
      <input
        type="checkbox"
        className="admin-wl-check"
        checked={checked}
        onChange={(e) => { e.stopPropagation(); onToggleCheck(row.id); }}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Select ${row.email}`}
      />
      <div className="admin-user-identity">
        <div className="admin-user-name" title={row.email}>{row.email}</div>
        <div className="admin-user-email">
          {row.scheduled_accept_at ? `scheduled ${relativeTime(row.scheduled_accept_at)}` : '—'}
        </div>
      </div>
      <div className="admin-user-badges">
        {row.outreach_count > 0 && (
          <span
            className="admin-badge-contacted"
            title={`Reached out ${row.outreach_count}×${row.last_reached_out_at ? ` · last ${relativeTime(row.last_reached_out_at)}` : ''}`}
          >
            contacted{row.outreach_count > 1 ? ` ·${row.outreach_count}` : ''}
          </span>
        )}
      </div>
      <div className="admin-user-meta">
        <StatusPill kind={row.status} />
      </div>
    </li>
  );
}

export function AdminWaitlistList({
  rows, total, loading, error, refreshing, lastUpdated,
  page, pageCount, firstIdx, lastIdx,
  query, onQueryChange,
  statusFilter, onStatusChange,
  contacted, onContactedChange,
  onPrevPage, onNextPage, onRefresh,
  selectedId, onSelect,
  selected, onToggleCheck, onToggleAllOnPage,
  busy, onBulkAccept, onBulkReject, onBulkReschedule, onBulkReopen,
  isFiltered,
}) {
  const listRef = useRef(null);

  useEffect(() => {
    if (!selectedId || !listRef.current) return;
    const el = listRef.current.querySelector(`#admin-wl-${CSS.escape(selectedId)}`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedId, rows]);

  const selCount = selected.size;
  const pageIds = rows.map((r) => r.id);
  const allOnPageChecked = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  return (
    <div className="admin-users-list">
      <div className="admin-users-list-toolbar">
        <input
          className="auth-input admin-search-input"
          type="text"
          placeholder="search email…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          aria-label="Search by email"
        />
        <div className="admin-users-list-filters">
          <select
            className="auth-input admin-filter-select"
            value={statusFilter}
            onChange={(e) => onStatusChange(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            className="auth-input admin-filter-select"
            value={contacted}
            onChange={(e) => onContactedChange(e.target.value)}
            aria-label="Filter by outreach status"
          >
            {CONTACTED.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
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
        </div>
        <div className="admin-users-list-count">
          {loading
            ? 'Loading…'
            : total === 0
              ? 'No matches'
              : `${firstIdx.toLocaleString()}–${lastIdx.toLocaleString()} of ${total.toLocaleString()}`}
        </div>
      </div>

      {selCount > 0 && (
        <div className="admin-wl-bulkbar">
          <label className="admin-wl-selall">
            <input type="checkbox" checked={allOnPageChecked} onChange={onToggleAllOnPage} aria-label="Select all on page" />
            <span>{selCount} selected</span>
          </label>
          <div className="admin-wl-bulk-actions">
            <button className="admin-action admin-action-primary" disabled={busy} onClick={onBulkAccept} title="Accept selected (pending only)">
              <Icon as={Check} size={13} /> Accept
            </button>
            <button className="admin-action" disabled={busy} onClick={() => onBulkReschedule({ days: 7 })} title="Push selected +7 days">+7d</button>
            <button className="admin-action" disabled={busy} onClick={onBulkReopen} title="Move selected back to pending">
              <Icon as={RotateCcw} size={13} /> Reopen
            </button>
            <button className="admin-action admin-action-danger" disabled={busy} onClick={onBulkReject} title="Reject selected (pending only)">Reject</button>
          </div>
        </div>
      )}

      <div className={`admin-users-scroll ${refreshing ? 'is-refreshing' : ''}`}>
        <AdminAsync
          loading={loading}
          error={error}
          onRetry={onRefresh}
          skeleton={<AdminSkeleton variant="list" rows={10} />}
          isEmpty={rows.length === 0}
          empty={{
            icon: Inbox,
            title: isFiltered ? 'No entries match these filters' : 'No waitlist entries yet',
            body: isFiltered ? 'Try a broader search or a different filter.' : 'New signups awaiting access will appear here.',
          }}
        >
          <ul
            ref={listRef}
            className="admin-userlist-rows"
            role="listbox"
            aria-label="Waitlist entries"
          >
            {rows.map((r) => (
              <EntryRow
                key={r.id}
                row={r}
                selected={r.id === selectedId}
                checked={selected.has(r.id)}
                onSelect={onSelect}
                onToggleCheck={onToggleCheck}
              />
            ))}
          </ul>
        </AdminAsync>
      </div>

      {pageCount > 1 && (
        <div className="admin-pagination">
          <button className="admin-action" disabled={page === 0 || refreshing} onClick={onPrevPage}>← Prev</button>
          <span className="admin-muted">Page {page + 1} of {pageCount}</span>
          <button className="admin-action" disabled={page >= pageCount - 1 || refreshing} onClick={onNextPage}>Next →</button>
        </div>
      )}
    </div>
  );
}
