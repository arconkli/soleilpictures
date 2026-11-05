/* Problems: the last 7 days of open production problems (team left out). The
   RPC's "people" are browser sessions, so the page says browsers. Numbers from
   lib/phonePageModels.js. */
import { problemsModel } from '../../../lib/phonePageModels.js';
import { NumStats, SplitBar } from './phoneCharts.jsx';
import { PageShell, FullAdmin, Held } from './PhonePageShell.jsx';
import { Fig } from './phoneFig.jsx';

export function ProblemsPage({ data = {}, errors = {}, now, onBack, onRetry }) {
  const m = problemsModel(data.problems);
  return (
    <PageShell id="problems" kicker="Last 7 days" title="Problems" now={now} onBack={onBack}>
      {m
        ? <NumStats items={m.tiles} />
        : <Held value={data.problems} error={errors.problems} onRetry={onRetry} h={150}>{() => null}</Held>}

      <Fig
        n={1} topic="Problems" title="Who was affected"
        value={data.problems} error={errors.problems} onRetry={onRetry} h={120}
        empty="Nothing to show yet."
        build={() => {
          if (!m) return null;
          if (!m.crowd) return { dek: m.dek, note: m.caption, body: <p className="ap-wait">No browser counts to draw.</p> };
          return {
            dek: m.dek,
            note: m.caption,
            body: m.crowd.mode === 'split'
              ? <SplitBar parts={m.crowd.parts} label={m.label} />
              : (
                <div className="ap-crowd" role="img" aria-label={m.label}>
                  {m.crowd.dots.map((hit, i) => <i key={i} className={hit ? 'hit' : undefined} />)}
                </div>
              ),
          };
        }}
      />
      <FullAdmin href="/admin?tab=errors&full=1" />
    </PageShell>
  );
}
