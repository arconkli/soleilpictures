// PhoneToday.jsx — the panel's first tab, as a daily brief: the signups lead,
// today's three numbers, this week against last, six figures, the newest
// signups, what needs a look and an index of the pages. Every figure is one the
// desktop admin already reads (phoneData.js: team left out, verified only), and
// every number on screen comes from a model in lib/phoneInsights.js.
//
// Two waves: FIRST (today's calls) draws the top of the page; SECOND (the
// figures' calls) starts once the first has settled, so the first paint costs
// what it always did. Each section shows a quiet placeholder until its own data
// lands, and a "Couldn't load" line when its call failed with nothing to show.
import { useEffect, useMemo, useRef, useState } from 'react';
import { FIRST, SECOND, usePhoneData } from './phoneData.js';
import {
  mastModel, leadModel, todayModel, tileModels, TILES_CAPTION, searchModel, searchChart, startModel,
  returnModel, shareModel, sourcesModel, heatModel, newestRows, lookModel, indexModel,
} from '../../../lib/phoneInsights.js';
import { formatCount, RETURN_SINCE } from '../../../lib/phonePanel.js';
import { channelLabel } from '../AdminUserDetailParts.jsx';
import {
  WeekLine, Bars, Heatmap, Spark, RankBars, Lollipop, PaceBar, Figure, Section, DeltaText,
} from './phoneCharts.jsx';

const Chev = () => (
  <svg className="ap-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
);

function Failed({ onRetry }) {
  return (
    <p className="ap-fail">
      Couldn’t load ·{' '}
      <button type="button" className="ap-link" onClick={onRetry}>Try again</button>
    </p>
  );
}

// One section's data: a placeholder while it has not landed, the failure line
// when it failed with nothing to show, else the children.
function Hold({ value, error, onRetry, h = 120, panel = true, children }) {
  if (value === undefined) return <div className={`ap-skel${panel ? ' ap-pan' : ''}`} style={{ height: h }} aria-hidden="true" />;
  if (value === null && error) return panel ? <div className="ap-pan"><Failed onRetry={onRetry} /></div> : <Failed onRetry={onRetry} />;
  return children;
}

const xlist = (bars, idx) => idx.filter((i) => bars[i]).map((i) => ({ i, text: String(bars[i].label).split(' –')[0] }));

