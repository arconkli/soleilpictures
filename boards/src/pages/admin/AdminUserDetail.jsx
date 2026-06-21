// AdminUserDetail — the right pane of the two-pane Users tab.
//
// Header carries the identity, the *interactive* tier pills (lifted verbatim
// from the old table cell — the one part of the tab the user wanted kept), and
// the row-action menu. Below it, five sections fed by admin_user_detail:
// Acquisition · Activation · Engagement · Billing · Grants.
//
// This pane owns no mutation logic and does no fetching — the shell passes the
// detail payload + the five handlers. Header controls act on `selectedRow` (the
// list row, which already carries tier / subscription_* / banned), so they work
// the instant a row is picked, before the rich detail RPC resolves.

import { CopyableText } from '../../components/CopyableText.jsx';
import { Icon } from '../../components/Icon.jsx';
import {
  User as UsersIcon, GlobeIcon, Sparkle, Clock, Tag, Star,
} from '../../lib/icons.js';
import { formatDuration } from '../../lib/formatDuration.js';
import {
  formatCount, formatMoney, formatExpires, fmtDate, relativeTime,
} from '../../lib/adminFormat.js';
import { StatusPill } from './AdminPills.jsx';
import { AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { AdminUserRowMenu } from './AdminUserRowMenu.jsx';
import { Avatar, SourceBadge, PresenceDot, DetailSection, Timeline } from './AdminUserDetailParts.jsx';
import { OutreachSection } from './AdminOutreachSection.jsx';

const TIERS = ['admin', 'paid', 'demo', 'waitlist'];

function Row({ label, children }) {
  return (<><dt>{label}</dt><dd>{children}</dd></>);
}

// Long opaque click-ids / tokens are de-emphasized (muted) vs human-meaningful
// utm/referrer values.
const ACQ_ID_KEYS = new Set([
  'fbclid', 'gclid', 'wbraid', 'gbraid', 'msclkid', 'ttclid', 'twclid',
  'rdt_cid', 'li_fat_id', 'epik', 'sccid', 'share_token',
]);

function AcquisitionSection({ acq }) {
  if (!acq) return null;
  // First-touch detail — every signal the capture layer records, shown when present.
  const fields = [
    ['utm_source', acq.utm_source], ['utm_medium', acq.utm_medium],
    ['utm_campaign', acq.utm_campaign], ['utm_content', acq.utm_content],
    ['utm_term', acq.utm_term],
    ['referrer', acq.referrer], ['landing_path', acq.landing_path],
    ['gclid', acq.gclid], ['wbraid', acq.wbraid], ['gbraid', acq.gbraid],
    ['msclkid', acq.msclkid], ['ttclid', acq.ttclid], ['twclid', acq.twclid],
    ['rdt_cid', acq.rdt_cid], ['li_fat_id', acq.li_fat_id], ['epik', acq.epik],
    ['sccid', acq.sccid], ['fbclid', acq.fbclid],
    ['share_token', acq.share_token], ['public_slug', acq.public_slug],
  ].filter(([, v]) => v);
  // "Captured nothing" = nothing beyond the always-present landing_path.
  const meaningful = fields.filter(([k]) => k !== 'landing_path');
  // Last-touch (latest click) — only rendered when an lt_* event existed.
  const lt = acq.last_touch && typeof acq.last_touch === 'object' ? acq.last_touch : null;
  const ltFields = lt ? [
    ['utm_source', lt.utm_source], ['utm_medium', lt.utm_medium],
    ['utm_campaign', lt.utm_campaign], ['referrer', lt.referrer], ['at', lt.at],
  ].filter(([, v]) => v) : [];
  return (
    <DetailSection title="Acquisition" icon={GlobeIcon}>
      <dl className="admin-detail-kv">
        <Row label="Channel"><SourceBadge source={acq.label} /></Row>
        {fields.map(([k, v]) => (
          <Row key={k} label={k}><span className={ACQ_ID_KEYS.has(k) ? 'is-muted' : ''} style={{ overflowWrap: 'anywhere' }}>{v}</span></Row>
        ))}
      </dl>
      {meaningful.length === 0 && <div className="admin-detail-note">No campaign or referrer captured — organic / direct.</div>}
      {lt && (
        <>
          <div className="admin-detail-subhead">Latest click</div>
          <dl className="admin-detail-kv">
            <Row label="Channel"><SourceBadge source={lt.channel} /></Row>
            {ltFields.map(([k, v]) => (
              <Row key={k} label={k}>
                <span style={{ overflowWrap: 'anywhere' }}>{k === 'at' ? relativeTime(v) : v}</span>
              </Row>
            ))}
          </dl>
        </>
      )}
    </DetailSection>
  );
}

function EngagementSection({ eng, tier, lastSignInAt, device }) {
  if (!eng) return null;
  const last = device?.last;
  const others = Array.isArray(device?.breakdown) ? device.breakdown : [];
  return (
    <DetailSection title="Engagement" icon={Clock}>
      <dl className="admin-detail-kv">
        <Row label="Cards"><span className="is-strong">{formatCount(eng.card_count)}</span></Row>
        <Row label="Boards">{formatCount(eng.board_count)}</Row>
        <Row label="Time in app">{formatDuration(Number(eng.seconds_in_app || 0))}</Row>
        <Row label="Last active"><PresenceDot lastSeenAt={eng.last_seen_at} /></Row>
        {lastSignInAt && <Row label="Last sign-in">{relativeTime(lastSignInAt)}</Row>}
        {tier === 'demo' && (
          <Row label="Demo cards">{formatCount(eng.demo_card_count)} / {eng.demo_card_cap || 100}</Row>
        )}
        <Row label="Device">
          {last?.device_type ? (
            <>
              <span className="is-strong" style={{ textTransform: 'capitalize' }}>{last.device_type}</span>
              <span className="is-muted">{[last.os, last.browser].filter(Boolean).map((x) => ` · ${x}`).join('')}</span>
            </>
          ) : <span className="is-muted">No device data yet</span>}
        </Row>
        {others.length > 1 && (
          <Row label="Devices used">
            <span className="is-muted" style={{ textTransform: 'capitalize' }}>
              {others.map((b) => `${b.device_type} (${formatCount(b.events)})`).join(' · ')}
            </span>
          </Row>
        )}
      </dl>
    </DetailSection>
  );
}

function BillingSection({ billing }) {
  return (
    <DetailSection title="Billing" icon={Tag}>
      {!billing ? (
        <div className="admin-detail-note">No subscription on file.</div>
      ) : (
        <dl className="admin-detail-kv">
          <Row label="Plan">
            <span className="is-strong" style={{ textTransform: 'capitalize', marginRight: 8 }}>{billing.plan || 'sub'}</span>
            <StatusPill kind={billing.status} />
          </Row>
          <Row label="Amount">
            <span className="admin-detail-mrr">{billing.monthly_amount_cents != null ? `${formatMoney(billing.monthly_amount_cents)}/mo` : '—'}</span>
            {billing.trialing && <span className="admin-detail-flag is-trial">trial</span>}
            {billing.discounted && <span className="admin-detail-flag is-promo">promo</span>}
            {billing.cancel_at_period_end && <span className="admin-detail-flag is-cancel">cancels at period end</span>}
          </Row>
          <Row label={billing.cancel_at_period_end ? 'Ends' : 'Renews'}>{formatExpires(billing.current_period_end)}</Row>
          {billing.stripe_customer_id && (
            <Row label="Stripe"><CopyableText value={billing.stripe_customer_id} className="is-muted" /></Row>
          )}
        </dl>
      )}
    </DetailSection>
  );
}

function GrantsSection({ grants }) {
  const list = grants || [];
  return (
    <DetailSection title="Grants" icon={Star}>
      {list.length === 0 ? (
        <div className="admin-detail-note">No complimentary grants.</div>
      ) : (
        <div className="admin-detail-grants">
          {list.map((g, i) => (
            <div key={i} className={`admin-detail-grant ${g.revoked_at ? 'is-revoked' : ''}`}>
              <div className="admin-detail-grant-head">
                <StatusPill kind={g.status} />
                <span className="is-muted">{formatExpires(g.expires_at)}</span>
              </div>
              <div className="admin-detail-grant-meta">
                <span>granted by <b>{g.granted_by_email || '—'}</b></span>
                {g.granted_at && <span>{fmtDate(g.granted_at)}</span>}
                {g.revoked_at && <span>revoked {fmtDate(g.revoked_at)}</span>}
              </div>
              {g.note && <div className="admin-detail-grant-note">{g.note}</div>}
            </div>
          ))}
        </div>
      )}
    </DetailSection>
  );
}

export function AdminUserDetail({
  detail, loading, error, onRetry, refreshing,
  selectedRow, currentUserId, busyId,
  onChangeTier, onBan, onUnban, onResync, onDelete,
  onLogOutreach, onDeleteOutreach,
  isOpen, onClose,
}) {
  // Nothing selected → empty prompt (no fetch fires in the shell).
  if (!selectedRow) {
    return (
      <div className="admin-users-detail">
        <div className="admin-detail-empty">
          <span className="admin-detail-empty-icon"><Icon as={UsersIcon} size={26} /></span>
          <div className="admin-detail-empty-title">Select a user</div>
          <div className="admin-detail-empty-hint">
            Pick someone on the left to see their full profile — acquisition, activation, engagement, billing and grants.
          </div>
        </div>
      </div>
    );
  }

  const row = selectedRow;
  const isSelf = row.user_id === currentUserId;
  const busy = busyId === row.user_id;
  const name = row.display_name || (row.email || '').split('@')[0] || row.email;

  // useAdminData reports a same-user re-fetch as `refreshing`, not `loading`, and
  // a fresh user-switch also (since the hook already loaded once). Show the
  // skeleton whenever we don't yet have detail matching the selected row; once it
  // matches, a refresh just dims the body instead of blanking it.
  const hasMatch = !!detail && detail.user_id === row.user_id;
  const showSkeleton = (loading || refreshing) && !hasMatch;

  return (
    <div className={`admin-users-detail ${isOpen ? 'is-open' : ''}`}>
      <div className="admin-detail-header">
        <div className="admin-detail-id">
          <Avatar email={row.email} name={row.display_name} color={detail?.identity?.color || row.color} />
          <div className="admin-detail-idtext">
            <h3 className="admin-detail-name">{name}</h3>
            <div className="admin-detail-email"><CopyableText value={row.email} /></div>
          </div>
          <button type="button" className="admin-detail-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="admin-detail-controls">
          <div className="admin-tier-pill-group">
            {TIERS.map((t) => (
              <button
                key={t}
                className={`admin-tier-pill admin-tier-pill-${t} ${row.tier === t ? 'is-active' : ''}`}
                disabled={isSelf || busy}
                title={isSelf ? "Can't change your own tier" : row.tier === t ? `Already ${t}` : `Change to ${t}`}
                onClick={() => onChangeTier(row, t)}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="admin-detail-actions">
            {detail?.flags?.is_internal && <span className="admin-badge-promo" title="Seeded / internal account">internal</span>}
            {detail?.flags && detail.flags.verified === false && (
              <span
                className="admin-badge-ghost"
                title={detail.flags.email_confirmed === false ? 'Email not confirmed' : 'Never signed in'}
              >
                unverified
              </span>
            )}
            {row.banned && <span className="admin-detail-banned" title={detail?.identity?.banned_reason || 'Account suspended'}>banned</span>}
            <AdminUserRowMenu
              row={row}
              disabled={isSelf || busy}
              busy={busy}
              onBan={onBan}
              onUnban={onUnban}
              onResync={onResync}
              onDelete={onDelete}
            />
          </div>
        </div>
      </div>

      {hasMatch && error && (
        <button type="button" className="admin-detail-refresh-error" onClick={onRetry} title="Retry">
          Couldn’t refresh — showing last loaded data. Retry
        </button>
      )}

      <AdminAsync
        loading={showSkeleton}
        error={hasMatch ? null : error}
        onRetry={onRetry}
        skeleton={<div className="admin-detail-body"><AdminSkeleton variant="list" rows={12} /></div>}
      >
        <div className={`admin-detail-body ${refreshing ? 'is-refreshing' : ''}`}>
          <OutreachSection
            outreach={detail?.outreach}
            row={row}
            onLogOutreach={onLogOutreach}
            onDeleteOutreach={onDeleteOutreach}
          />
          <AcquisitionSection acq={detail?.acquisition} />
          <DetailSection title="Activation" icon={Sparkle}>
            <Timeline activation={detail?.activation} />
          </DetailSection>
          <EngagementSection eng={detail?.engagement} tier={detail?.identity?.tier || row.tier} lastSignInAt={row.last_sign_in_at} device={detail?.device} />
          <BillingSection billing={detail?.billing} />
          <GrantsSection grants={detail?.grants} />
        </div>
      </AdminAsync>
    </div>
  );
}
