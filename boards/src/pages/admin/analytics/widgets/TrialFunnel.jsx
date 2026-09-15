// TrialFunnel.jsx — the Creator trial, as ordered stages. Reads
// admin_trial_funnel (0326).
//
// "On trial right now" is deliberately its own stage and is never folded into
// paying. A trialing subscription carries the full list price, so anything that
// counts it as revenue is reporting money that has not arrived and may never.
//
// "Eligible today" is computed in SQL from the SAME rule the edge function
// enforces before it will create a trial checkout. If that number and the
// offers people actually see ever disagree, one of the two copies has drifted.
import { PanelNote, ChartPlaceholder } from '../../SmallN.jsx';
import { formatCount } from '../../../../lib/adminFormat.js';
import { VAR } from '../../viz/palette.js';

export function TrialFunnel({ rows = [] }) {
  const data = rows || [];
  if (!data.length) return <ChartPlaceholder title="Trial data unavailable" />;
  const top = Math.max(1, ...data.map((r) => Number(r.people) || 0));

  return (
    <div className="adm-gap">
      {data.map((r) => {
        const n = Number(r.people) || 0;
        // The live stage gets the accent; everything else is neutral ink, so
        // the eye lands on where people actually are rather than on the funnel.
        const live = r.stage === 'On trial right now' && n > 0;
        return (
          <div className="adm-gap-row" key={r.stage} title={r.note}>
            <span className="adm-gap-label">{r.stage}</span>
            <span className="adm-bar-track">
              <span
                className="adm-bar-fill"
                style={{ width: `${Math.round((n / top) * 100)}%`, background: live ? VAR.cat[1] : VAR.cat[0] }}
              />
            </span>
            <span className="adm-gap-val">{formatCount(n)}</span>
            <span className="adm-gap-cum admin-muted">{r.note}</span>
          </div>
        );
      })}
      <PanelNote>
        Eligible is computed from the same rule the server enforces before it will open a trial
        checkout, so a gap between it and the offers people see means one of the two copies has
        drifted. A trial in flight is never counted as revenue.
      </PanelNote>
    </div>
  );
}
