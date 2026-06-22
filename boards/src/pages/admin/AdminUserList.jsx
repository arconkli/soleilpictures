// AdminUserList — the left pane of the two-pane Users tab.
//
// A controlled, presentational rail: search + tier/sort filters in a sticky
// header, a scrollable listbox of compact user rows (avatar · name/email ·
// source badge · tier dot · last-seen presence), and pagination pinned to the
// bottom. The shell (AdminUsersTab) owns all state and selection; this just
// renders and reports clicks / roving-keyboard moves via onSelect.

import { useEffect, useRef } from 'react';
import { Icon } from '../../components/Icon.jsx';
import { ArrowsClockwise, User as UsersIcon } from '../../lib/icons.js';
import { relativeTime, formatBytes, formatCount } from '../../lib/adminFormat.js';
import { AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { Avatar, SourceBadge, PresenceDot, channelLabel } from './AdminUserDetailParts.jsx';

const TIERS = ['admin', 'paid', 'demo', 'waitlist'];
const SORTS = [
  { value: 'recent', label: 'Newest' },
  { value: 'active', label: 'Last active' },
  { value: 'cards',  label: 'Most cards' },
  { value: 'spend',  label: 'Top spend' },
  { value: 'name',   label: 'Name A–Z' },
];
const CONTACTED = [
  { value: '',    label: 'Contacted: all' },
  { value: 'no',  label: 'Not contacted' },
  { value: 'yes', label: 'Contacted' },
];
const VERIFICATION = [
  { value: 'verified',   label: 'Verified' },
  { value: 'unverified', label: 'Unverified' },
  { value: 'all',        label: 'All users' },
];

function UserListRow({ row, selected, isSelf, onSelect }) {
  const ghost = row.tier === 'waitlist' && !row.joined_waitlist;
  // Unverified = email not confirmed OR never signed in. email_confirmed is the
  // new column from admin_list_users; last_sign_in_at was already returned.
  const unverified = row.email_confirmed === false || !row.last_sign_in_at;
  const unverifiedReason = row.email_confirmed === false ? 'Email not confirmed' : 'Never signed in';
  const name = row.display_name || (row.email || '').split('@')[0] || row.email;
  // Usage at a glance: paid/admin live on storage; free tiers live on the
  // card cap. Show whichever matters for the tier.
  const paid = row.tier === 'paid' || row.tier === 'admin';
  const usageText = paid ? formatBytes(row.storage_bytes || 0) : `${formatCount(row.card_count || 0)} cards`;
  const usageTitle = paid ? 'Storage used' : 'Cards created';
  return (
    <li
      id={`admin-user-${row.user_id}`}
      role="option"
      aria-selected={selected}
      className={`admin-user-row ${selected ? 'is-selected' : ''}`}
      onClick={() => onSelect(row.user_id)}
    >
      <Avatar email={row.email} name={row.display_name} color={row.color} />
      <div className="admin-user-identity">
        <div className="admin-user-name">{name}</div>
        <div className="admin-user-email" title={row.email}>{row.email}</div>
      </div>
      <div className="admin-user-badges">
        <SourceBadge source={row.acquisition_source} />
        {isSelf && <span className="admin-muted admin-user-you">you</span>}
        {row.outreach_count > 0 && (
          <span
            className="admin-badge-contacted"
            title={`Reached out ${row.outreach_count}×${row.last_reached_out_at ? ` · last ${relativeTime(row.last_reached_out_at)}` : ''}`}
          >
            contacted{row.outreach_count > 1 ? ` ·${row.outreach_count}` : ''}
          </span>
        )}
        {row.banned && <span className="admin-badge-banned" title="Account suspended">banned</span>}
        {unverified && <span className="admin-badge-ghost" title={unverifiedReason}>unverified</span>}
        {ghost && <span className="admin-badge-ghost" title="Signed up but never joined the waitlist">ghost</span>}
      </div>
      <div className="admin-user-meta">
        <span className="admin-muted" style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11 }} title={usageTitle}>
          {usageText}
        </span>
        <span className={`admin-user-tierdot tier-${TIERS.includes(row.tier) ? row.tier : 'demo'}`} title={`Tier: ${row.tier}`}>
          {row.tier}
        </span>
        <PresenceDot lastSeenAt={row.last_seen_at} className="admin-user-lastseen" />
      </div>
    </li>
  );
}

