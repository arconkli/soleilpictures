// Small presentational pieces shared by the Users tab's two panes
// (AdminUserList + AdminUserDetail). Each is dumb and reused ≥2×:
//
//   • Avatar       — initials chip tinted from profiles.color (list rows + detail header)
//   • SourceBadge  — quiet acquisition-source pill (list rows + Acquisition section)
//   • PresenceDot  — glowing live/idle/offline dot from last_seen_at (list + Engagement)
//   • DetailSection — frosted section block with an uppercase label (detail panel ×5)
//   • Timeline     — stepped activation milestones (Activation section)

import { Icon } from '../../components/Icon.jsx';
import { relativeTime, fmtDate, fmtDateTime } from '../../lib/adminFormat.js';

// ── Avatar / initials chip ───────────────────────────────────────────
// Tints the ring/background from the user's chosen color (profiles.color)
// via an inline --avatar custom prop the CSS reads with color-mix.
export function Avatar({ email, name, color, size, className = '' }) {
  const base = (name || email || '?').trim();
  const initials = base
    .replace(/@.*$/, '')                 // drop email domain
    .split(/[.\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join('')
    .toUpperCase() || base[0]?.toUpperCase() || '?';
  const style = { '--avatar': color || '#888890' };
  if (size) { style.width = size; style.height = size; }
  return (
    <span className={`admin-user-avatar ${className}`} style={style} aria-hidden="true">
      {initials}
    </span>
  );
}

// ── Source badge ─────────────────────────────────────────────────────
// Renders the unified acquisition channel token (from the SQL
// public.derive_acquisition_channel) as a quiet, brand-tinted pill. The token
// space is fixed — paid networks (*_ads / meta_paid), organic social, search,
// share links, public boards, direct — plus a verbatim pass-through for any
// unknown utm_source / referrer word, shown as a generic Referral pill. The row
// badge AND the detail "Channel" row both use this, so they always agree.
const titleCase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// token → { variant (CSS color class) · display · glyph|dot }. The `· paid`
// suffix marks ad-click / paid-utm channels so the admin can tell paid from
// organic at a glance.
const CHANNEL_META = {
  google_ads:    { variant: 'google',    display: 'Google · paid', glyph: 'G' },
  google:        { variant: 'search',    display: 'Google',        dot: true },
  bing_ads:      { variant: 'bing',      display: 'Bing · paid',   glyph: 'b' },
  bing:          { variant: 'search',    display: 'Bing',          dot: true },
  duckduckgo:    { variant: 'search',    display: 'DuckDuckGo',    dot: true },
  yahoo:         { variant: 'search',    display: 'Yahoo',         dot: true },
  search:        { variant: 'search',    display: 'Search',        dot: true },
  meta_paid:     { variant: 'facebook',  display: 'Meta · paid',   glyph: 'f' },
  meta_organic:  { variant: 'facebook',  display: 'Meta',          glyph: 'f' },
  tiktok_ads:    { variant: 'tiktok',    display: 'TikTok · paid', glyph: '♪' },
  tiktok:        { variant: 'tiktok',    display: 'TikTok',        glyph: '♪' },
  x_ads:         { variant: 'twitter',   display: 'X · paid',      glyph: 'X' },
  x:             { variant: 'twitter',   display: 'X',             glyph: 'X' },
  reddit_ads:    { variant: 'reddit',    display: 'Reddit · paid', glyph: 'r' },
  reddit:        { variant: 'reddit',    display: 'Reddit',        glyph: 'r' },
  linkedin_ads:  { variant: 'linkedin',  display: 'LinkedIn · paid', glyph: 'in' },
  linkedin:      { variant: 'linkedin',  display: 'LinkedIn',      glyph: 'in' },
  pinterest_ads: { variant: 'pinterest', display: 'Pinterest · paid', glyph: 'P' },
  pinterest:     { variant: 'pinterest', display: 'Pinterest',     glyph: 'P' },
  snapchat_ads:  { variant: 'snapchat',  display: 'Snapchat · paid', glyph: 'S' },
  snapchat:      { variant: 'snapchat',  display: 'Snapchat',      glyph: 'S' },
  youtube:       { variant: 'youtube',   display: 'YouTube',       glyph: '▶' },
  share_link:    { variant: 'share',     display: 'Share link',    dot: true },
  public_board:  { variant: 'public',    display: 'Public board',  dot: true },
  direct:        { variant: 'direct',    display: 'Direct',        dot: true },
};

function sourceVariant(label) {
  const token = String(label || 'direct').toLowerCase().trim();
  if (CHANNEL_META[token]) return CHANNEL_META[token];
  if (!token || token === 'direct') return CHANNEL_META.direct;
  // Unknown but explicitly-tagged source (an off-list utm_source, or a referrer
  // domain word like 'producthunt'): show it verbatim so granularity isn't lost.
  return { variant: 'referral', display: titleCase(token), dot: true };
}

export function SourceBadge({ source, title }) {
  const { variant, display, glyph, dot } = sourceVariant(source);
  return (
    <span className={`admin-src-badge src-${variant}`} title={title || `Acquisition channel: ${source || 'direct'}`}>
      {glyph ? <span className="admin-src-glyph">{glyph}</span> : <span className="admin-src-dot" />}
      <span className="admin-src-label">{display}</span>
    </span>
  );
}

// Pretty label for a channel token — used by the Users-list source dropdown so
// its option text matches the badge wording. Unknown tokens title-case verbatim.
export function channelLabel(token) {
  const t = String(token || '').toLowerCase().trim();
  return CHANNEL_META[t]?.display || (t ? titleCase(t) : 'Direct');
}

// ── Presence dot ─────────────────────────────────────────────────────
// live ≤2m · idle ≤30m · offline otherwise (or never seen). Shows the
// relative last-seen next to the dot.
export function presenceState(lastSeenAt) {
  if (!lastSeenAt) return 'offline';
  const ms = Date.now() - new Date(lastSeenAt).getTime();
  if (!Number.isFinite(ms)) return 'offline';
  if (ms <= 2 * 60 * 1000) return 'live';
  if (ms <= 30 * 60 * 1000) return 'idle';
  return 'offline';
}

export function PresenceDot({ lastSeenAt, showLabel = true, className = '' }) {
  const state = presenceState(lastSeenAt);
  const label = lastSeenAt ? relativeTime(lastSeenAt) : 'never';
  return (
    <span className={`admin-presence is-${state} ${className}`} title={lastSeenAt ? fmtDateTime(lastSeenAt) : 'Never seen'}>
      {showLabel && label}
    </span>
  );
}

// ── Detail section block ─────────────────────────────────────────────
export function DetailSection({ title, icon, action, children }) {
  return (
    <section className="admin-detail-section">
      <header className="admin-detail-section-label">
        {icon && <Icon as={icon} size={13} />}
        {title}
        {action}
      </header>
      {children}
    </section>
  );
}

// ── Activation timeline ──────────────────────────────────────────────
// Five canonical steps; each reached step shows its date, pending shows "—".
const TIMELINE_STEPS = [
  { key: 'signed_up',   label: 'Signup' },
  { key: 'first_board', label: 'Board'  },
  { key: 'first_card',  label: 'Card'   },
  { key: 'first_share', label: 'Share'  },
  { key: 'first_paid',  label: 'Paid'   },
];

export function Timeline({ activation }) {
  // activation.milestones is [{key, at}] (only fired ones); fall back to the
  // raw first_*_at fields if milestones is absent.
  const at = (key) => {
    const m = (activation?.milestones || []).find((x) => x.key === key);
    if (m) return m.at;
    if (key === 'signed_up') return activation?.created_at || null;
    return activation?.[`${key}_at`] || null;
  };
  return (
    <ol className="admin-timeline">
      {TIMELINE_STEPS.map((step) => {
        const when = at(step.key);
        const reached = !!when;
        const cls = `admin-timeline-step ${reached ? 'is-reached' : 'is-pending'} ${step.key === 'first_paid' && reached ? 'is-paid' : ''}`;
        return (
          <li key={step.key} className={cls} title={reached ? fmtDateTime(when) : `${step.label}: not yet`}>
            <span className="admin-timeline-node" />
            <span className="admin-timeline-label">{step.label}</span>
            <span className="admin-timeline-date">{reached ? fmtDate(when) : '—'}</span>
          </li>
        );
      })}
    </ol>
  );
}
