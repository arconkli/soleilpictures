// Pill/badge helpers so a color means exactly one thing across tabs.
// Previously the same orange/green/red palette stood for waitlist status,
// grant lifecycle, feedback KIND, and user tier all at once — and feedback
// "idea" vs "other" were indistinguishable. These centralize the mapping.

// Read-only tier badge (Overview, Analytics, Storage, Top-users). The
// Users tab keeps its own interactive .admin-tier-pill button group.
export function TierPill({ tier }) {
  const t = ['admin', 'paid', 'demo', 'waitlist'].includes(tier) ? tier : 'demo';
  return <span className={`admin-status admin-status-${t}`}>{tier || '—'}</span>;
}

// Lifecycle status for waitlist entries and paid grants. Maps each label
// to a semantic color (green=good/active, red=bad/revoked, neutral=ended,
// orange=special/forever) while keeping the literal text.
const STATUS_COLOR = {
  pending: 'pending', accepted: 'accepted', rejected: 'rejected', canceled: 'canceled',
  active: 'accepted', forever: 'admin', expired: 'canceled', revoked: 'rejected',
  // Stripe subscription statuses (Billing section): a healthy trial reads green,
  // a billing problem reads as needs-attention (orange) rather than dead (grey).
  trialing: 'accepted', past_due: 'pending', unpaid: 'rejected',
  incomplete: 'pending', incomplete_expired: 'canceled', paused: 'canceled',
};
export function StatusPill({ kind }) {
  const color = STATUS_COLOR[kind] || 'canceled';
  return <span className={`admin-status admin-status-${color}`}>{kind}</span>;
}

// Feedback kind — its own palette so bug/idea/praise/other are each
// distinct (idea and other no longer collide on the same neutral).
export function FeedbackKindPill({ kind }) {
  const k = ['bug', 'idea', 'praise', 'other'].includes(kind) ? kind : 'other';
  return <span className={`admin-status admin-kind-${k}`}>{kind}</span>;
}
