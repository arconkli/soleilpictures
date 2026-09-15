// PaidReachTable.jsx — of the people who built something, how many have been
// shown a price? Reads admin_paid_reach (0324).
//
// This is the panel the price-visibility change is graded on. Before it, the
// only way to ask "has this person ever seen what Creator costs" was the modal's
// pricing_view, and most of the people who filled a board never opened the
// modal: the pill, the banner and the approaching-limit toast carried no
// number. The bands are by live cards today; the first row is relative to each
// person's own cap, because that is the row the wall is about.
//
// Every cell is DISTINCT USERS, and the bar is the share of the band. Small
// bands print their n, and the price_seen column is expected to lag saw_price
// until the base ages past the deploy that introduced it.
import { VAR } from '../../viz/palette.js';
import { ChartPlaceholder } from '../../SmallN.jsx';

const COLS = [
  ['saw_price',  'Saw a price'],
  ['price_seen', 'Price on a surface'],
  ['saw_wall',   'Saw the wall'],
  ['saw_banner', 'Saw the banner'],
  ['saw_toast',  'Near-cap toast'],
  ['clicked',    'Clicked to upgrade'],
  ['blocked',    'Cap-blocked'],
  ['intent',     'Clicked Get Creator'],
];

const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—');

export function PaidReachTable({ rows = [] }) {
  const data = (rows || []).filter((r) => Number(r.users) > 0);
  if (!data.length) return <ChartPlaceholder title="No demo accounts in this window yet" />;
  return (
    <div className="adm-gap">
      <div className="admin-table-wrap" style={{ overflowX: 'auto' }}>
        <table className="admin-table t-meta">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Live cards</th>
              <th>People</th>
              {COLS.map(([k, label]) => <th key={k}>{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.map((r) => {
              const n = Number(r.users) || 0;
              return (
                <tr key={r.band}>
                  <td style={{ textAlign: 'left' }}>{r.band}</td>
                  <td>{n}</td>
                  {COLS.map(([k]) => {
                    const v = Number(r[k]) || 0;
                    return (
                      <td key={k} title={`${v} of ${n}`}>
                        <span className="adm-bar-track" style={{ display: 'inline-block', width: 44, verticalAlign: 'middle', marginRight: 6 }}>
                          <span className="adm-bar-fill" style={{ width: pct(v, n) === '—' ? 0 : pct(v, n), background: k === 'intent' ? VAR.cat[1] : VAR.cat[0] }} />
                        </span>
                        {v}<span className="admin-muted"> · {pct(v, n)}</span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="admin-panel-note">
        Distinct people per cell, among demo accounts that signed up in the window, banded by their live
        cards today. "Saw a price" is any pricing view; "Price on a surface" is the once-per-account stamp
        the pill, banner and toast write, and lags until the base ages past the deploy that added it. The
        top row is relative to each person's own cap. Grade the reach change on the 13+ rows: the goal is
        that someone who reaches thirteen cards sees the price within a week of reaching it.
      </div>
    </div>
  );
}
