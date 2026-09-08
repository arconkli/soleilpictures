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
//
// The fallback is silent by design (an unknown kind must still render), which
// is why boards/src/lib/feedbackContract.test.mjs asserts this list against the
// table's CHECK: a kind added to the database and not here would print its raw
// slug in the styling reserved for 'other' and look like a bug report.
const KIND_LABEL = { return_reason: 'return' };

export function FeedbackKindPill({ kind }) {
  const k = ['bug', 'idea', 'praise', 'other', 'return_reason'].includes(kind) ? kind : 'other';
  return <span className={`admin-status admin-kind-${k}`}>{KIND_LABEL[kind] || kind}</span>;
}

// Which answer was tapped on the return question. Neutral ink — gold is
// reserved for active/selection/focus, and nothing on this page is selectable.
export function FeedbackChoicePill({ choice }) {
  if (!choice) return null;
  return <span className="admin-status admin-choice-pill">{choice}</span>;
}
