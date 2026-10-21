// MoneyView — Analytics › Money: from the price to a payment.
//
// The owner's pick of 2026-10-20 ("The path to a payment"), built to its
// mockup with one deliberate change. The mockup's path ran "Saw a price →
// Clicked to upgrade → Pressed Start trial", but a press of Start trial can
// come through the cap wall from someone who never pressed an Upgrade button.
// So the path here is nested (each step counts people who reached it and
// every step before it) and how people got to the plans is a line under it,
// never a step.
//
// Five sections, top to bottom: the money right now, the path with what people
// did with the offer beside it, every place the offer opens with the running
// trials, everyone who has hit the cap, and Detail, which is what Funnel's
// "Checkout, upsell and the biggest accounts" used to hold.
//
// The window is not the range control: everything reads from the first price
// shown (admin_money_path's `since`), so the control is hidden here as it is
// on Overview, and Detail is asked for the same span in days.
//
// Reads, each failing on its own: admin_money_path (the key one; without it
// there is no page), admin_money_people, admin_trial_funnel, then
// admin_conversion_funnel and admin_checkout_reliability from the same first
// day. Revenue is admin_stats' mrr_cents, which the shell already polls. A
// failed read leaves its panel saying so, never a zero. Every sentence and
// coordinate comes from lib/moneyView.js, which is where they are tested.

import { useCallback, useMemo, useState } from 'react';
import { supabase } from '../../../../lib/supabase.js';
import { useAdminData } from '../../useAdminData.js';
import { AdminAsync, AdminSkeleton } from '../../AdminStates.jsx';
import { useAnalyticsFilters, useRegisterViewRuntime, POLL_MS } from '../AnalyticsFiltersContext.jsx';
import { Deck, Well, Plate } from '../../viz/Well.jsx';
import { Detail } from '../../viz/Detail.jsx';
import {
  CLOSE_METHODS, PATH_BOX, capRow, checkoutFoot, fmt, leakText, md, moneySteps, moneyTiles, offerRows,
  pathGeometry, pathList, pathTip, placementRows, placementsFoot, reasonRows, routesLine, sinceDays,
  trialCard, trialOnButtonRows,
} from '../../../../lib/moneyView.js';
import { CREATOR_TRIAL_DAYS, PLAN_NAME, PRICING } from '../../../../lib/billingCopy.js';
import { DEMO_CARD_LIMIT } from '../../../../lib/demoCardCap.js';
import { UpsellBehaviorPanel } from '../widgets/UpsellBehaviorPanel.jsx';
import { PaidReachTable } from '../widgets/PaidReachTable.jsx';
import { AdminEventBreakdown } from '../../AdminEventBreakdown.jsx';
import { AdminTopUsersList } from '../../AdminTopUsersList.jsx';

const CAP_ROWS_SHOWN = 12;
// The opacities of the close methods in the offer's bar, in CLOSE_METHODS order.
const CLOSE_OPACITY = [1, 0.62, 0.42, 0.3, 0.22];

const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
const errOf = (r) => (r.status === 'rejected' ? r.reason : r.value?.error) || null;

