// Distribution — "how many users did N of something", as vertical buckets.
//
// Replaces HabitCurve's inline flex bars, LifespanDistribution's Recharts
// BarChart and TimeToFirstCard's histogram, which were three implementations of
// one shape with three different ideas about labelling.
//
// Two series are supported because the one question worth asking of a habit
// curve is "days present vs days that contained real work" — user_active_day
// over-counts presence by roughly 2x, so a single bar there is not a fact about
// habit. The second series draws in front at partial width, so both are legible
// without a stacked bar's ambiguity about what the total means.

import { VAR } from './palette.js';

const num = (x) => (x == null || Number.isNaN(Number(x)) ? 0 : Number(x));

export function Distribution({
  buckets = [],
  height = 130,
  formatValue = (v) => v.toLocaleString(),
  /** Optional second series, aligned to the same buckets by index. */
  compare,
  compareLabel,
  primaryLabel,
  emptyLabel = 'Nothing measured yet',
  color = VAR.ink,
  compareColor = VAR.cat[0],
}) {
  const rows = buckets.filter(Boolean);
  if (!rows.length) return <div className="admin-empty">{emptyLabel}</div>;

  const ceiling = Math.max(
    1,
    ...rows.map((b) => num(b.value)),
    ...(compare || []).map((b) => num(b?.value)),
  );

  return (
    <div className="adm-dist">
      {compare && (
        <div className="adm-legend">
          <span className="adm-legend-item">
            <span className="adm-legend-swatch" style={{ background: color }} />
            {primaryLabel || 'All'}
          </span>
          <span className="adm-legend-item">
            <span className="adm-legend-swatch" style={{ background: compareColor }} />
            {compareLabel || 'Subset'}
          </span>
        </div>
      )}
      <div className="adm-dist-plot" style={{ height }}>
        {rows.map((b, i) => {
          const v = num(b.value);
          const c = compare ? num(compare[i]?.value) : null;
          return (
            <div className="adm-dist-col" key={b.key ?? b.label ?? i}>
              <div className="adm-dist-stack">
                <span
                  className="adm-dist-bar"
                  style={{ height: `${(v / ceiling) * 100}%`, background: color }}
                  title={`${b.label}: ${formatValue(v)}`}
                />
                {c != null && (
                  <span
                    className="adm-dist-bar is-compare"
                    style={{ height: `${(c / ceiling) * 100}%`, background: compareColor }}
                    title={`${b.label} (${compareLabel}): ${formatValue(c)}`}
                  />
                )}
              </div>
              {/* Direct-label only the peak — a number over every column is
                  noise, and the tooltip carries the rest. */}
              {v === ceiling && <span className="adm-dist-peak">{formatValue(v)}</span>}
            </div>
          );
        })}
      </div>
      <div className="adm-dist-axis">
        {rows.map((b, i) => (
          <span className="adm-dist-tick" key={b.key ?? b.label ?? i}>{b.label}</span>
        ))}
      </div>
    </div>
  );
}
