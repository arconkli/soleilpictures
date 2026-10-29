// TestsView — Analytics › Tests: every test, how its test side compares to the
// default, and whether it is really running.
//
// The owner's ask of 2026-10-29: "somewhere in the admin panel where i can see
// all the current tests and compare them to what things were by default and make
// sure the tests are actually running properly". Built to the picked mockup,
// look A: one row per test, which opens into its full read.
//
// One read, admin_tests_read (0810), counts only. Which tests exist, what each
// side gets and when each is read come from lib/testsCatalog.js; every rate, gap,
// verdict word and check sentence from lib/testsView.js, where they are tested.
// The read leaves the team, service and banned accounts out of every test, so
// the range control and the toolbar's toggles don't apply here and are hidden.
//
// Numbers are live. The verdict word waits for each test's read date (owner's
// pick). A failing check shows here only: nothing is emailed (owner's pick).

import { useMemo, useState } from 'react';
import { supabase } from '../../../../lib/supabase.js';
import { useAdminData } from '../../useAdminData.js';
import { AdminAsync, AdminSkeleton } from '../../AdminStates.jsx';
import { useRegisterViewRuntime, POLL_MS } from '../AnalyticsFiltersContext.jsx';
import { Plate } from '../../viz/Well.jsx';
import { Detail } from '../../viz/Detail.jsx';
import { ActivationByExperiment } from '../widgets/ActivationByExperiment.jsx';
import { getActiveExperiments } from '../../../../lib/experiments.js';
import { MIN_N, f1, sgn, testsPage } from '../../../../lib/testsView.js';
import '../../adminTests.css';

const VERDICT_CLASS = { wait: 'v-wait', off: 'v-off', good: 'v-good', bad: 'v-bad', even: 'v-even' };
const HEALTH = {
  look: { cls: 'h-look', icon: '⚠' },
  ok: { cls: 'h-ok', icon: '✓' },
  off: { cls: 'h-off', icon: '✓' },
  wait: { cls: 'h-wait', icon: '' },
};
const compareTitle = (t) => (t.kind === 'beforeafter' ? 'before' : t.kind === 'holdout' ? 'sending it' : 'as before');

export function TestsView() {
  const q = useAdminData(async () => {
    const { data, error } = await supabase.rpc('admin_tests_read');
    if (error) throw error;
    return data;
  }, [], { pollIntervalMs: POLL_MS.tests, refetchOnFocus: true });

  const page = useMemo(() => (q.data ? testsPage(q.data) : null), [q.data]);

  useRegisterViewRuntime({
    refresh: q.refresh, lastUpdated: q.lastUpdated, refreshing: q.refreshing,
    status: page ? { running: page.running, looks: page.looks } : null,
  });

  // One row open at a time. The first that needs a look opens by itself.
  const [open, setOpen] = useState(undefined);
  const firstLook = page?.groups.flatMap((g) => g.tests).find((m) => m.health.tone === 'look')?.t.key || null;
  const openKey = open === undefined ? firstLook : open;

  return (
    <AdminAsync loading={q.loading} error={q.error} hasData={q.hasData} onRetry={q.refresh} skeleton={<AdminSkeleton variant="table" />}>
      {page && (
        <div className="adm-view adm-tests">
          {page.groups.map((g, i) => (
            <section key={g.id} aria-labelledby={`tests-${g.id}`}>
              <h2 className="adm-tests-sec" id={`tests-${g.id}`}>
                <span className="adm-tests-sec-n">0{i + 1}</span>{g.label}<small>{g.sub}</small>
              </h2>
              <Plate className="adm-tests-rows">
                {g.tests.map((m) => (
                  <TestRow
                    key={m.t.key}
                    m={m}
                    open={openKey === m.t.key}
                    onToggle={() => setOpen(openKey === m.t.key ? null : m.t.key)}
                  />
                ))}
              </Plate>
            </section>
          ))}
          <Earlier earlier={page.earlier} n={page.groups.length + 1} />
          <p className="adm-tests-foot">
            Numbers update live; the verdict word waits for each test’s read date. Fewer than {MIN_N} on a side is
            too few to read. The team, service and banned accounts are left out of every number.
          </p>
        </div>
      )}
    </AdminAsync>
  );
}