export function PhoneToday({ refresh, now, onLoaded, onRetry, onBoards, onOpen, onSheet }) {
  const first = usePhoneData(FIRST, refresh);
  const [wave2, setWave2] = useState(false);
  const seen = useRef(false);
  const second = usePhoneData(SECOND, refresh, { enabled: wave2 });
  const v = { ...second.values, ...first.values };
  const errors = { ...second.errors, ...first.errors };

  // The first wave settling is what onLoaded reports and what starts the second.
  const settled = useRef(false);
  const latest = useRef(v);
  latest.current = v;
  useEffect(() => {
    if (first.loading) { seen.current = true; return; }
    if (!seen.current) return;
    settled.current = true;
    setWave2(true);
    onLoaded?.(latest.current.kpi != null || latest.current.signups != null);
  }, [first.loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const nowD = useMemo(() => new Date(now), [now]);

  const mast = useMemo(() => mastModel(now), [now]);
  const lead = useMemo(() => leadModel(v.kpi, v.weeks), [v.kpi, v.weeks]);
  const today = useMemo(
    () => todayModel({ signups: v.signups, weeks: v.weeks, active: v.active, stats: v.stats, moneyPeople: v.moneyPeople, now: nowD }),
    [v.signups, v.weeks, v.active, v.stats, v.moneyPeople, nowD],
  );
  const tiles = useMemo(() => tileModels(v.kpi, v.weeks, v.growth), [v.kpi, v.weeks, v.growth]);
  const search = useMemo(() => searchModel(v.search), [v.search]);
  const start = useMemo(() => startModel(v.growth), [v.growth]);
  const back = useMemo(() => returnModel(v.ret, RETURN_SINCE), [v.ret]);
  const share = useMemo(() => shareModel(v.sharing, now), [v.sharing, now]);
  const sources = useMemo(() => sourcesModel(v.acq30, channelLabel), [v.acq30]);
  const heat = useMemo(() => heatModel(v.heatmap), [v.heatmap]);
  const newest = useMemo(() => newestRows(v.signups, nowD, channelLabel), [v.signups, nowD]);
  const look = useMemo(
    () => lookModel({ boards: v.boards, approvals: v.approvals?.pending, errors: v.errors, moneyPeople: v.moneyPeople }),
    [v.boards, v.approvals, v.errors, v.moneyPeople],
  );
  const inside = useMemo(
    () => indexModel({ lifetime: v.lifetime, search, stats: v.stats, share: v.sharing, sources, errors: v.errors, email: v.emails }),
    [v.lifetime, search, v.stats, v.sharing, sources, v.errors, v.emails],
  );

  // Nothing came back at all: the old failure card, with Retry.
  const dead = !first.loading && first.values.kpi == null && first.values.signups == null
    && (seen.current || Object.keys(first.errors).length > 0);
  if (dead && settled.current) {
    const e = errors.kpi || errors.signups;
    return (
      <div className="ap-card ap-err" role="alert">
        Couldn’t load the numbers. {e?.message || ''}
        <div><button type="button" className="ap-btn" onClick={onRetry}>Try again</button></div>
      </div>
    );
  }

  const dash = (n) => (n == null ? '–' : formatCount(n));
  let fig = 0;
  const nextFig = () => { fig += 1; return fig; };

  // ── the lead card ──
  const leadDelta = lead.delta;
  const leadStatic = (
    <div className="ap-ro">
      <span className="ap-ro-v">{lead.valueText || '–'}</span>
      {leadDelta && leadDelta.text && <span className="ap-ro-d"><DeltaText delta={leadDelta} /></span>}
      <span className="ap-ro-l">people signed up</span>
    </div>
  );
  const leadBetween = (
    <>
      {lead.prevText && <p className="ap-leadvs">on the 7 days before ({lead.prevText})</p>}
      {lead.clause && <p className="ap-leadk">{lead.clause}</p>}
    </>
  );

  // ── the search figure ──
  const searchBars = search.chart.bars;
  const searchOn = v.search != null && (search.head || searchBars.length > 1);

  return (
    <>
      <header className="ap-mast">
        <span>{mast.date}</span>
        <span>{mast.clock ? `${mast.clock} ET` : ''}</span>
      </header>

      <section className="ap-pan ap-feat ap-lead" data-testid="ap-lead">
        <p className="ap-kick">Signups · last 7 days</p>
        {v.kpi === undefined ? (
          <div className="ap-skel ap-skel-num" style={{ margin: '14px 0' }} aria-hidden="true" />
        ) : v.kpi === null && errors.kpi ? (
          <Failed onRetry={onRetry} />
        ) : v.weeks && lead.pts.length > 0 ? (
          <div className="ap-leadchart">
            <WeekLine
              pts={lead.pts}
              h={240}
              notes={lead.notes}
              readout={{ value: lead.valueText || '–', label: 'people signed up', delta: leadDelta }}
              between={leadBetween}
              label={lead.label}
            />
          </div>
        ) : (
          <>
            {leadStatic}
            {leadBetween}
            {v.weeks === undefined ? <div className="ap-skel ap-skel-chart" aria-hidden="true" /> : null}
          </>
        )}
        {lead.caption && v.weeks ? <p className="ap-cp">{lead.caption}</p> : null}
      </section>

      <section className="ap-today">
        <div className="ap-tcell" data-testid="ap-signups-today">
          <span className="ap-kick">Signups today</span>
          {v.signups === undefined ? <b><span className="ap-skel ap-skel-num" aria-hidden="true" /></b> : (
            <>
              <b>{v.signups === null ? '–' : `${formatCount(today.signupsToday)}${today.capped ? '+' : ''}`}</b>
              {v.signups !== null && today.pace != null && <PaceBar frac={today.pace} />}
              {v.signups !== null && today.usual != null && <em>against a usual day: {formatCount(today.usual)}</em>}
            </>
          )}
        </div>
        <div className="ap-tcell" data-testid="ap-active-now">
          <span className="ap-kick">In the app now</span>
          <b>
            {v.active === undefined ? <span className="ap-skel ap-skel-num" aria-hidden="true" /> : dash(today.active)}
            {today.active > 0 && <i className="ap-live" aria-hidden="true" />}
          </b>
          <em>last 5 minutes</em>
        </div>
        <div className="ap-tcell" data-testid="ap-paying">
          <span className="ap-kick">Paying</span>
          <b>{v.moneyPeople === undefined ? <span className="ap-skel ap-skel-num" aria-hidden="true" /> : dash(today.paying)}</b>
          <em>{today.money || 'active subscriptions'}</em>
        </div>
      </section>

      <Section title="This week vs last" />
      <div className="ap-sms">
        {tiles.map((t) => (
          <button type="button" className="ap-sm" key={t.id} data-testid={`ap-row-${t.id}`} onClick={() => onSheet?.(t.id)}>
            <span className="ap-kick">{t.label}</span>
            {t.pending ? (
              <>
                <b><span className="ap-skel ap-skel-num" aria-hidden="true" /></b>
                <span className="ap-smd" />
              </>
            ) : (
              <>
                <b className={t.value === 'none' ? 'is-none' : undefined}>{t.value}</b>
                <span className="ap-smd">
                  <DeltaText delta={t.delta} />
                  {t.vs ? <small>{t.vs}</small> : null}
                </span>
                {t.spark ? <Spark vals={t.spark.vals} pct={t.spark.pct} dashedFlat={t.spark.dashedFlat} /> : null}
              </>
            )}
          </button>
        ))}
      </div>
      <p className="ap-cp">{TILES_CAPTION}</p>

      <Section title="Highlights" more="tap a figure to open it" />
      {/* 1 Search */}
      <Hold value={v.search} error={errors.search} onRetry={onRetry} h={260}>
        {searchOn && (
          <Figure
            n={nextFig()}
            topic="Search"
            title={search.head || 'Search'}
            dek={search.sub}
            note={searchBars.length > 1 ? search.caption : undefined}
            onOpen={() => onOpen?.('search')}
          >
            {searchBars.length > 1 && (
              <Bars
                bars={searchBars}
                h={160}
                refs={search.chart.refs}
                vrule={search.chart.vrule}
                xl={xlist(searchBars, [0, 7, 14, 21, searchBars.length - 1])}
                label={search.label}
              />
            )}
          </Figure>
        )}
      </Hold>
      {/* 2 Getting started */}
      <Hold value={v.growth} error={errors.growth} onRetry={onRetry} h={240}>
        {start.mode && (
          <Figure
            n={nextFig()}
            topic="Getting started"
            title={start.head}
            dek={start.dek}
            note={start.mode === 'rate' && start.homePts.length > 1 ? start.caption : undefined}
            onOpen={() => onSheet?.('activation_rate')}
          >
            {start.mode === 'rate' && start.homePts.length > 1 && (
              <WeekLine pts={start.homePts} h={150} isPct yMax={1} label={start.label} />
            )}
          </Figure>
        )}
      </Hold>
      {/* 3 Coming back */}
      <Hold value={v.ret} error={errors.ret} onRetry={onRetry} h={280}>
        {back.head && (
          <Figure
            n={nextFig()}
            topic="Coming back"
            title={back.head}
            dek={back.dek}
            note={back.items.some((i) => i.v != null) ? back.caption : undefined}
            onOpen={() => onOpen?.('growth')}
          >
            {back.items.some((i) => i.v != null) && <Lollipop items={back.items} yMax={back.yMax} label={back.label} />}
          </Figure>
        )}
      </Hold>
      {/* 4 Sharing */}
      <Hold value={v.sharing} error={errors.sharing} onRetry={onRetry} h={240}>
        {(share.head || share.bars.length > 0) && (
          <Figure
            n={nextFig()}
            topic="Sharing"
            title={share.head || 'Sharing'}
            dek={share.sub}
            note={share.bars.length > 0 ? share.caption : undefined}
            onOpen={() => onOpen?.('sharing')}
          >
            {share.bars.length > 0 && (
              <Bars
                bars={share.bars}
                h={140}
                maxBw={40}
                axis={false}
                xl={xlist(share.bars, share.bars.map((_, i) => i))}
                label={share.label}
              />
            )}
          </Figure>
        )}
      </Hold>

      <Section title="Where and when" />
      {/* 5 Sources */}
      <Hold value={v.acq30} error={errors.acq30} onRetry={onRetry} h={300}>
        {sources.items.length > 0 && (
          <Figure
            n={nextFig()}
            topic="Sources"
            title="Where signups came from"
            dek={sources.dek}
            note="First source of each new person, last 30 days."
            onOpen={() => onOpen?.('sources')}
          >
            <RankBars items={sources.items} total={sources.total} label={sources.label} />
          </Figure>
        )}
      </Hold>
      {/* 6 When people use it */}
      <Hold value={v.heatmap} error={errors.heatmap} onRetry={onRetry} h={240}>
        {heat.cells.length > 0 && (
          <Figure
            n={nextFig()}
            topic="Usage"
            title="When people use it"
            dek={heat.text}
            note="People in the app by hour, last 30 days, New York time. Outlined square: the busiest hour. Tap a square for the count."
          >
            <Heatmap cells={heat.cells} label={heat.label} />
          </Figure>
        )}
      </Hold>

      {newest.length > 0 && (
        <>
          <Section title="Newest signups" more="emails masked" />
          <div className="ap-card ap-who">
            {newest.map((p, i) => (
              <div key={p.id || i}>
                <span className="ap-wname">{p.who}</span>
                <span className="ap-when">{p.ago}</span>
                <span className="ap-wsrc">from {p.from}</span>
                <span className={`ap-wdid${p.did === 'nothing yet' ? ' none' : ''}`}>{p.did}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {look.length > 0 && (
        <>
          <Section title="Look at" />
          <aside className="ap-card ap-look">
            <h3 className="ap-kick">Needs a look</h3>
            {look.map((x) => {
              const inner = (
                <>
                  <span className={`ap-nn${x.warn ? ' ap-t-bad' : ''}`}>{formatCount(x.n)}</span>
                  <span className="lbl">{x.label}{x.sub ? <small>{x.sub}</small> : null}</span>
                  <Chev />
                </>
              );
              if (x.go === 'approvals') return <a key={x.key} href="/admin?tab=approvals&full=1">{inner}</a>;
              const go = x.go === 'boards' ? onBoards : () => onOpen?.(x.go);
              return <button key={x.key} type="button" onClick={go}>{inner}</button>;
            })}
          </aside>
        </>
      )}

      <Section title="Inside" />
      <div className="ap-card ap-idx">
        {inside.map((x) => (
          <button type="button" key={x.id} onClick={() => onOpen?.(x.id)}>
            <span className="ap-it">{x.label}</span>
            <span className="ap-dots" aria-hidden="true" />
            <span className="ap-iv">{x.text}</span>
            <Chev />
          </button>
        ))}
      </div>

      <div className="ap-foot">Team left out · pull down to refresh · <a href="/admin?full=1">full admin</a></div>
    </>
  );
}
