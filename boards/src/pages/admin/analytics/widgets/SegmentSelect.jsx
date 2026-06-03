// SegmentSelect — one ad-segment dropdown (Source / Campaign / Creative) for
// the signup funnel. Options come from admin_funnel_segments; each shows its
// session volume so the operator can pick the segments that actually have data.
// Extracted from the old AdminFunnelTab so the shell toolbar and the funnel
// views can share it.

import { formatCount } from '../../../../lib/adminFormat.js';

export function SegmentSelect({ label, value, onChange, options }) {
  return (
    <select
      className="auth-input admin-filter-select"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={label}
    >
      <option value="">{label}: all</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.value} ({formatCount(o.sessions)})</option>
      ))}
    </select>
  );
}
