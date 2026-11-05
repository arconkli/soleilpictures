// PhoneSearch.jsx — the Search page: how Google shows and sends people to us.
// Page-level rows, web search only; the home page is counted on its own. Every
// number comes from searchModel (phoneInsights.js) and lib/phoneGrowthModels.js.
import { useMemo, useState } from 'react';
import { PageShell, Held, FullAdmin } from './PhonePageShell.jsx';
import {
  Bars, WeekLine, RankBars, Segmented, Figure, NumStats,
} from './phoneCharts.jsx';
import { searchModel } from '../../../lib/phoneInsights.js';
import {
  searchFigures, topPagesRows, homeFigure, aiFigure, crawlerFigure,
} from '../../../lib/phoneGrowthModels.js';

const EMPTY = 'Nothing to show yet.';
const placeFmt = (v) => v.toFixed(1);

export function SearchPage({ data = {}, errors = {}, now, onBack, onRetry }) {
  const [range, setRange] = useState('28d');
  const model = useMemo(() => searchModel(data.search), [data.search]);
  const has = model.days.length > 0;
  const fig = useMemo(() => searchFigures(model, range), [model, range]);
  const pages = useMemo(() => topPagesRows(model), [model]);
  const home = useMemo(() => homeFigure(model), [model]);
  const ai = useMemo(() => aiFigure(data.aiReferrals), [data.aiReferrals]);
  const crawl = useMemo(() => crawlerFigure(data.crawlers), [data.crawlers]);
  const held = (key, h) => ({ value: data[key], error: errors[key], onRetry, h });
  const ranges = [
    { id: '28d', label: '28 days' },
    { id: 'all', label: has ? `Since ${model.days[0].label}` : 'All days' },
  ];
  const quiet = <p className="ap-wait">{EMPTY}</p>;

  return (
    <PageShell
      id="search"
      kicker={has ? `Google Search · to ${model.lastLabel}` : 'Google Search'}
      title="Search"
      intro="Google reports about 3 days late. The home page is mostly people who know the name, so it is counted on its own."
      now={now}
      onBack={onBack}
    >
      <Held {...held('search', 150)}>{() => (has ? <NumStats items={model.tiles} cols={2} /> : quiet)}</Held>
      <Segmented options={ranges} value={range} onChange={setRange} label="Range" />

      <Figure n={1} topic="Search" title="Times shown in Google, a day" dek={fig.views?.dek} note={fig.views?.caption}>
        <Held {...held('search', 250)}>
          {() => (fig.views ? (
            <Bars
              key={range}
              bars={fig.views.chart.bars}
              refs={fig.views.chart.refs}
              vrule={fig.views.chart.vrule || undefined}
              xl={fig.views.xl}
              h={190}
              readout={fig.views.readout || undefined}
              label={fig.views.label}
            />
          ) : quiet)}
        </Held>
      </Figure>

      <Figure n={2} topic="Search" title="Clicks a day" dek={fig.clicks?.dek} note={fig.clicks?.caption}>
        <Held {...held('search', 220)}>
          {() => (fig.clicks ? (
            <Bars
              key={range}
              bars={fig.clicks.chart.bars}
              xl={fig.clicks.xl}
              h={160}
              readout={fig.clicks.readout || undefined}
              label={fig.clicks.label}
            />
          ) : quiet)}
        </Held>
      </Figure>

      <Figure n={3} topic="Search" title="Average place in Google" dek={fig.place?.dek} note={fig.place?.caption}>
        <Held {...held('search', 230)}>
          {() => (fig.place ? (
            <WeekLine
              key={range}
              pts={fig.place.pts}
              h={170}
              invert
              yMin={0}
              yMax={fig.place.yMax}
              area={false}
              fmt={placeFmt}
              xl={fig.place.xl}
              readout={fig.place.readout || undefined}
              label={fig.place.label}
            />
          ) : quiet)}
        </Held>
      </Figure>

      <Figure
        n={4}
        topic="Search"
        title="Top pages"
        dek={has ? `${model.pagesShown} ${model.pagesShown === 1 ? 'page was' : 'pages were'} shown at least once.` : undefined}
        note={has ? `Last 28 days to ${model.lastLabel}, home page left out.` : undefined}
      >
        <Held {...held('search', 300)}>
          {() => (pages.length ? (
            <div className="ap-tpl">
              {pages.map((p) => (
                <div className="ap-tp" key={p.key}>
                  <span className="ap-tpn">{p.path}</span>
                  <span className="ap-tpv"><b>{p.clicks}</b> clicks</span>
                  <span className="ap-tpb" aria-hidden="true"><i style={{ width: `${p.w}%` }} /></span>
                  <span className="ap-tps">{p.sub}</span>
                </div>
              ))}
            </div>
          ) : quiet)}
        </Held>
      </Figure>

      <Figure n={5} topic="Search" title="The home page" dek={home?.dek} note={home?.caption}>
        <Held {...held('search', 110)}>
          {() => (home ? (
            <>
              <div className="ap-ro">
                <span className="ap-ro-v">{home.readout.value}</span>
                <span className="ap-ro-l">{home.readout.label}</span>
              </div>
              <div className="ap-tbar is-wide" aria-hidden="true"><i style={{ width: `${home.w}%` }} /></div>
            </>
          ) : quiet)}
        </Held>
      </Figure>

      <Figure
        n={6}
        topic="Search"
        title="AI assistants"
        dek={ai?.dek}
        note={[ai?.footnote, crawl?.caption].filter(Boolean).join(' ') || undefined}
      >
        <Held {...held('aiReferrals', 24)}>{() => null}</Held>
        <Held {...held('crawlers', 220)}>
          {() => (crawl ? (
            <>
              <p className="ap-sub">AI crawlers’ visits, 30 days</p>
              {crawl.ai.items.length
                ? <RankBars items={crawl.ai.items.slice(0, 6)} label="Visits by AI crawlers in the last 30 days" />
                : <p className="ap-wait">No AI crawler visits.</p>}
              {crawl.search.items.length ? (
                <>
                  <p className="ap-sub">Search engine crawlers’ visits, 30 days</p>
                  <RankBars items={crawl.search.items.slice(0, 4)} label="Visits by search engine crawlers in the last 30 days" />
                </>
              ) : null}
            </>
          ) : quiet)}
        </Held>
      </Figure>

      <FullAdmin href="/admin?tab=discover&full=1" />
    </PageShell>
  );
}

export default SearchPage;
