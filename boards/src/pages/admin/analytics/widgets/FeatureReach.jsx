// FeatureReach — how far each feature reaches a signup week, on day one and by
// day fourteen. Reads admin_feature_reach (0365).
//
// This is the panel the product-education work is graded on. The pass that
// built it found that telling people about features moves nothing they do
// later (tour completion, the intent pick, the power reveals and the docs site
// were all null for return), so the Help menu and the failure-triggered hints
// are not graded on return at all — they are graded here, on whether a signup
// week reaches a feature that the week before it did not. The table beside
// this one (FeatureAdoption) prints each feature's association with return and
// says on its face why that is not cause; this one deliberately prints no
// return column.
//
// Two denominators. Day one counts everyone in the cohort (card-placers at
// least a day old); day fourteen counts only the people whose fourteen days are
// up, so the newest weeks show a day-one figure and a dash, never a number that
// will rise on its own as the week ages.
import { formatCount, formatPct, MIN_RATE_SHOW } from '../../../../lib/adminFormat.js';
import { PanelNote } from '../../SmallN.jsx';

// Pooled table, most-reached first; the weekly table keeps the features that a
// week can plausibly move and reads newest week first.
const WEEKLY = ['writing', 'cluster', 'list_view', 'grid', 'doc', 'share', 'search', 'help', 'docs_site'];
const LABEL = {
  writing: 'Writing (note / doc)',
  cluster: 'A cluster',
  second_cluster: 'A second cluster',
  list_view: 'List view',
  grid: 'A grid',
  doc: 'A doc',
  files_links: 'Files & links',
  import: 'Bulk import',
  share: 'Share panel',
  search: 'Search',
  download: 'Download',
  arrows: 'Arrows',
  comments: 'Comments',
  tags: 'Tags',
  help: 'Help menu',
  docs_site: 'Docs from the app',
};

const label = (f) => LABEL[f] || f.replace(/_/g, ' ');
const rate = (num, den) => (den >= MIN_RATE_SHOW ? formatPct(num / den) : '—');

export function FeatureReach({ rows = [] }) {
  const list = Array.isArray(rows) ? rows : [];
  const pooled = list.filter((r) => r.cohort === 'all' && Number(r.n) > 0)
    .sort((a, b) => (Number(b.d14) / Math.max(1, Number(b.d14_n))) - (Number(a.d14) / Math.max(1, Number(a.d14_n))));
  const weeks = [...new Set(list.filter((r) => r.cohort !== 'all').map((r) => r.cohort))].sort().reverse();
  const cell = new Map(list.map((r) => [`${r.cohort}|${r.feature}`, r]));
  const n = pooled.length ? Number(pooled[0].n) : 0;
  const matured = pooled.length ? Number(pooled[0].d14_n) : 0;

  return (
    <section className="admin-chart-panel">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Feature reach by signup week</h3>
        <span className="admin-chart-sub t-meta">
          card-placers since 2026-08-17 · {formatCount(n)} people · {formatCount(matured)} past day fourteen
        </span>
      </header>

      <div className="admin-chart-body">
        {pooled.length === 0 ? (
          <PanelNote>No cohort old enough to read yet.</PanelNote>
        ) : (
          <>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Feature</th>
                  <th style={{ textAlign: 'right' }}>On day one</th>
                  <th style={{ textAlign: 'right' }}>By day fourteen</th>
                </tr>
              </thead>
              <tbody>
                {pooled.map((r) => (
                  <tr key={r.feature}>
                    <td>{label(r.feature)}</td>
                    <td style={{ textAlign: 'right' }}>{rate(Number(r.d1), Number(r.n))}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{rate(Number(r.d14), Number(r.d14_n))}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {weeks.length > 0 && (
              <table className="admin-table" style={{ marginTop: 14 }}>
                <thead>
                  <tr>
                    <th>Signup week</th>
                    <th style={{ textAlign: 'right' }}>n</th>
                    {WEEKLY.map((f) => <th key={f} style={{ textAlign: 'right' }}>{label(f)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((w) => {
                    const any = cell.get(`${w}|${WEEKLY[0]}`);
                    const wn = any ? Number(any.n) : 0;
                    const wm = any ? Number(any.d14_n) : 0;
                    return (
                      <tr key={w}>
                        <td>{w}</td>
                        <td style={{ textAlign: 'right' }}>{formatCount(wn)}{wm < wn ? ` (${formatCount(wm)} matured)` : ''}</td>
                        {WEEKLY.map((f) => {
                          const r = cell.get(`${w}|${f}`);
                          return <td key={f} style={{ textAlign: 'right' }}>{r ? rate(Number(r.d14), Number(r.d14_n)) : '—'}</td>;
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <PanelNote>
              Reach, not lift: the share of a signup week&rsquo;s card-placers who touched the feature at
              all. Day one counts everyone; day fourteen counts only people whose two weeks are up, so a
              fresh week shows a dash there rather than a number that would climb by itself. Rows under{' '}
              {MIN_RATE_SHOW} people show no rate. Grade a Help or hint ship by whether the weeks after it
              reach a feature the weeks before it did not — never on the return panels, which no told
              feature has ever moved here.
            </PanelNote>
          </>
        )}
      </div>
    </section>
  );
}
