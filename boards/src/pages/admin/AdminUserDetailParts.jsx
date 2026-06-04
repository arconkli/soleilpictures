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
// Maps the derived acquisition_source label → a quiet pill variant.
//   'facebook'/'instagram'  → Meta (fbclid)
//   utm/host containing google|bing|duckduckgo|search → Search
//   'twitter'/x.com/t.co    → Twitter
//   'direct'                → Direct
//   anything else (host / utm_source) → Referral, showing the raw label
const titleCase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function sourceVariant(label) {
  const raw = String(label || 'direct').toLowerCase().trim();
  if (!raw || raw === 'direct') return { variant: 'direct', display: 'Direct', dot: true };
  // Reduce a referrer host to its domain word (reddit.com → reddit,
  // old.reddit.com → reddit, t.co → t) before brand-matching; plain utm_source
  // words pass through unchanged. Matching whole tokens — not loose substrings —
  // avoids false hits like "reddit.com" containing "t.co", or hosts containing "ig".
  let token = raw;
  if (raw.includes('.')) {
    const parts = raw.split('/')[0].split('.').filter(Boolean);
    token = parts.length >= 2 ? parts[parts.length - 2] : (parts[0] || raw);
  }
  if (['facebook', 'instagram', 'meta', 'fb', 'ig'].includes(token)) return { variant: 'facebook', display: 'FB / IG', glyph: 'f' };
  if (['twitter', 'x'].includes(token) || raw === 't.co')            return { variant: 'twitter',  display: 'Twitter', glyph: 'X' };
  if (token === 'reddit')                                            return { variant: 'reddit',   display: 'Reddit', glyph: 'r' };
  if (['google', 'bing', 'duckduckgo', 'yahoo', 'ecosia', 'baidu', 'search'].includes(token))
    return { variant: 'search', display: token === 'search' ? 'Search' : titleCase(token), dot: true };
  return { variant: 'referral', display: label, dot: true };
}

export function SourceBadge({ source, title }) {
  const { variant, display, glyph, dot } = sourceVariant(source);
  return (
    <span className={`admin-src-badge src-${variant}`} title={title || `Acquisition source: ${source || 'direct'}`}>
      {glyph ? <span className="admin-src-glyph">{glyph}</span> : <span className="admin-src-dot" />}
      <span className="admin-src-label">{display}</span>
    </span>
  );
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