export function MoneyView() {
  const f = useAnalyticsFilters();

  const q = useAdminData(async () => {
    const args = { p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly };
    const [mp, pp, tf] = await Promise.allSettled([
      supabase.rpc('admin_money_path', args),
      supabase.rpc('admin_money_people', args),
      supabase.rpc('admin_trial_funnel', args),
    ]);
    if (mp.status !== 'fulfilled' || mp.value.error) throw errOf(mp) || new Error('Failed to load the money path');
    const path = mp.value.data || null;
    // The first price shown, as a UTC day: the placements and the checkout
    // read start there too, so every section counts the same span.
    const since = typeof path?.since === 'string' ? path.since.slice(0, 10) : null;
    const days = sinceDays(path);
    const [cf, cr] = await Promise.allSettled([
      supabase.rpc('admin_conversion_funnel', since
        ? { p_since: since, p_exclude_internal: f.excludeInternal }
        : { p_exclude_internal: f.excludeInternal }),
      supabase.rpc('admin_checkout_reliability', { p_days: days || 30, p_exclude_internal: f.excludeInternal }),
    ]);
    return {
      path,
      people: val(pp),
      trialRows: val(tf),
      placements: val(cf),
      reliability: val(cr),
      since,
      days,
    };
  }, [f.excludeInternal, f.verifiedOnly], { pollIntervalMs: POLL_MS.money, refetchOnFocus: true });

  useRegisterViewRuntime({
    refresh: q.refresh, lastUpdated: q.lastUpdated, refreshing: q.refreshing,
    status: q.data?.since ? { since: q.data.since } : null,
  });

  const d = q.data;
  const team = f.excludeInternal ? 'team excluded' : 'team included';

  return (
    <AdminAsync loading={q.loading} error={q.error} hasData={q.hasData} onRetry={q.refresh} skeleton={<AdminSkeleton variant="chart" />}>
      <div className="adm-view adm-money">
        <h2 className="admin-section-title">Money right now</h2>
        <Deck>
          <MoneyNow stats={f.stats} people={d?.people} trialRows={d?.trialRows} team={team} />
        </Deck>

        <h2 className="admin-section-title">From the price to a payment</h2>
        <div className="admin-section-sub">
          Everyone signed in since {md(d?.since) || 'the first price'}, {team}. Each step counts the people
          who reached it and every step before it, so it never goes up.
        </div>
        <Deck>
          <MoneyPath path={d?.path} reliability={d?.reliability} since={d?.since} />
          <OfferPlate offer={d?.path?.offer} />
        </Deck>

        <h2 className="admin-section-title">Where people see the price</h2>
        <Deck>
          <Placements rows={d?.placements} since={d?.since} team={team} />
          <Trials trials={d?.people ? d.people.trials || [] : null} />
        </Deck>

        <h2 className="admin-section-title">Everyone who has hit the cap</h2>
        <CapHits capHits={d?.people?.cap_hits} failed={!!d && !d.people} />

        <h2 className="admin-section-title">Detail</h2>
        <Deck>
          <Plate className="adm-money-details">
            <Detail
              id="money.offer"
              label="How each offer is seen and closed"
              sub="the upsell scorecard and every exposure, moved here from Funnel"
              count={d?.path?.offer ? `${fmt(d.path.offer.times)} exposures` : null}
            >
              <LazyOffer days={d?.days} f={f} />
            </Detail>
            <Detail
              id="money.checkout"
              label="Checkout reliability"
              sub="success pages, stalls, failed checks and support clicks"
              count={d?.reliability ? `${fmt(d.reliability.activated)} activated · ${fmt(d.reliability.verify_failed)} failed · ${fmt(d.days)} days` : null}
            >
              {d?.reliability
                ? <AdminEventBreakdown rows={[]} reliability={d.reliability} days={d.days} />
                : <div className="admin-empty">The checkout read did not answer.</div>}
            </Detail>
            <Detail
              id="money.reach"
              label="Who has seen the price"
              sub="by what they built, since the waitlist came off: the panel the price changes are graded on"
            >
              <LazyReach f={f} />
            </Detail>
            <Detail id="money.accounts" label="The biggest accounts" sub="who holds the most cards, free and on the paid tier" count="top 20 of each">
              <LazyAccounts f={f} />
            </Detail>
            <Detail id="money.events" label="The events behind these numbers" sub="every branch and failure signal, in sessions">
              <LazyEvents days={d?.days} f={f} />
            </Detail>
          </Plate>
        </Deck>
      </div>
    </AdminAsync>
  );
}

// ── 01 · Money right now ────────────────────────────────────────────────────