function TestRow({ m, open, onToggle }) {
  const { t } = m;
  const h = HEALTH[m.health.tone] || HEALTH.wait;
  const bodyId = `test-${t.key}`;
  return (
    <div className={`adm-tests-row ${open ? 'is-open' : ''}`}>
      <button type="button" className="adm-tests-row-h" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <div className="adm-tests-rn"><b>{t.name}</b><span>{t.what}</span></div>
        <div className="adm-tests-rs">
          {m.off ? <span className="adm-tests-muted">—</span> : (
            <>
              <i className="adm-tests-sw a" aria-hidden="true" />{m.inA}
              <i className="adm-tests-sw b" aria-hidden="true" />{m.inB}
              <small>{m.countUnit}</small>
            </>
          )}
        </div>
        <div className="adm-tests-rh"><Headline m={m} /></div>
        <div className="adm-tests-rv"><span className={`adm-tests-chip ${VERDICT_CLASS[m.verdict.tone] || 'v-wait'}`}>{m.verdict.text}</span></div>
        <div className="adm-tests-rk">
          <span className={`adm-tests-chip ${h.cls}`}>{h.icon ? `${h.icon} ` : ''}{m.health.text}</span>
        </div>
        <span className="adm-tests-chev" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && <TestDetail m={m} id={bodyId} />}
    </div>
  );
}

function Headline({ m }) {
  if (m.off) return <span className="adm-tests-muted">{m.off}</span>;
  const row = m.headline;
  if (!row) return null;
  if (row.pending) return <div className="adm-tests-hl"><span>{row.m.label}</span><em>{row.pending}</em></div>;
  return (
    <div className="adm-tests-hl">
      <span>{row.m.label}</span>
      <div className="adm-tests-hl-n">
        <i className="adm-tests-sw a" aria-hidden="true" /><b>{f1(row.A.rate)}</b>
        <i className="adm-tests-sw b" aria-hidden="true" /><b>{f1(row.B.rate)}</b>
        <GapPlot g={row.gap} w={120} span={40} tone={row.tone} />
        {row.gap && !row.gap.few ? <code>{sgn(row.gap.d)}</code> : null}
      </div>
    </div>
  );
}

// B − A in points, on an axis of ±span, with its 95% range.
function GapPlot({ g, w = 200, span = 40, tone = '' }) {
  if (!g) return <svg className="adm-tests-plot" width={w} height="18" aria-hidden="true" />;
  if (g.few) return <span className="adm-tests-few">too few to read · {g.min} on one side</span>;
  const x = (v) => w / 2 + (Math.max(-span, Math.min(span, v)) / span) * (w / 2 - 6);
  return (
    <svg
      className={`adm-tests-plot ${tone}`}
      width={w}
      height="18"
      viewBox={`0 0 ${w} 18`}
      role="img"
      aria-label={`Gap ${sgn(g.d)} points, 95% range ${sgn(g.lo)} to ${sgn(g.hi)}`}
    >
      <line className="zero" x1={w / 2} x2={w / 2} y1="1" y2="17" />
      <line className="ci" x1={x(g.lo)} x2={x(g.hi)} y1="9" y2="9" />
      <line className="ci" x1={x(g.lo)} x2={x(g.lo)} y1="5" y2="13" />
      <line className="ci" x1={x(g.hi)} x2={x(g.hi)} y1="5" y2="13" />
      <circle className="pt" cx={x(g.d)} cy="9" r="3.5" />
    </svg>
  );
}

