// ActivationFunnel — signed_up → first_X_at milestone counts.
//
// Bars are honest at any N: a bar of 1 reads as 1. The small-N rule still
// applies to the LABELS, though — below the flag floor we show counts rather
// than conversion percentages and say why.
//
// Was a Recharts horizontal BarChart with every bar filled in gold at a
// descending opacity, which made this the largest single block of orange on
// the dashboard. It is a labelled ranked list, so it is BarRows now: same
// information, no chart library, and the mark is neutral ink because a
// milestone count is magnitude rather than identity.

import { formatCount, formatPct, MIN_RATE_FLAG } from '../../../../lib/adminFormat.js';
import { BarRows } from '../../viz/BarRows.jsx';
import { PanelNote } from '../../SmallN.jsx';

const STEPS = [
  { key: 'signed_up',       label: 'Signed up' },
  { key: 'first_board',     label: 'Created board' },
  { key: 'first_card',      label: 'Created card' },
  { key: 'populated_board', label: 'Populated a board' },
  { key: 'first_share',     label: 'Shared a board' },
  { key: 'first_backlink',  label: 'Linked a doc' },
  { key: 'first_paid',      label: 'Became paid' },
];

export function ActivationFunnel({ data, days = 30 }) {
  if (!data) return null;
  const signed = Number(data.signed_up) || 0;
  const top = Math.max(1, signed);
  const showPct = signed >= MIN_RATE_FLAG;

  const rows = STEPS.map((s) => ({
    key: s.key,
    label: s.label,
    value: Number(data[s.key] || 0),
    pct: Number(data[s.key] || 0) / top,
  }));

  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Activation milestones</h3>
        <span className="admin-chart-sub t-meta">
          post-signup product milestones · n={formatCount(signed)} signed up · last {days}d
        </span>
      </header>
      <div className="admin-chart-body">
        <BarRows
          ramp
          rows={rows}
          max={top}
          formatValue={(v) => formatCount(v)}
          secondary={showPct ? (r) => formatPct(r.pct) : undefined}
          emptyLabel="No signups in this window."
        />
        {!showPct && (
          <PanelNote>
            Showing counts, not rates — the cohort is below {MIN_RATE_FLAG} signups, so conversion
            percentages aren&rsquo;t yet meaningful.
          </PanelNote>
        )}
      </div>
    </section>
  );
}
