/* Sharing: the last 30 days. Signups from shares by week (the open week
   hollow), and a table by kind of share. Numbers from lib/phonePageModels.js. */
import { shareTiles, shareChart, shareRouteRows, inviteLine } from '../../../lib/phonePageModels.js';
import { Bars, NumStats } from './phoneCharts.jsx';
import { PageShell, FullAdmin } from './PhonePageShell.jsx';
import { Fig } from './phoneFig.jsx';

export function SharingPage({ data = {}, errors = {}, now, onBack, onRetry }) {
  const tiles = shareTiles(data.sharing);
  return (
    <PageShell id="sharing" kicker="Last 30 days" title="Sharing" now={now} onBack={onBack}>
      {tiles.length ? <NumStats items={tiles} /> : null}

      <Fig
        n={1} topic="Sharing" title="Signups from shares, by week"
        value={data.sharing} error={errors.sharing} onRetry={onRetry} h={220}
        build={(sharing) => {
          const m = shareChart(sharing, now);
          if (!m) return null;
          return {
            dek: m.head,
            note: m.caption,
            body: <Bars bars={m.bars} h={160} maxBw={44} axis={false} xl={m.xl} readout={m.readout} label={m.label} />,
          };
        }}
      />
      <Fig
        n={2} topic="Sharing" title="By kind of share"
        value={data.sharing} error={errors.sharing} onRetry={onRetry} h={220}
        build={(sharing) => {
          const rows = shareRouteRows(sharing);
          if (!rows.length) return null;
          const invites = inviteLine(data.referrals);
          return {
            dek: 'Opened counts devices; a dash means that kind of share has no opening to count.',
            note: invites || undefined,
            body: (
              <table className="ap-tbl">
                <thead><tr><th scope="col"><span className="ap-sr">Kind of share</span></th><th scope="col">Shared</th><th scope="col">Opened</th><th scope="col">Signed up</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td>{r.label}</td><td>{r.shared}</td><td>{r.opened}</td><td><b>{r.signedUp}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ),
          };
        }}
      />
      <FullAdmin href="/admin?tab=overview&view=sharing&full=1" />
    </PageShell>
  );
}
