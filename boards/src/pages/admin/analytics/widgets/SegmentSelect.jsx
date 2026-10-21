// SegmentSelect — one ad-segment dropdown (Source / Campaign / Creative) for
// the signup funnel. Options come from admin_funnel_segments; each shows its
// session volume so the operator can pick the segments that actually have data.
// Extracted from the old AdminFunnelTab so the shell toolbar and the funnel
// views can share it.
//
// The chosen value outlives its option. Options are refetched per range and
// population, but the value persists (URL and state), so after a switch from 90
// days to 7 a campaign with no traffic this week is still filtering the funnel
// while a controlled <select> with no matching option DISPLAYS the first one,
// "Campaign: all". The applied value is therefore always listed, marked as
// having nothing in this window, so the control never contradicts the filter.
//
// Values are shown by name (segmentLabel): a shared link's campaign has been
// stored as a placeholder since 0474, and the placeholder is not a name.

import { formatCount, segmentLabel } from '../../../../lib/adminFormat.js';

export function SegmentSelect({ label, value, onChange, options }) {
  const orphan = value && !options.some((o) => o.value === value);
  return (
    <select
      className="auth-input admin-filter-select"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={label}
    >
      <option value="">{label}: all</option>
      {orphan && <option value={value}>{segmentLabel(value)} (none in this window)</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{segmentLabel(o.value)} ({formatCount(o.sessions)})</option>
      ))}
    </select>
  );
}
