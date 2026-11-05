// PhoneGrowth.jsx — the Growth page: people all time and by week. Eight figures,
// the first five on one range switch (12 weeks | 6 months). Every number is
// computed by lib/phoneGrowthModels.js / phoneInsights.js; this file draws.
import { useMemo, useState } from 'react';
import { PageShell, Held, FullAdmin } from './PhonePageShell.jsx';
import {
  WeekLine, StackBars, Heatmap, Lollipop, Segmented, Figure, NumStats,
} from './phoneCharts.jsx';
import {
  growthTiles, growthFigures, heatFigure, returnFigure, retentionFigure, RETURN_SINCE,
} from '../../../lib/phoneGrowthModels.js';

const RANGES = [{ id: '12w', label: '12 weeks' }, { id: '26w', label: '6 months' }];
const EMPTY = 'Nothing to show yet.';

/** Rate rows (device, source): a name, the share or "9 of 12", the group size, a bar. */
function RateRanks({ rows, label }) {
  return (
    <div className="ap-rkl" role="group" aria-label={label}>
      {rows.map((r) => (
        <div className="ap-rk" key={r.key}>
          <span className="ap-rk-l">{r.label}</span>
          <span className="ap-rk-v">{r.text}{r.sub ? <small>{r.sub}</small> : null}</span>
          <span className="ap-rk-b" aria-hidden="true"><i style={{ width: `${r.w}%` }} /></span>
        </div>
      ))}
    </div>
  );
}

function Readout({ value, label }) {
  return (
    <div className="ap-ro">
      <span className="ap-ro-v">{value}</span>
      <span className="ap-ro-l">{label}</span>
    </div>
  );
}

export function GrowthPage({ data = {}, errors = {}, now, onBack, onRetry }) {
  const [range, setRange] = useState('12w');
  const fig = useMemo(() => growthFigures(data.growth, data.kpi, range), [data.growth, data.kpi, range]);
  const heat = useMemo(() => (data.heatmap ? heatFigure(data.heatmap) : null), [data.heatmap]);
  const back = useMemo(() => (data.ret ? returnFigure(data.ret, RETURN_SINCE) : null), [data.ret]);
  const curve = useMemo(() => (data.retention ? retentionFigure(data.retention) : null), [data.retention]);
  const tiles = useMemo(() => (data.lifetime ? growthTiles(data.lifetime, data.growth) : null), [data.lifetime, data.growth]);
  const held = (key, h) => ({ value: data[key], error: errors[key], onRetry, h });

  // A weekly figure whose chart is `draw(model)`; empty when the series has no rows.
  const weekly = (n, title, pick, draw, extra = {}) => (
    <Figure n={n} topic="Growth" title={title} dek={fig[pick]?.dek} note={fig[pick]?.caption}>
      <Held {...held('growth', 230)}>
        {() => (fig[pick] ? draw(fig[pick]) : <p className="ap-wait">{EMPTY}</p>)}
      </Held>
    </Figure>
  );

  return (
    <PageShell id="growth" kicker="People · all time and by week" title="Growth" now={now} onBack={onBack}>
      <Held {...held('lifetime', 150)}>{() => <NumStats items={tiles || []} cols={2} />}</Held>
      <Segmented options={RANGES} value={range} onChange={setRange} label="Range" />

      {weekly(1, 'Signups', 'signups', (m) => (
        <WeekLine key={range} pts={m.pts} h={170} notes={m.notes} readout={m.readout || undefined} label={m.label} />
      ))}

      <Figure n={2} topic="Growth" title="Active people" dek={fig.active?.dek} note={fig.active?.caption}>
        <Held {...held('growth', 230)}>
          {() => (fig.active
            ? <StackBars key={range} rows={fig.active.rows} legend={fig.active.legend} h={170} readout={fig.active.readout || undefined} label={fig.active.label} />
            : <p className="ap-wait">{EMPTY}</p>)}
        </Held>
      </Figure>

      {weekly(3, 'Did real work', 'work', (m) => (
        <WeekLine key={range} pts={m.pts} h={170} readout={m.readout || undefined} label={m.label} />
      ))}

      {weekly(4, 'Cards added', 'cards', (m) => (
        <WeekLine key={range} pts={m.pts} h={170} readout={m.readout || undefined} label={m.label} />
      ))}

      {weekly(5, 'Made something on day one', 'start', (m) => (
        <WeekLine key={range} pts={m.pts} h={170} isPct yMin={0} readout={m.readout || undefined} label={m.label} />
      ))}

      <Figure n={6} topic="Growth" title="When people are in the app" dek={heat?.dek} note={heat?.caption}>
        <Held {...held('heatmap', 190)}>
          {() => (heat ? <Heatmap cells={heat.cells} label={heat.label} /> : <p className="ap-wait">{EMPTY}</p>)}
        </Held>
      </Figure>

      <Figure n={7} topic="Growth" title="Coming back within a week" dek={back?.head ? `${back.head}.` : undefined} note={back?.caption}>
        <Held {...held('ret', 260)}>
          {() => (back && (back.readout || back.bands.length) ? (
            <>
              {back.readout ? <Readout value={back.readout.value} label={back.readout.label} /> : null}
              {back.bands.length ? <Lollipop items={back.bands} yMax={back.yMax} label={back.label} /> : null}
              {back.tooFew.length ? <p className="ap-sub">Too few to chart: {back.tooFew.join('; ')}</p> : null}
              {back.devices.length ? (<><p className="ap-sub">By device</p><RateRanks rows={back.devices} label="Share who came back within a week, by device" /></>) : null}
              {back.sources.length ? (<><p className="ap-sub">By source</p><RateRanks rows={back.sources} label="Share who came back within a week, by source" /></>) : null}
            </>
          ) : <p className="ap-wait">{EMPTY}</p>)}
        </Held>
      </Figure>

      <Figure n={8} topic="Growth" title="Opened the app again on day…" dek={curve?.dek} note={curve?.caption}>
        <Held {...held('retention', 230)}>
          {() => (curve
            ? <WeekLine pts={curve.pts} h={170} isPct xl={curve.xl} area={false} readout={curve.readout || undefined} label={curve.label} />
            : <p className="ap-wait">{EMPTY}</p>)}
        </Held>
      </Figure>

      <FullAdmin href="/admin?tab=overview&view=overview&full=1" />
    </PageShell>
  );
}

export default GrowthPage;
