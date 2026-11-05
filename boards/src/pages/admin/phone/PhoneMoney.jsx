/* Money: four tiles, then the offer-to-paying ladder, why people said not yet,
   the trial and the card limit (G-paper-app's moneyPage). The numbers come from
   lib/phonePageModels.js; moneyPeople arrives as counts only (phoneData pick()). */
import { moneyTiles, moneyLadder, moneyReasons, trialModel, capModel } from '../../../lib/phonePageModels.js';
import { Ladder, NumStats, RankBars, SplitBar } from './phoneCharts.jsx';
import { PageShell, FullAdmin } from './PhonePageShell.jsx';
import { Fig } from './phoneFig.jsx';

export function MoneyPage({ data = {}, errors = {}, now, onBack, onRetry }) {
  const t = moneyTiles({ stats: data.stats, moneyPeople: data.moneyPeople, moneyPath: data.moneyPath });
  return (
    <PageShell id="money" kicker="Subscriptions and trials" title="Money" now={now} onBack={onBack}>
      <NumStats items={t.tiles} />
      <p className="ap-cp">{t.mrrNote}{t.comped ? ` ${t.comped}` : ''}</p>

      <Fig
        n={1} topic="The offer" title="From offer to paying"
        value={data.moneyPath} error={errors.moneyPath} onRetry={onRetry} h={300}
        build={(path) => {
          const m = moneyLadder(path);
          return m && { dek: m.dek, note: m.caption, body: <Ladder steps={m.steps} label={m.label} /> };
        }}
      />
      <Fig
        n={2} topic="The offer" title="Why people said not yet"
        value={data.moneyPath} error={errors.moneyPath} onRetry={onRetry} h={200}
        empty="No one has answered yet."
        build={(path) => {
          const m = moneyReasons(path);
          return m && { dek: m.dek, note: m.caption, body: <RankBars items={m.items} total={m.total ?? undefined} label={m.label} /> };
        }}
      />
      <Fig
        n={3} topic="The trial" title="The trial"
        value={data.trial} error={errors.trial} onRetry={onRetry} h={200}
        build={(rows) => {
          const m = trialModel(rows);
          return m && { dek: m.dek, note: m.caption, body: <RankBars items={m.items} label={m.label} /> };
        }}
      />
      <Fig
        n={4} topic="Card limit" title="Near the card limit"
        value={data.moneyPeople} error={errors.moneyPeople} onRetry={onRetry} h={120}
        build={(people) => {
          const m = capModel(people);
          return m && { dek: m.dek, note: m.caption, body: <SplitBar parts={m.parts} label={m.label} /> };
        }}
      />
      <FullAdmin href="/admin?tab=overview&view=money&full=1" />
    </PageShell>
  );
}