function MoneyNow({ stats, people, trialRows, team }) {
  const tiles = moneyTiles({ stats, people, trialRows });
  return (
    <Well className="adm-money-now" aria-label="Money right now">
      <div className="mny-tiles">
        {tiles.map((t) => (
          <div className="mny-tile" key={t.key} data-tile={t.key}>
            <span className="mny-t-label">{t.label}</span>
            <div className="mny-t-row">
              <span className={`mny-t-val${t.zero ? ' is-zero' : ''}`}>{t.value}</span>
              <span className="mny-t-total">{t.total}</span>
            </div>
            <span className="mny-t-sub">{t.sub}</span>
            {t.verdict ? <span className="mny-t-verdict">{t.verdict}</span> : null}
            {t.ratio ? (
              <div className="mny-t-ratio">
                <div className="mny-track"><div className="mny-fill" style={{ width: `${t.ratio.pct}%` }} /></div>
                <span>{t.ratio.label}</span>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div className="mny-life">
        <dl>
          <div><dt>{PLAN_NAME}</dt><dd>{PRICING.monthly.perMonthLabel}<small>a month</small></dd></div>
          <div><dt>or</dt><dd>${PRICING.annual.billed}<small>a year</small></dd></div>
          <div><dt>Free trial</dt><dd>{CREATOR_TRIAL_DAYS}<small>days</small></dd></div>
          <div><dt>Free plan</dt><dd>{DEMO_CARD_LIMIT}<small>cards, more for older accounts and invites</small></dd></div>
        </dl>
        <span className="mny-scope">money from Stripe · people {team}</span>
      </div>
    </Well>
  );
}

// ── 02 · The path ───────────────────────────────────────────────────────────

function MoneyPath({ path, reliability, since }) {
  const [hov, setHov] = useState(null);
  const steps = useMemo(() => moneySteps(path), [path]);
  const g = useMemo(() => pathGeometry(steps, { hov }), [steps, hov]);
  const tip = pathTip(steps, hov);
  const leak = leakText(steps, path);
  const routes = routesLine(path);
  const foot = checkoutFoot(steps, path, reliability);
  const list = pathList(steps);

  const onKey = useCallback((e) => {
    if (!steps.length) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setHov((h) => {
        if (h == null) return e.key === 'ArrowRight' ? 0 : steps.length - 1;
        return Math.max(0, Math.min(steps.length - 1, h + (e.key === 'ArrowRight' ? 1 : -1)));
      });
    } else if (e.key === 'Escape') setHov(null);
  }, [steps.length]);

  const aria = `From seeing a price to paying, in people since ${md(since)}: `
    + `${steps.map((s) => `${s.label} ${fmt(s.n)}`).join(', ')}.`;

  return (
    <Well
      span={8}
      className="adm-money-pathwell"
      title="The path, in people"
      meta={`since ${md(since)} · hover a step for what it counts`}
      foot={(
        <>
          {foot.lead} {foot.claim} {foot.facts ? <b>{foot.facts}</b> : null}
        </>
      )}
      onMouseLeave={() => setHov(null)}
    >
      {!g ? <div className="admin-empty">Nobody has seen a price yet.</div> : (
        <>
          <div
            className="mny-path"
            tabIndex={0}
            role="group"
            aria-label="The path. Left and right arrows read each step."
            onKeyDown={onKey}
            onBlur={() => setHov(null)}
          >
            <svg viewBox={`0 0 ${PATH_BOX.W} ${PATH_BOX.H}`} role="img" aria-label={aria}>
              <defs>
                {/* The well is dark in both themes, so the hatch is one fixed ink. */}
                <pattern id="adm-mny-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="1.5" height="5" fill="rgba(255,255,255,0.12)" />
                </pattern>
              </defs>
              {g.hl ? <rect className="mny-hl" x={g.hl.x} y="0" width={g.hl.w} height={PATH_BOX.H} rx="6" /> : null}
              {g.ribs.map((r, i) => (
                <g key={i}>
                  <path className="mny-rib" d={r.d} />
                  {r.lost ? <path className="mny-lost" d={r.lost} fill="url(#adm-mny-hatch)" /> : null}
                </g>
              ))}
              <line className="mny-base" x1="0" x2={PATH_BOX.W} y1={PATH_BOX.base} y2={PATH_BOX.base} />
              {g.bars.map((b) => (b.d ? <path key={b.key} className={`mny-bar${b.dim ? ' is-dim' : ''}`} d={b.d} /> : null))}
              {g.zeros.map((z) => <path key={z} className="mny-zero" d={z} />)}
              {g.leak?.leader ? <path className="mny-ldr" d={g.leak.leader} /> : null}
              {g.hits.map((h, i) => (
                <rect
                  key={i}
                  className="mny-hit"
                  x={h.x}
                  y="0"
                  width={h.w}
                  height={PATH_BOX.H}
                  onMouseEnter={() => setHov(i)}
                />
              ))}
            </svg>
            {g.nums.map((t, i) => (
              <span key={`n${i}`} className={`mny-num${t.zero ? ' is-zero' : ''}`} style={{ left: `${t.lx}%`, top: `${t.ly}%` }}>{t.label}</span>
            ))}
            {g.labs.map((t, i) => (
              <span key={`l${i}`} className="mny-lab" style={{ left: `${t.lx}%`, top: `${t.ly}%`, width: `${g.labWidth}%` }}>
                {t.label}<small>{t.note}</small>
              </span>
            ))}
            {g.convs.map((t, i) => (
              <span key={`c${i}`} className="mny-conv" style={{ left: `${t.lx}%`, top: `${t.ly}%` }}>{t.label}</span>
            ))}
            {leak && g.leak && g.leak.mode !== 'under' ? (
              <span className={`mny-leak is-${g.leak.mode}`} style={{ left: `${g.leak.lx}%`, top: `${g.leak.ly}%` }}>
                <b>{leak.title}</b>
                <span>{leak.body}</span>
              </span>
            ) : null}
            {tip ? (
              <div className={`mny-tip is-${tip.side}`} style={{ left: `${tip.lx}%` }} aria-hidden="true">
                <div className="mny-tip-w">{tip.title}</div>
                <div className="mny-tip-v">{tip.value}<small>{tip.of}</small></div>
                <div className="mny-tip-m">{tip.def}</div>
              </div>
            ) : null}
            <div className="mny-plist">
              {list.map((s) => (
                <div className="mny-pl" key={s.key}>
                  <span className="mny-nm">{s.label}</span>
                  <span className="mny-v">{s.n}</span>
                  <span className="mny-tk"><i style={{ width: `${s.pct}%` }} /></span>
                  <span className="mny-cv">{s.conv}</span>
                </div>
              ))}
            </div>
            {/* Under the chart when the callout has no room in it, and always
                under the list a narrow box draws instead. */}
            {leak ? (
              <p className={`mny-leak-under${g.leak?.mode === 'under' ? ' is-on' : ''}`}>
                <b>{leak.title}</b> {leak.body}
              </p>
            ) : null}
            <div className="sr-only" aria-live="polite">
              {tip ? `${tip.title}: ${tip.value} ${tip.of}. ${tip.def}` : ''}
            </div>
          </div>
          {routes ? (
            <p className="mny-routes">
              <span className="mny-routes-k">How they reached the plans</span>
              {routes.parts.map((p) => (
                <span key={p.key} className="mny-route">
                  {p.label} <b>{fmt(p.people)}</b>
                  {' → '}
                  {p.pressed ? <b>{fmt(p.pressed)} pressed</b> : 'none pressed'}
                </span>
              ))}
              {routes.both ? <span className="mny-route">{fmt(routes.both)} came both ways</span> : null}
            </p>
          ) : null}
        </>
      )}
    </Well>
  );
}

// ── 02 · What they did with the offer ───────────────────────────────────────

function OrowList({ rows, on = false }) {
  return (
    <div className="mny-orows">
      {rows.map((o) => (
        <div className={`mny-orow${o.on || on ? ' is-on' : ''}`} key={o.key}>
          <span className="mny-nm">{o.label}{o.note ? <small>{o.note}</small> : null}</span>
          <span className="mny-v">{o.times ?? o.value}{o.unit ? <small>{o.unit}</small> : null}</span>
          <span className="mny-tk">
            {(o.segs || [{ cls: '', pct: o.pct, title: o.value }]).map((s, i) => (
              <i key={i} className={s.cls || undefined} style={{ width: `${s.pct}%` }} title={s.title} />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

function OfferPlate({ offer }) {
  const rows = offerRows(offer);
  const trial = trialOnButtonRows(offer?.trial_on_button);
  const why = reasonRows(offer?.reasons);
  return (
    <Plate
      span={4}
      className="adm-money-offer"
      title="What they did with the offer"
      meta={offer ? `since ${md(offer.since)} · ${fmt(offer.times)} times` : null}
    >
      {!rows.length ? <div className="admin-empty">Nobody has closed or taken the offer yet.</div> : (
        <>
          <OrowList rows={rows} />
          <div className="mny-keyline">
            {CLOSE_METHODS.map((m, i) => (
              <span key={m.key}><i style={{ opacity: CLOSE_OPACITY[i] }} />{m.label}</span>
            ))}
          </div>
        </>
      )}
      {trial.length ? (
        <>
          <div className="mny-subhead">
            <span className="adm-well-title">Free trial on the button</span>
            <span className="adm-well-meta">since {md(offer.trial_on_button.since)}</span>
          </div>
          <OrowList rows={trial} on />
        </>
      ) : null}
      {why.length ? (
        <>
          <div className="mny-subhead">
            <span className="adm-well-title">Asked why not</span>
            <span className="adm-well-meta">
              since {md(offer.reasons.since)} · {fmt(offer.reasons.answered)} of {fmt(offer.reasons.shown)} answered
            </span>
          </div>
          <OrowList rows={why} />
        </>
      ) : null}
    </Plate>
  );
}

// ── 03 · Every place the offer opens ────────────────────────────────────────

function Placements({ rows, since, team }) {
  const list = placementRows(rows);
  const foot = placementsFoot(rows);
  const cell = (v, yes) => (v == null ? <td className="is-dim">—</td> : <td className={v ? (yes ? 'is-yes' : '') : 'is-dim'}>{fmt(v)}</td>);
  return (
    <Plate
      span={8}
      className="adm-money-places"
      title="Every place the offer opens"
      meta={`since ${md(since) || 'the first price'} · ${team}`}
      foot={rows ? (
        <>
          {foot.lead}{foot.strong ? <b>{foot.strong}</b> : null}{foot.tail}
          {foot.alarm ? <b className="mny-alarm">{foot.alarm}</b> : null}
        </>
      ) : null}
    >
      {!rows ? <div className="admin-empty">The placements read did not answer.</div> : (
        <div className="mny-tblbox">
          <table className="mny-tbl">
            <thead>
              <tr>
                <th className="is-l">Where</th><th>Times shown</th><th>People</th><th>Median look</th>
                <th>Read a feature</th><th>Compared plans</th><th>Pressed the button</th><th>Trials</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.key}>
                  <td className="mny-nm is-l">{r.name}<small>{r.note}</small></td>
                  <td>
                    <span className={`mny-cb${r.on ? ' is-on' : ''}`}>
                      <span className="mny-trk"><i style={{ width: `${r.pct}%` }} /></span>
                      <span className="mny-v">{r.shown}</span>
                    </span>
                  </td>
                  <td className={r.people == null ? 'is-dim' : ''}>{r.people ?? '—'}</td>
                  <td>{r.look}</td>
                  {cell(r.read)}
                  {cell(r.compared)}
                  {cell(r.cta, true)}
                  {cell(r.trials, true)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Plate>
  );
}

// ── 03 · The trials ─────────────────────────────────────────────────────────

function TrialCard({ t }) {
  const c = trialCard(t);
  if (!c) return null;
  return (
    <div className="mny-tr">
      <div>
        <div className="mny-tr-who">{c.who}</div>
        <div className="mny-tr-plan">{c.plan}</div>
      </div>
      <div className="mny-tr-count"><b>{c.left}</b><span>{c.ends}<br />{c.endsAt}</span></div>
      <div className="mny-tr-track" role="img" aria-label={c.aria}>
        <i style={{ width: `${c.pct}%` }} /><em style={{ left: `${c.pct}%` }} />
      </div>
      <div className="mny-tr-ends"><span>{c.startLabel}</span><span>{c.day}</span><span>{c.endLabel}</span></div>
      <dl className="mny-facts">
        {c.facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      <div className="mny-trail">
        {c.trail.map((s, i) => (
          <span key={s} className="mny-trail-step">
            {i ? <span className="mny-trail-arrow" aria-hidden="true">›</span> : null}
            <span className="mny-trail-name">{s}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Trials({ trials }) {
  const n = trials?.length ?? 0;
  const title = trials == null ? 'Trials' : n === 1 ? 'The one trial' : n ? `${n} trials` : 'Trials';
  return (
    <Plate span={4} className="adm-money-trials" title={title} meta="Stripe · trialing">
      {trials == null ? <div className="admin-empty">The trials read did not answer.</div>
        : !n ? <div className="admin-empty">Nobody is on a trial right now.</div>
          : trials.map((t) => <TrialCard key={t.user_id || t.email} t={t} />)}
    </Plate>
  );
}

// ── 04 · Everyone who has hit the cap ───────────────────────────────────────

function CapHits({ capHits, failed }) {
  const [all, setAll] = useState(false);
  const rows = capHits?.rows || [];
  const shown = all ? rows : rows.slice(0, CAP_ROWS_SHOWN);
  const many = rows.length > CAP_ROWS_SHOWN;
  return (
    <>
      <div className="admin-section-sub">
        {failed ? 'The people read did not answer, so this list is not shown.'
          : `${fmt(rows.length)} ${rows.length === 1 ? 'person' : 'people'}${capHits?.since ? ` since ${md(capHits.since)}` : ''}: a card was refused at the free cap, or the cap wall opened for them. Newest first. “Days back” counts the days they came back after the first hit.`}
      </div>
      {failed ? null : (
        <Deck>
          <Plate
            className="adm-money-caps"
            title="At the cap"
            meta={many ? (all ? `all ${fmt(rows.length)} · newest first` : `${CAP_ROWS_SHOWN} newest of ${fmt(rows.length)}`) : 'newest first'}
          >
            {!rows.length ? <div className="admin-empty">Nobody has hit the cap yet.</div> : (
              <>
                <div className="mny-tblbox">
                  <table className="mny-tbl">
                    <thead>
                      <tr>
                        <th className="is-l">Person</th><th>Joined</th><th>Hit the cap</th><th>Cards now · cap</th>
                        <th>Closed the offer</th><th>Start trial</th><th>Checkout</th><th>Deleted after</th>
                        <th>Days back</th><th>Last seen</th><th className="is-l">What happened next</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((raw) => {
                        const r = capRow(raw);
                        return (
                          <tr key={r.key}>
                            <td className="is-l">
                              <span className="mny-mail">{r.email}</span>
                              {r.badges.map((b) => <span key={b} className="mny-mini">{b}</span>)}
                            </td>
                            <td className="is-dim">{r.joined}</td>
                            <td>{r.hit}</td>
                            <td>
                              <span className={`mny-meter${r.over ? ' is-over' : ''}`}>
                                <span className="mny-trk"><i style={{ width: `${r.fill}%` }} /></span>
                                <span>{r.cards}</span>
                              </span>
                            </td>
                            <td className={r.closed === '—' ? 'is-dim' : ''}>{r.closed}</td>
                            <td className={r.pressed ? 'is-yes' : 'is-dim'}>{r.pressed ? 'yes' : '—'}</td>
                            <td className={r.checkout ? 'is-yes' : 'is-dim'}>{r.checkout ? 'yes' : '—'}</td>
                            <td className={r.deleted === '—' ? 'is-dim' : ''}>{r.deleted}</td>
                            <td className={r.back === '—' ? 'is-dim' : ''}>{r.back}</td>
                            <td className="is-dim">{r.last}</td>
                            <td className="is-l"><span className={`mny-tag is-${r.kind}`}><i />{r.tag}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {many ? (
                  <button type="button" className="mny-morebtn" aria-expanded={all} onClick={() => setAll((v) => !v)}>
                    {all ? `Show the ${CAP_ROWS_SHOWN} newest` : `Show all ${fmt(rows.length)}`}
                    <span aria-hidden="true">{all ? '▴' : '▾'}</span>
                  </button>
                ) : null}
              </>
            )}
          </Plate>
        </Deck>
      )}
    </>
  );
}

// ── 05 · Detail: each section fetches only once opened ──────────────────────

function LazyOffer({ days, f }) {
  const q = useAdminData(async () => {
    const [us, ux] = await Promise.allSettled([
      supabase.rpc('admin_upsell_scorecard', { p_days: days || 30, p_exclude_internal: f.excludeInternal }),
      supabase.rpc('admin_upsell_exposures', { p_days: days || 30, p_limit: 40, p_exclude_internal: f.excludeInternal }),
    ]);
    return { upsell: val(us), exposures: val(ux) || [] };
  }, [days, f.excludeInternal]);
  return (
    <AdminAsync loading={q.loading} error={q.error} hasData={q.hasData} onRetry={q.refresh} skeleton={<AdminSkeleton variant="table" />}>
      <UpsellBehaviorPanel scorecard={q.data?.upsell} exposures={q.data?.exposures || []} days={days || 30} />
    </AdminAsync>
  );
}

function LazyReach({ f }) {
  // A cohort, not a window: everyone who signed up since the waitlist came
  // off, so the read is "has this person EVER seen a price".
  const q = useAdminData(async () => {
    const r = await supabase.rpc('admin_paid_reach', { p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly });
    if (r.error) throw r.error;
    return r.data || [];
  }, [f.excludeInternal, f.verifiedOnly]);
  return (
    <AdminAsync loading={q.loading} error={q.error} hasData={q.hasData} onRetry={q.refresh} skeleton={<AdminSkeleton variant="table" />}>
      <PaidReachTable rows={q.data || []} />
    </AdminAsync>
  );
}

function LazyAccounts({ f }) {
  const q = useAdminData(async () => {
    const [td, tp] = await Promise.allSettled([
      supabase.rpc('admin_top_users', { p_tier: 'demo', p_limit: 20, p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      supabase.rpc('admin_top_users', { p_tier: 'paid', p_limit: 20, p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
    ]);
    return { topDemo: val(td) || [], topPaid: val(tp) || [] };
  }, [f.excludeInternal, f.verifiedOnly]);
  return (
    <AdminAsync loading={q.loading} error={q.error} hasData={q.hasData} onRetry={q.refresh} skeleton={<AdminSkeleton variant="table" />}>
      <AdminTopUsersList topDemo={q.data?.topDemo || []} topPaid={q.data?.topPaid || []} />
    </AdminAsync>
  );
}

function LazyEvents({ days, f }) {
  const q = useAdminData(async () => {
    const r = await supabase.rpc('admin_event_breakdown', { p_days: days || 30, p_exclude_internal: f.excludeInternal });
    if (r.error) throw r.error;
    return r.data || [];
  }, [days, f.excludeInternal]);
  return (
    <AdminAsync loading={q.loading} error={q.error} hasData={q.hasData} onRetry={q.refresh} skeleton={<AdminSkeleton variant="table" />}>
      {q.data?.length
        ? <AdminEventBreakdown rows={q.data} days={days || 30} />
        : <div className="admin-empty">None of these events in the window.</div>}
    </AdminAsync>
  );
}
