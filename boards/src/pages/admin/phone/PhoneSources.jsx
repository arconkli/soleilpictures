/* Sources: where new people came from (7 | 30 days), and who comes back, by
   source. Figures are G-paper-app's sourcesPage; every number is made in
   lib/phonePageModels.js. */
import { useState } from 'react';
import { channelLabel } from '../AdminUserDetailParts.jsx';
import { sourcesWindow, sourceReturn } from '../../../lib/phonePageModels.js';
import { RankBars, Segmented } from './phoneCharts.jsx';
import { PageShell, FullAdmin } from './PhonePageShell.jsx';
import { Fig, Readout } from './phoneFig.jsx';

const RANGES = [{ id: '7', label: '7 days' }, { id: '30', label: '30 days' }];

export function SourcesPage({ data = {}, errors = {}, now, onBack, onRetry }) {
  const [days, setDays] = useState('30');
  const key = days === '7' ? 'acq7' : 'acq30';
  return (
    <PageShell id="sources" kicker="Where new people came from" title="Sources" now={now} onBack={onBack}>
      <Segmented options={RANGES} value={days} onChange={setDays} label="Window" />
      <Fig
        n={1} topic="Sources" title="First source of each new person"
        value={data[key]} error={errors[key]} onRetry={onRetry} h={260}
        build={(rows) => {
          const m = sourcesWindow(rows, Number(days), channelLabel);
          if (!m) return null;
          return {
            dek: m.dek,
            body: m.items.length
              ? (
                <>
                  <Readout value={m.readout.value} label={m.readout.label} />
                  <RankBars items={m.items} total={m.pctTotal ?? undefined} label={m.label} />
                </>
              )
              : <p className="ap-wait">{m.empty}</p>,
          };
        }}
      />
      <Fig
        n={2} topic="Coming back" title="Who comes back, by source"
        value={data.ret} error={errors.ret} onRetry={onRetry} h={240}
        build={(rows) => {
          const m = sourceReturn(rows);
          if (!m) return null;
          return {
            dek: 'Opened the app again within 7 days of joining.',
            note: m.caption,
            body: m.items.length
              ? (
                <div className="ap-rkl" role="group" aria-label={m.label}>
                  {m.items.map((it) => (
                    <div className="ap-rk" key={it.key}>
                      <span className="ap-rk-l">{it.label}</span>
                      <span className="ap-rk-v">{it.text}{it.sub ? <small>{it.sub}</small> : null}</span>
                      <span className="ap-rk-b" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, it.frac * 100))}%` }} /></span>
                    </div>
                  ))}
                </div>
              )
              : <p className="ap-wait">No source groups to show yet.</p>,
          };
        }}
      />
      <FullAdmin href="/admin?tab=overview&view=funnel&full=1" />
    </PageShell>
  );
}
