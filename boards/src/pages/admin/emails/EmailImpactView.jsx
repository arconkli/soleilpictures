// EmailImpactView — Emails › Impact: what each lifecycle email did, week by week.
//
// The owner's pick of 2026-10-20 ("Over time"), built to its mockup. Under a
// band of opens by month, four sections: opens per week for every email and for
// each one that sent on both sides of the split day, with what changed beside
// them; sends per week, with who then made something and the group held back;
// welcomes per 100 new accounts, which is how a stalled email shows; and Detail.
//
// Two changes from the mockup, both deliberate. Its chips (last 18 weeks,
// lifecycle mail, Soleil mail only) did nothing when pressed, so the page's
// conditions are in the status strip instead. And its figures were typed in:
// here each one is worked out from the read, so the record of what changed
// (lib/emailChanges.js) holds only words and days.
//
// One read, admin_email_impact (0494). Every sentence and coordinate comes from
// lib/emailImpact.js, which is where they are tested.

import { useCallback, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase.js';
import { useAdminData } from '../useAdminData.js';
import { AdminAsync, AdminSkeleton, AdminToolbar } from '../AdminStates.jsx';
import { Deck, Well, Plate } from '../viz/Well.jsx';
import { Detail } from '../viz/Detail.jsx';
import { glyphFor } from '../viz/markerGlyphs.js';
import { fmt, md } from '../../../lib/moneyView.js';
import { SPLIT_DAY } from '../../../lib/emailChanges.js';
import {
  BOX, CHANGE_KINDS, MARK_KIND, OPEN_H, OPEN_Y, SEND_H, SEND_Y, THIN_WEEK, WELCOME_H, WELCOME_Y,
  armRows, changesList, impactCalendar, lostRows, mailboxRows, monthsBand, openAria, openGeometry,
  openReading, openRows, openTip, opensFoot, pctText, pctX, rowMarks, sendAria, sendGeometry,
  sendGroups, sendReading, sendTip, sparkPath, weekRules, welcomeAria, welcomeFoot, welcomeGeometry,
  welcomeSeries, welcomeTip, windowText, xLabels,
} from '../../../lib/emailImpact.js';

const WEEKS = 18;
const KIND_WORD = { stop: 'stopped or paused', alert: 'alert', first: 'first time', due: 'due' };

const glyph = (kind) => glyphFor(MARK_KIND[kind]);
const yPct = (y, h) => `${Math.round((y / h) * 1000) / 10}%`;

export function EmailImpactView() {
  const q = useAdminData(async () => {
    const r = await supabase.rpc('admin_email_impact', { p_weeks: WEEKS, p_split: SPLIT_DAY });
    if (r.error) throw r.error;
    return r.data || null;
  }, [], { refetchOnFocus: true });

  const m = useMemo(() => {
    const raw = q.data;
    if (!raw || !Array.isArray(raw.weeks) || !raw.weeks.length) return null;
    const cal = impactCalendar(raw);
    const opens = openRows(raw);
    const sends = sendGroups(raw);
    const welcome = welcomeSeries(raw);
    return {
      raw,
      cal,
      band: monthsBand(raw),
      opens,
      sends,
      welcome,
      changes: changesList(raw, { opens, sends, welcome }),
      xl: xLabels(cal),
      rules: weekRules(cal),
    };
  }, [q.data]);

  // The change pointed at, in the list or on a chart: its line lights on every row.
  const [hm, setHm] = useState(null);

  return (
    <>
      <AdminToolbar onRefresh={q.refresh} refreshing={q.refreshing} lastUpdated={q.lastUpdated} />
      <div className="adm-status" role="note" aria-label="Current measurement conditions">
        {[
          ['MODE', 'weekly'],
          ['WINDOW', m ? windowText(m.raw) : `${WEEKS} wk UTC`],
          ['SENDS', 'the lifecycle log'],
          ['OPENS', 'tracking pixel, per delivered'],
          ['MADE SOMETHING', 'within 3 days of the send'],
          ['PEOPLE', 'team and banned left out'],
        ].map(([k, v]) => (
          <span className="adm-status-item" key={k}>
            <span className="adm-status-k">{k}</span>
            <span className="adm-status-v">{v}</span>
          </span>
        ))}
      </div>
      <AdminAsync
        loading={q.loading}
        error={q.error}
        hasData={q.hasData}
        onRetry={q.refresh}
        skeleton={<AdminSkeleton variant="chart" />}
        isEmpty={!m}
        empty={{ title: 'No lifecycle email in view', body: `Nothing in the lifecycle log for the last ${WEEKS} weeks.` }}
      >
        {m ? <Impact m={m} hm={hm} setHm={setHm} /> : null}
      </AdminAsync>
    </>
  );
}

function Impact({ m, hm, setHm }) {
  const { cal, band, opens, sends, welcome, changes } = m;
  const split = opens.split;
  const topPct = Math.round(opens.top * 100);
  return (
    <div className="adm-view adm-emails">
      <Deck>
        <Band band={band} next={changes.next} />
      </Deck>

      <h2 className="admin-section-title">Opens, week by week</h2>
      <div className="admin-section-sub">
        Opened per delivered, each UTC week, on one scale from 0 to {topPct}%.
        {split ? ` The dashed lines are the average before ${md(split)} and after it.` : ''}
        {' '}A hollow dot is a week with fewer than {THIN_WEEK} delivered.
      </div>
      <Deck>
        <OpensWell m={m} hm={hm} />
        <Changes changes={changes} hm={hm} setHm={setHm} />
      </Deck>

      <h2 className="admin-section-title">Sends, week by week, and who made something</h2>
      <div className="admin-section-sub">
        Every lifecycle email per UTC week. The green foot of a bar is the people who placed or edited
        a card, or edited a doc, within 3 days; the dashed part on top is the group held back. Each row has
        its own scale.
      </div>
      <Deck>
        <SendsWell m={m} hm={hm} groups={sends} />
      </Deck>

      <h2 className="admin-section-title">Is each email still going out?</h2>
      <div className="admin-section-sub">
        The welcome goes to a new account once one of their own clusters has a card in it, so it never
        reaches everyone. Read by the week people signed up, a stall shows as a gap that sending volume alone would hide.
      </div>
      <Deck>
        <WelcomePlate cal={cal} series={welcome} xl={m.xl} />
      </Deck>

      <h2 className="admin-section-title">Detail</h2>
      <Deck>
        <DetailPlate raw={m.raw} />
      </Deck>
    </div>
  );
}

// ── The band ────────────────────────────────────────────────────────────────

function Band({ band, next }) {
  return (
    <Well className="eml-band" aria-label="Opened per delivered, month by month">
      <div className="eml-ban">
        {band.head ? (
          <div>
            <div className="eml-ban-k">{band.head.k}</div>
            <div className="eml-ban-d">{band.head.value}<small>{band.head.of}</small></div>
          </div>
        ) : <div />}
        <div className="eml-ban-mid">
          {band.rows.map((r) => (
            <div className="eml-mo" key={r.key}>
              <div className="eml-mo-h"><span>{r.name}</span><b>{r.pct}</b></div>
              <div className="eml-mo-t" role="img" aria-label={r.aria}><i style={{ width: `${r.w}%` }} /></div>
              <span className="eml-mo-s">{r.n}</span>
            </div>
          ))}
        </div>
        {next ? (
          <div className="eml-ban-now"><b>{next.d}</b><span>{next.text}</span></div>
        ) : null}
      </div>
    </Well>
  );
}

// ── The week cursor ─────────────────────────────────────────────────────────
//
// A pointer reads a week by resting on it; a keyboard reads the same weeks with
// the arrows once the well has focus: left and right walk the weeks, up and down
// the rows. Both land in one state, so the card and the lit column are the same
// whichever way you got there.

function useWeekCursor(keys, n) {
  const [hov, setHov] = useState(null);
  const onKeyDown = useCallback((e) => {
    if (!keys.length || !n) return;
    const cur = hov || { k: keys[0], i: n - 1 };
    const r = Math.max(0, keys.indexOf(cur.k));
    let next = null;
    if (e.key === 'ArrowRight') next = { k: cur.k, i: Math.min(n - 1, cur.i + (hov ? 1 : 0)) };
    else if (e.key === 'ArrowLeft') next = { k: cur.k, i: Math.max(0, cur.i - (hov ? 1 : 0)) };
    else if (e.key === 'ArrowDown') next = { k: keys[Math.min(keys.length - 1, r + (hov ? 1 : 0))], i: cur.i };
    else if (e.key === 'ArrowUp') next = { k: keys[Math.max(0, r - (hov ? 1 : 0))], i: cur.i };
    else if (e.key === 'Home') next = { k: cur.k, i: 0 };
    else if (e.key === 'End') next = { k: cur.k, i: n - 1 };
    else if (e.key === 'Escape') { setHov(null); return; }
    if (!next) return;
    e.preventDefault();
    setHov(next);
  }, [hov, keys, n]);
  return { hov, setHov, onKeyDown, clear: () => setHov(null) };
}

function Tip({ tip }) {
  if (!tip) return null;
  return (
    <div className={`eml-tip is-${tip.side}`} style={{ left: `${tip.lx}%` }} aria-hidden="true">
      <div className="eml-tip-w">{tip.title}</div>
      <div className="eml-tip-v">{tip.value}{tip.of ? <small>{tip.of}</small> : null}</div>
      {tip.lines.map((l) => <div className="eml-tip-m" key={l}>{l}</div>)}
    </div>
  );
}

const tipWords = (tip) => (tip ? [tip.title, `${tip.value}${tip.of ? ` ${tip.of}` : ''}`, ...tip.lines].join('. ') : '');

/** The parts every row's plot shares: the week rules, the gridlines, the lit week, the change lines. */
function PlotFrame({ cal, rules, h, y, grid, marks, bands, hm, hi }) {
  const yTop = 6;
  return (
    <>
      {rules.map((x) => <line key={x} className="eml-rule" x1={x} x2={x} y1={yTop} y2={y.base} />)}
      {bands.map((b) => <rect key={b.key} className="eml-gap" x={b.x} y={yTop} width={b.w} height={y.base - yTop} rx="2" />)}
      {grid.map((gy, i) => (
        <line key={gy} className={i === grid.length - 1 ? 'eml-gl0' : 'eml-gl'} x1={BOX.X0} x2={BOX.X1} y1={gy} y2={gy} />
      ))}
      {hi != null ? <rect className="eml-hl" x={cal.left(hi) + 3} y="4" width={cal.slot - 6} height={h - 12} rx="3" /> : null}
      {marks.map((mk) => <line key={mk.key} className={`eml-mk${hm === mk.key ? ' is-on' : ''}`} x1={mk.x} x2={mk.x} y1={yTop} y2={y.base} />)}
      <line className="eml-pdiv" x1={cal.left(cal.n - 1)} x2={cal.left(cal.n - 1)} y1={yTop} y2={y.base} />
    </>
  );
}

function Glyphs({ marks, hm }) {
  return marks.filter((mk) => mk.glyph).map((mk) => (
    <span key={mk.key} className={`eml-glyph${hm === mk.key ? ' is-on' : ''}`} style={{ left: `${mk.lx}%`, top: '8%' }} aria-hidden="true">
      {glyph(mk.kind)}
    </span>
  ));
}

function Hits({ cal, h, onEnter }) {
  return Array.from({ length: cal.n }, (_, i) => (
    <rect key={i} className="eml-hit" x={cal.left(i)} y="0" width={cal.slot} height={h - 6} onMouseEnter={() => onEnter(i)} />
  ));
}

function XAxis({ xl }) {
  return (
    <div className="eml-xaxis">
      <div />
      <div className="eml-chw">
        {xl.map((t) => <span key={t.key} className={`eml-x${t.end ? ' is-end' : ''}`} style={{ left: `${t.lx}%` }}>{t.label}</span>)}
      </div>
    </div>
  );
}

// ── 01 · Opens ──────────────────────────────────────────────────────────────

function OpensWell({ m, hm }) {
  const { cal, opens, band, changes } = m;
  const groups = [
    { key: 'all', name: 'All lifecycle mail', head: band.sentence, rows: [opens.every] },
    ...(opens.each.length ? [{ key: 'each', name: 'By email', head: opens.head, rows: opens.each }] : []),
  ];
  const keys = groups.flatMap((g) => g.rows.map((r) => r.key));
  const cur = useWeekCursor(keys, cal.n);
  const foot = opensFoot(opens);
  const gapShown = changes.items.some((c) => c.until && c.types.length);
  const live = cur.hov ? (() => {
    const row = groups.flatMap((g) => g.rows).find((r) => r.key === cur.hov.k);
    return row ? tipWords(openTip(row, cal, cur.hov.i)) : '';
  })() : '';

  return (
    <Well
      span={8}
      className="eml-mult"
      title="Opened, per email"
      meta={opens.meta}
      foot={foot || null}
      tabIndex={0}
      role="group"
      aria-label="Opens per week. Arrow keys read each week; up and down change the email."
      onKeyDown={cur.onKeyDown}
      onBlur={cur.clear}
      onMouseLeave={cur.clear}
    >
      {groups.map((g, gi) => (
        <div className="eml-group" key={g.key}>
          <div className={`eml-grp${gi === 0 ? ' is-first' : ''}`}>
            {g.name}<span className="eml-grp-head">{g.head}</span>
          </div>
          {g.rows.map((row, ri) => (
            <OpenRow
              key={row.key}
              row={row}
              m={m}
              first={ri === 0}
              hm={hm}
              hi={cur.hov?.k === row.key ? cur.hov.i : null}
              onEnter={(i) => cur.setHov({ k: row.key, i })}
            />
          ))}
        </div>
      ))}
      <XAxis xl={m.xl} />
      <div className="eml-key">
        <span><i className="is-dot" />opened, that week</span>
        <span><i className="is-ring" />fewer than {THIN_WEEK} delivered</span>
        {opens.split ? <span><i className="is-dash" />average before and after {md(opens.split)}</span> : null}
        {gapShown ? <span><i className="is-gap" />no welcome emails</span> : null}
      </div>
      <div className="sr-only" aria-live="polite">{live}</div>
    </Well>
  );
}

function OpenRow({ row, m, first, hm, hi, onEnter }) {
  const { cal, opens, changes, rules } = m;
  const g = useMemo(() => openGeometry(row, cal, { top: opens.top, split: opens.split }), [row, cal, opens.top, opens.split]);
  const { marks, bands } = rowMarks(changes.items, cal, row.type, { first });
  const reading = openReading(row);
  const tip = hi != null ? openTip(row, cal, hi) : null;
  const top = opens.top === 1 ? '100%' : `${Math.round(opens.top * 100)}%`;
  const mid = `${Math.round(opens.top * 50)}%`;
  return (
    <div className="eml-row" data-row={row.key}>
      <div className="eml-lab">
        <span className="eml-name">{row.name}</span>
        <span className="eml-val">{reading.value}</span>
        <span className="eml-when">{reading.when}</span>
      </div>
      <div className="eml-chw">
        <svg viewBox={`0 0 ${BOX.W} ${OPEN_H}`} role="img" aria-label={openAria(row, cal)}>
          <PlotFrame cal={cal} rules={rules} h={OPEN_H} y={OPEN_Y} grid={[OPEN_Y.top, OPEN_Y.mid, OPEN_Y.base]} marks={marks} bands={bands} hm={hm} hi={hi} />
          {g.means.map((q) => <line key={q.key} className="eml-mean" x1={q.x1} x2={q.x2} y1={q.y} y2={q.y} />)}
          {g.paths.map((d) => <path key={d} className="eml-ln" d={d} />)}
          {g.dots.map((d) => (
            <circle key={d.i} className={`eml-dot${d.thin ? ' is-thin' : ''}${hi === d.i ? ' is-on' : ''}`} cx={d.x} cy={d.y} r={d.thin ? 3.5 : 4.5} />
          ))}
          <Hits cal={cal} h={OPEN_H} onEnter={onEnter} />
        </svg>
        <span className="eml-y" style={{ left: `${pctX(BOX.X0)}%`, top: yPct(OPEN_Y.top, OPEN_H) }}>{top}</span>
        <span className="eml-y" style={{ left: `${pctX(BOX.X0)}%`, top: yPct(OPEN_Y.mid, OPEN_H) }}>{mid}</span>
        <span className="eml-y" style={{ left: `${pctX(BOX.X0)}%`, top: yPct(OPEN_Y.base, OPEN_H) }}>0</span>
        {g.means.map((q) => (
          <span key={q.key} className="eml-ml" style={{ left: `${q.label.lx}%`, top: `${q.label.ly}%` }}>{q.label.t}</span>
        ))}
        <Glyphs marks={marks} hm={hm} />
        {bands.map((b) => (
          <span key={b.key} className="eml-gap-t" style={{ left: `${b.lx}%`, top: '74%' }}>none sent</span>
        ))}
        <Tip tip={tip} />
      </div>
    </div>
  );
}

// ── What changed ────────────────────────────────────────────────────────────

function Changes({ changes, hm, setHm }) {
  return (
    <Plate span={4} className="adm-gb-changes eml-changes" title="What changed" meta={changes.meta}>
      <div className="adm-gb-glyphkey">
        {CHANGE_KINDS.map((k) => <span key={k.kind}><span aria-hidden="true">{glyph(k.kind)}</span> {k.label}</span>)}
      </div>
      {!changes.items.length ? <div className="admin-empty">Nothing recorded in these weeks.</div> : (
        <ul className="adm-markers-list">
          {changes.items.map((it) => (
            <li
              key={it.key}
              className={`adm-marker-row eml-chg${hm === it.key ? ' is-on' : ''}${it.next ? ' is-next' : ''}`}
              tabIndex={it.next ? undefined : 0}
              onPointerEnter={it.next ? undefined : () => setHm(it.key)}
              onPointerLeave={it.next ? undefined : () => setHm(null)}
              onFocus={it.next ? undefined : () => setHm(it.key)}
              onBlur={it.next ? undefined : () => setHm(null)}
            >
              <span className="sr-only">{KIND_WORD[it.kind] || it.kind}</span>
              <span className="adm-marker-g" aria-hidden="true">{glyph(it.kind)}</span>
              <span className="adm-marker-d">{it.d}</span>
              <span className="adm-marker-l">
                {it.label}
                {it.sub ? <small className="eml-chg-sub">{it.sub}</small> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Plate>
  );
}

// ── 02 · Sends ──────────────────────────────────────────────────────────────

function SendsWell({ m, hm, groups }) {
  const { cal } = m;
  const keys = groups.flatMap((g) => g.rows.map((r) => r.key));
  const cur = useWeekCursor(keys, cal.n);
  const anyHeld = groups.some((g) => g.rows.some((r) => r.heldTotal > 0));
  const live = cur.hov ? (() => {
    const row = groups.flatMap((g) => g.rows).find((r) => r.key === cur.hov.k);
    return row ? tipWords(sendTip(row, cal, cur.hov.i)) : '';
  })() : '';
  return (
    <Well
      className="eml-mult"
      title="Sent per week"
      meta={`${fmt(cal.n)} weeks · this week so far drawn hollow`}
      tabIndex={0}
      role="group"
      aria-label="Sends per week. Arrow keys read each week; up and down change the email."
      onKeyDown={cur.onKeyDown}
      onBlur={cur.clear}
      onMouseLeave={cur.clear}
    >
      {groups.map((g, gi) => (
        <div className="eml-group" key={g.key}>
          <div className={`eml-grp${gi === 0 ? ' is-first' : ''}`}>
            {g.name}<span className="eml-grp-head">{g.head}</span>
          </div>
          {g.rows.map((row, ri) => (
            <SendRow
              key={row.key}
              row={row}
              m={m}
              first={ri === 0}
              hm={hm}
              hi={cur.hov?.k === row.key ? cur.hov.i : null}
              onEnter={(i) => cur.setHov({ k: row.key, i })}
            />
          ))}
        </div>
      ))}
      <XAxis xl={m.xl} />
      <div className="eml-key">
        <span><i className="is-sent" />sent</span>
        <span><i className="is-made" />made something within 3 days</span>
        {anyHeld ? <span><i className="is-held" />held back</span> : null}
        <span><i className="is-hollow" />this week so far</span>
      </div>
      <div className="sr-only" aria-live="polite">{live}</div>
    </Well>
  );
}

function SendRow({ row, m, first, hm, hi, onEnter }) {
  const { cal, changes, rules } = m;
  const g = useMemo(() => sendGeometry(row, cal), [row, cal]);
  const { marks, bands } = rowMarks(changes.items, cal, row.type, { first });
  const reading = sendReading(row, cal);
  const tip = hi != null ? sendTip(row, cal, hi) : null;
  return (
    <div className="eml-row" data-row={row.key}>
      <div className="eml-lab">
        <span className="eml-name">{row.name}</span>
        <span className="eml-val">{reading.value}<small>{reading.unit}</small></span>
        <span className="eml-when">{reading.when}</span>
        {reading.held ? <span className="eml-when">{reading.held}</span> : null}
        {reading.last ? <span className="eml-when">{reading.last}</span> : null}
      </div>
      <div className="eml-chw">
        <svg viewBox={`0 0 ${BOX.W} ${SEND_H}`} role="img" aria-label={sendAria(row, cal)}>
          <PlotFrame cal={cal} rules={rules} h={SEND_H} y={SEND_Y} grid={[SEND_Y.top, SEND_Y.base]} marks={marks} bands={bands} hm={hm} hi={hi} />
          {g.bars.map((b) => (b.d ? <path key={b.key} className={`eml-bar is-${b.tone}`} d={b.d} /> : null))}
          <Hits cal={cal} h={SEND_H} onEnter={onEnter} />
        </svg>
        <span className="eml-y" style={{ left: `${pctX(BOX.X0)}%`, top: yPct(SEND_Y.top, SEND_H) }}>{fmt(row.max)}</span>
        <span className="eml-y" style={{ left: `${pctX(BOX.X0)}%`, top: yPct(SEND_Y.base, SEND_H) }}>0</span>
        <Glyphs marks={marks} hm={hm} />
        <Tip tip={tip} />
      </div>
    </div>
  );
}

// ── 03 · Welcomes per 100 new accounts ──────────────────────────────────────

function WelcomePlate({ cal, series, xl }) {
  const [hi, setHi] = useState(null);
  const g = useMemo(() => welcomeGeometry(series, cal), [series, cal]);
  const foot = welcomeFoot(series);
  const tip = hi != null ? welcomeTip(series, cal, hi) : null;
  const shown = series.weeks.filter((w) => !w.before);
  const onKeyDown = (e) => {
    if (!shown.length) return;
    const lo = shown[0].i;
    const hiMax = cal.n - 1;
    let next = null;
    if (e.key === 'ArrowRight') next = hi == null ? hiMax : Math.min(hiMax, hi + 1);
    else if (e.key === 'ArrowLeft') next = hi == null ? hiMax : Math.max(lo, hi - 1);
    else if (e.key === 'Home') next = lo;
    else if (e.key === 'End') next = hiMax;
    else if (e.key === 'Escape') { setHi(null); return; }
    if (next == null) return;
    e.preventDefault();
    setHi(next);
  };
  return (
    <Plate
      className="eml-go-plate"
      title="Welcomes per 100 new accounts, by sign-up week"
      meta="team excluded"
      foot={foot.strong || foot.rest ? <>{foot.strong ? <b>{foot.strong}</b> : null}{foot.rest}</> : null}
    >
      {!shown.length ? <div className="admin-empty">No welcome emails in these weeks.</div> : (
        <>
          <div
            className="eml-go"
            tabIndex={0}
            role="group"
            aria-label="Welcomes per sign-up week. Left and right arrows read each week."
            onKeyDown={onKeyDown}
            onBlur={() => setHi(null)}
            onMouseLeave={() => setHi(null)}
          >
            <div className="eml-lab">
              <span className="eml-name">Welcome</span>
              <span className="eml-val">{series.reading.value}<small>{series.reading.unit}</small></span>
              <span className="eml-when">{series.reading.when}</span>
            </div>
            <div className="eml-chw">
              <svg viewBox={`0 0 ${BOX.W} ${WELCOME_H}`} role="img" aria-label={welcomeAria(series, cal)}>
                {[WELCOME_Y.top, WELCOME_Y.mid, WELCOME_Y.base].map((y, i) => (
                  <line key={y} className={i === 2 ? 'eml-gl0' : 'eml-gl'} x1={BOX.X0} x2={BOX.X1} y1={y} y2={y} />
                ))}
                {g.ref ? <line className="eml-ref" x1={BOX.X0} x2={BOX.X1} y1={g.ref.y} y2={g.ref.y} /> : null}
                {hi != null ? <rect className="eml-hl" x={cal.left(hi) + 3} y="4" width={cal.slot - 6} height={WELCOME_H - 10} rx="3" /> : null}
                {g.bars.map((b) => (b.d ? <path key={b.key} className={`eml-wbar is-${b.tone}`} d={b.d} /> : null))}
                {shown.map((w) => (
                  <rect key={w.i} className="eml-hit" x={cal.left(w.i)} y="0" width={cal.slot} height={WELCOME_H - 6} onMouseEnter={() => setHi(w.i)} />
                ))}
              </svg>
              <span className="eml-y" style={{ left: `${pctX(BOX.X0)}%`, top: yPct(WELCOME_Y.top, WELCOME_H) }}>100</span>
              <span className="eml-y" style={{ left: `${pctX(BOX.X0)}%`, top: yPct(WELCOME_Y.mid, WELCOME_H) }}>50</span>
              <span className="eml-y" style={{ left: `${pctX(BOX.X0)}%`, top: yPct(WELCOME_Y.base, WELCOME_H) }}>0</span>
              {g.stall ? <span className="eml-zl" style={{ left: `${g.stall.lx}%`, top: `${g.stall.ly}%` }}>{g.stall.label}</span> : null}
              {g.ref ? <span className="eml-rl" style={{ top: `${g.ref.ly}%` }}>{g.ref.label}</span> : null}
              <Tip tip={tip} />
            </div>
          </div>
          <XAxis xl={xl} />
          <div className="sr-only" aria-live="polite">{tipWords(tip)}</div>
        </>
      )}
    </Plate>
  );
}

// ── 04 · Detail ─────────────────────────────────────────────────────────────

function DetailPlate({ raw }) {
  const mail = mailboxRows(raw);
  const lost = lostRows(raw);
  const arms = armRows(raw);
  const splitMd = md(raw?.split);
  return (
    <Plate className="adm-email-details">
      <Detail id="emails.mailbox" label="Opens by mailbox, week by week" sub="Gmail, Outlook, iCloud and the rest, to see where the drop sits" count={mail.count}>
        <MailboxTable rows={mail.rows} split={splitMd} />
      </Detail>
      <Detail id="emails.lost" label="Sends that never arrived" sub="failed on our side, bounced, or no delivery report, by email and reason" count={lost.count}>
        <LostTable rows={lost.rows} />
      </Detail>
      <Detail id="emails.arms" label="Every subject and body test" sub="each line's sends, opens and returns since it started" count={arms.count}>
        <ArmTable rows={arms.rows} />
      </Detail>
    </Plate>
  );
}

function Spark({ weeks }) {
  const s = sparkPath(weeks, { top: 1 });
  return (
    <svg className="eml-spark" viewBox="0 0 120 22" role="img" aria-label={`opened each week: ${weeks.map((w) => (w.delivered ? pctText(w.opened / w.delivered) : 'none')).join(', ')}`}>
      <line className="eml-spark-base" x1="0" x2="120" y1="20" y2="20" />
      {s.d ? <path className="eml-spark-ln" d={s.d} /> : null}
      {s.dots.map((d) => <circle key={d.i} className={`eml-spark-dot${d.thin ? ' is-thin' : ''}`} cx={d.x} cy={d.y} r="1.8" />)}
    </svg>
  );
}

function MailboxTable({ rows, split }) {
  if (!rows.length) return <div className="admin-empty">Nothing delivered in these weeks.</div>;
  return (
    <>
      <div className="mny-tblbox">
        <table className="mny-tbl">
          <thead>
            <tr>
              <th className="is-l">Mailbox</th><th>Delivered</th><th>Opened</th>
              {split ? <><th>Before {split}</th><th>After</th></> : null}
              <th className="is-l">Each week, 0 to 100%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="mny-nm is-l">{r.name}</td>
                <td>{fmt(r.delivered)}</td>
                <td>{pctText(r.rate)}</td>
                {split ? (
                  <>
                    <td className={r.before == null ? 'is-dim' : ''}>{pctText(r.before)}<small className="eml-n">{r.beforeN != null ? fmt(r.beforeN) : ''}</small></td>
                    <td className={r.after == null ? 'is-dim' : ''}>{pctText(r.after)}<small className="eml-n">{r.afterN != null ? fmt(r.afterN) : ''}</small></td>
                  </>
                ) : null}
                <td className="is-l"><Spark weeks={r.weeks} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="eml-note">
        An open is the tracking pixel loading. Apple Mail’s privacy protection loads it for people who never read
        the email, so a mailbox read mostly in Apple Mail shows opens that were not reads. The small figure beside a
        rate is how many it divides.
      </p>
    </>
  );
}

function LostTable({ rows }) {
  if (!rows.length) return <div className="admin-empty">Every send in these weeks arrived.</div>;
  return (
    <div className="mny-tblbox">
      <table className="mny-tbl">
        <thead>
          <tr><th className="is-l">Email</th><th className="is-l">Why</th><th>Sends</th><th className="is-l">Each week</th><th className="is-l">Last</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="mny-nm is-l">{r.name}</td>
              <td className="is-l">{r.reason}</td>
              <td>{fmt(r.n)}</td>
              <td className="is-l">
                <svg className="eml-spark" viewBox="0 0 120 22" role="img" aria-label={`each week: ${r.byWeek.join(', ')}`}>
                  <line className="eml-spark-base" x1="0" x2="120" y1="21" y2="21" />
                  {r.byWeek.map((v, i) => (v > 0 ? (
                    <rect key={i} className="eml-spark-bar" x={(i * 120) / r.byWeek.length + 1} width={120 / r.byWeek.length - 2}
                      y={21 - Math.max(2, (v / r.max) * 19)} height={Math.max(2, (v / r.max) * 19)} rx="1" />
                  ) : null))}
                </svg>
              </td>
              <td className="is-l is-dim">{r.last}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RateCell({ v }) {
  return (
    <td className={v.r == null ? 'is-dim' : ''}>
      {pctText(v.r)}<small className="eml-n">{fmt(v.n)}</small>
    </td>
  );
}

function ArmTable({ rows }) {
  if (!rows.length) return <div className="admin-empty">No subject or body line under test in these weeks.</div>;
  return (
    <div className="mny-tblbox">
      <table className="mny-tbl">
        <thead>
          <tr>
            <th className="is-l">Email</th><th className="is-l">Line</th><th>Sends</th><th>Opened</th><th>Clicked</th>
            <th>Back in a day</th><th>Made something</th><th className="is-l">Ran</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            // The email is named once, on its first line.
            const firstOfEmail = i === 0 || rows[i - 1].type !== r.type;
            return (
              <tr key={r.key} className={firstOfEmail ? 'eml-arm-first' : undefined}>
                <td className={`mny-nm is-l${firstOfEmail ? '' : ' is-dim'}`}>{firstOfEmail ? r.name : ''}</td>
                <td className="is-l">{r.factor} <span className="mny-mini">{r.arm}</span></td>
                <td>{fmt(r.sends)}</td>
                <RateCell v={r.opened} />
                <RateCell v={r.clicked} />
                <RateCell v={r.back} />
                <RateCell v={r.made} />
                <td className={`is-l${r.live ? '' : ' is-dim'}`}>{r.ran}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