function TestDetail({ m, id }) {
  const { t } = m;
  const h = HEALTH[m.health.tone] || HEALTH.wait;
  return (
    <div className="adm-tests-det" id={id}>
      {m.timeline && <Timeline tl={m.timeline} />}
      <div className="adm-tests-cols">
        <section className="adm-tests-col">
          <h4>What it tests</h4>
          <div className="adm-tests-side"><i className="adm-tests-sw a" aria-hidden="true" /><div><b>{t.aName}</b><span>{t.a}</span></div></div>
          <div className="adm-tests-side"><i className="adm-tests-sw b" aria-hidden="true" /><div><b>{t.bName}</b><span>{t.b}</span></div></div>
          {!m.off && <SplitBar m={m} />}
        </section>
        <section className="adm-tests-col adm-tests-cmp">
          <h4>
            Compared to {compareTitle(t)}
            <span className={`adm-tests-chip ${VERDICT_CLASS[m.verdict.tone] || 'v-wait'}`}>{m.verdict.text}</span>
          </h4>
          <Measures m={m} />
        </section>
        <section className="adm-tests-col">
          <h4>
            Running properly?
            <span className={`adm-tests-chip ${h.cls}`}>{h.icon ? `${h.icon} ` : ''}{m.health.text}</span>
          </h4>
          <ul className="adm-tests-checks">
            {m.checks.map((c) => (
              <li key={c.id} className={`c-${c.state}`}>
                <CheckIcon state={c.state} />
                <div><b>{c.name}</b><span>{c.text}</span></div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function CheckIcon({ state }) {
  if (state === 'ok') return <span className="adm-tests-ck ok" aria-label="Fine">✓</span>;
  if (state === 'look') return <span className="adm-tests-ck look" aria-label="Needs a look">⚠</span>;
  return <span className="adm-tests-ck wait" aria-label="Waiting" />;
}

function SplitBar({ m }) {
  const { t } = m;
  const n = m.inA + m.inB;
  const a = n ? (100 * m.inA) / n : 50;
  return (
    <div className="adm-tests-split">
      <div className="adm-tests-split-n">
        <span><i className="adm-tests-sw a" aria-hidden="true" />{t.aName} <b>{m.inA}</b></span>
        <span><i className="adm-tests-sw b" aria-hidden="true" />{t.bName} <b>{m.inB}</b></span>
      </div>
      <div className="adm-tests-split-bar" aria-hidden="true">
        {n ? (
          <>
            <div className="sa" style={{ width: `${a}%` }} />
            <div className="sb" style={{ width: `${100 - a}%` }} />
          </>
        ) : <div className="se" />}
        <i className="mid" />
      </div>
      {m.note ? <small>{m.note}</small> : null}
    </div>
  );
}

function Measures({ m }) {
  const { t } = m;
  if (m.off) return <p className="adm-tests-muted">{m.off} Nothing to compare until it runs.</p>;
  if (!m.rows.length) return <p className="adm-tests-muted">Nothing is measured for this one.</p>;
  return (
    <>
      <div className="adm-tests-tablewrap">
        <table className="adm-tests-mt">
          <thead>
            <tr>
              <th>Measure · per 100</th>
              <th><i className="adm-tests-sw a" aria-hidden="true" />{t.aName}</th>
              <th><i className="adm-tests-sw b" aria-hidden="true" />{t.bName}</th>
              <th>Gap · 95% range</th>
              <th><span className="adm-tests-sr">Gap in points</span></th>
            </tr>
          </thead>
          <tbody>
            {m.rows.map((r) => (
              <tr key={r.m.id}>
                <td className="adm-tests-ml">
                  <div>{r.m.label} <em className={`adm-tests-role r-${r.m.role.replace(' ', '')}`}>{r.m.role}</em></div>
                  <small>{r.m.sub}</small>
                </td>
                {r.pending ? (
                  <td colSpan={4} className="adm-tests-pending">{r.pending}</td>
                ) : (
                  <>
                    <td className="adm-tests-num"><b>{f1(r.A.rate)}</b><small>{r.A.k} of {r.A.n}</small></td>
                    <td className="adm-tests-num"><b>{f1(r.B.rate)}</b><small>{r.B.k} of {r.B.n}</small></td>
                    <td className="adm-tests-pl"><GapPlot g={r.gap} w={200} span={m.span} tone={r.tone} /></td>
                    <td className="adm-tests-gp">
                      {r.gap && !r.gap.few
                        ? <><b className={r.tone}>{sgn(r.gap.d)} pts</b><small>{sgn(r.gap.lo)} to {sgn(r.gap.hi)}</small></>
                        : <b>—</b>}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {t.gapNote ? <p className="adm-tests-note">The gap is {t.gapNote}.</p> : null}
    </>
  );
}

function Timeline({ tl }) {
  return (
    <div className="adm-tests-tl" aria-label="Timeline">
      <div className="adm-tests-tl-line"><div className="adm-tests-tl-fill" style={{ width: `${tl.now.at}%` }} /></div>
      <div className="adm-tests-tl-mark start" style={{ left: 0 }}><i /><b>{tl.start.label}</b><span>Start</span></div>
      {tl.marks.map((x) => (
        <div key={x.label} className={`adm-tests-tl-mark ${x.done ? 'done' : ''} ${x.end ? 'end' : ''}`} style={{ left: `${x.at}%` }}>
          <i /><b>{x.label}</b><span>{x.what}</span>
        </div>
      ))}
      <div className={`adm-tests-tl-now ${tl.now.flip ? 'flip' : ''}`} style={{ left: `${tl.now.at}%` }}><span>{tl.now.label}</span></div>
    </div>
  );
}

// The scoreboards read a fixed window with the team left out: this view hides the
// range control and the toggles, and a hidden control must not move a number.
const SCOREBOARD_DAYS = 90;

function Earlier({ earlier, n }) {
  const keys = getActiveExperiments();
  return (
    <section aria-labelledby="tests-earlier">
      <h2 className="adm-tests-sec" id="tests-earlier">
        <span className="adm-tests-sec-n">0{n}</span>{earlier.label}<small>{earlier.sub}</small>
      </h2>
      <Plate className="adm-tests-earlier">
        {earlier.tests.map((e) => (
          <div className="adm-tests-er" key={e.key}><b>{e.name}</b><span>{e.out}</span><code>{e.when}</code></div>
        ))}
      </Plate>
      {keys.length > 0 && (
        <Detail id="tests.scoreboards" label="The old onboarding scoreboards" sub={`moved here from System · last ${SCOREBOARD_DAYS} days, team left out`}>
          <LazyExperiments days={SCOREBOARD_DAYS} excludeInternal keys={keys} />
        </Detail>
      )}
    </section>
  );
}

/**
 * Experiment arms, from System (where it sat as "Onboarding experiments").
 *
 * The bandit optimises on activation and shifts traffic nightly on its own, so
 * this is a readout, not a decision surface. It reads only when opened.
 */
function LazyExperiments({ days, excludeInternal, keys }) {
  const q = useAdminData(async () => {
    const settled = await Promise.allSettled([
      ...keys.map((k) => supabase.rpc('admin_activation_by_experiment', { p_key: k, p_days: days, p_exclude_internal: excludeInternal })),
      supabase.rpc('admin_get_experiment_state'),
    ]);
    const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
    const state = val(settled[keys.length]) || {};
    return { arms: keys.map((k, i) => ({ key: k, rows: val(settled[i]) || [], state: state?.[k] || null })) };
  }, [days, excludeInternal, keys.join(',')]);

  return (
    <AdminAsync loading={q.loading} error={q.error} hasData={q.hasData} onRetry={q.refresh} skeleton={<AdminSkeleton variant="table" />}>
      {(q.data?.arms || []).map((e) => (
        <ActivationByExperiment key={e.key} expKey={e.key} rows={e.rows} state={e.state} />
      ))}
    </AdminAsync>
  );
}