export function AdminUserList({
  rows, total, loading, error, refreshing, lastUpdated,
  page, pageCount, firstIdx, lastIdx,
  query, onQueryChange,
  tierFilter, onTierFilterChange,
  contacted, onContactedChange,
  verification, onVerificationChange,
  sourceFilter, onSourceFilterChange, sourceOptions = [],
  sort, onSortChange,
  onPrevPage, onNextPage, onRefresh,
  selectedUserId, onSelect, currentUserId, isFiltered,
}) {
  const listRef = useRef(null);

  // Keep the selected row in view as arrow-keys move it.
  useEffect(() => {
    if (!selectedUserId || !listRef.current) return;
    const el = listRef.current.querySelector(`#admin-user-${CSS.escape(selectedUserId)}`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedUserId, rows]);

  const onKeyDown = (e) => {
    if (!rows.length) return;
    const idx = rows.findIndex((r) => r.user_id === selectedUserId);
    let next = null;
    if (e.key === 'ArrowDown')      next = idx < 0 ? 0 : Math.min(rows.length - 1, idx + 1);
    else if (e.key === 'ArrowUp')   next = idx < 0 ? rows.length - 1 : Math.max(0, idx - 1);
    else if (e.key === 'Home')      next = 0;
    else if (e.key === 'End')       next = rows.length - 1;
    else return;
    e.preventDefault();
    onSelect(rows[next].user_id);
  };

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
            value={tierFilter}
            onChange={(e) => onTierFilterChange(e.target.value)}
            aria-label="Filter by tier"
          >
            <option value="">All tiers</option>
            {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select
            className="auth-input admin-filter-select"
            value={verification}
            onChange={(e) => onVerificationChange(e.target.value)}
            aria-label="Filter by verification status"
            title="Verified = email confirmed + signed in at least once"
          >
            {VERIFICATION.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
          </select>
          <select
            className="auth-input admin-filter-select"
            value={sourceFilter || ''}
            onChange={(e) => onSourceFilterChange(e.target.value)}
            aria-label="Filter by acquisition channel"
            title="Where the user came from"
          >
            <option value="">All sources</option>
            {sourceOptions.map((o) => (
              <option key={o.channel} value={o.channel}>
                {channelLabel(o.channel)}{o.n != null ? ` (${o.n})` : ''}
              </option>
            ))}
          </select>
          <select
            className="auth-input admin-filter-select"
            value={contacted}
            onChange={(e) => onContactedChange(e.target.value)}
            aria-label="Filter by outreach status"
          >
            {CONTACTED.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <select
            className="auth-input admin-filter-select"
            value={sort}
            onChange={(e) => onSortChange(e.target.value)}
            aria-label="Sort users"
          >
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
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

      <div className={`admin-users-scroll ${refreshing ? 'is-refreshing' : ''}`}>
        <AdminAsync
          loading={loading}
          error={error}
          onRetry={onRefresh}
          skeleton={<AdminSkeleton variant="list" rows={10} />}
          isEmpty={rows.length === 0}
          empty={{
            icon: UsersIcon,
            title: 'No users match these filters',
            body: isFiltered ? 'Try a broader search or a different tier.' : 'Users will appear here as they sign up.',
          }}
        >
          <ul
            ref={listRef}
            className="admin-userlist-rows"
            role="listbox"
            aria-label="Users"
            tabIndex={0}
            aria-activedescendant={selectedUserId ? `admin-user-${selectedUserId}` : undefined}
            onKeyDown={onKeyDown}
          >
            {rows.map((r) => (
              <UserListRow
                key={r.user_id}
                row={r}
                selected={r.user_id === selectedUserId}
                isSelf={r.user_id === currentUserId}
                onSelect={onSelect}
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
