// ReturnPredictors — what day-one behaviour goes with a second visit, shown in
// a way that makes the confound impossible to miss.
//
// The panel's opinion is structural rather than editorial. Depth drives both
// the behaviour and the returning, so a pooled lift is nearly meaningless here
// and has already been wrong three separate times — most memorably by
// concluding that hitting an error is good for retention. So:
//
//   * the pooled figure is shown, but only ever beside the bands, and it is
//     struck through when the bands contradict it;
//   * an effect size is printed ONLY when the sign survives every band it was
//     measured in. Otherwise the verdict is the output and there is no number
//     to quote out of context;
//   * a signal nobody ever triggers reads as "never observed", not as "no
//     effect" — those are different findings and a blank cell conflates them.
//
// The arithmetic lives in lib/retentionStats.js and is unit-tested there,
// including a regression fixture shaped like the error reading.

import { formatCount } from '../../../../lib/adminFormat.js';
import { wilson, consistency } from '../../../../lib/retentionStats.js';

const num = (x) => (x == null || Number.isNaN(Number(x)) ? 0 : Number(x));

// Plain English, and phrased as the thing the person DID. Keys mirror the
// VALUES list in migration 0280 — adding a signal there needs a label here or
// it renders under its raw name, which is ugly but not wrong.
const LABEL = {
  shared:          'Shared, or opened the share panel',
  wrote_text:      'Wrote something — a note, doc or script',
  multi_board:     'Opened more than one cluster',
  batch_upload:    'Added three or more files at once',
  nested:          'Nested a card into a cluster',
  answered_intent: 'Answered the "what are you here for" question',
  mobile:          'Was on a phone',
  day1_error:      'Hit an error',
  hit_friction:    'Was blocked or got stuck placing a card',
};

const VERDICT_COPY = {
  supported:    { text: 'holds up',     tone: 'ok'   },
  directional:  { text: 'directional',  tone: 'warn' },
  inconsistent: { text: 'confounded',   tone: 'bad'  },
  unmeasured:   { text: 'too thin',     tone: 'off'  },
};

const ORDER = { supported: 0, directional: 1, inconsistent: 2, unmeasured: 3 };

function pctOf(succ, n) {
  const w = wilson(succ, n);
  return w.p == null ? null : w.p * 100;
}

/** One depth band: the gap between the two arms, or an honest blank. */
function BandCell({ cell }) {
  const withN = num(cell?.with_n);
  const withoutN = num(cell?.without_n);
  const a = pctOf(num(cell?.with_ret), withN);
  const b = pctOf(num(cell?.without_ret), withoutN);

  if (withN === 0) {
    return <td className="adm-pred-cell is-none" title="Nobody in this band did it">·</td>;
  }
  if (a == null || b == null || withN < 5 || withoutN < 5) {
    return (
      <td className="adm-pred-cell is-thin" title={`n=${withN} vs ${withoutN} — below the floor`}>
        n={formatCount(withN)}
      </td>
    );
  }

  const d = a - b;
  const tone = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
  return (
    <td className={`adm-pred-cell is-${tone}`} title={`${a.toFixed(0)}% vs ${b.toFixed(0)}% · n=${withN} vs ${withoutN}`}>
      {d > 0 ? '+' : ''}{d.toFixed(0)}
    </td>
  );
}

function Row({ signal, cells }) {
  const pooled = cells.find((c) => c.band === 'all');
  const bands = cells.filter((c) => c.band !== 'all')
    .sort((x, y) => num(x.band_ord) - num(y.band_ord));

  const verdict = consistency(bands.map((c) => ({
    band: c.band,
    withSucc: num(c.with_ret), withN: num(c.with_n),
    withoutSucc: num(c.without_ret), withoutN: num(c.without_n),
  })));

  const pooledA = pctOf(num(pooled?.with_ret), num(pooled?.with_n));
  const pooledB = pctOf(num(pooled?.without_ret), num(pooled?.without_n));
  const pooledD = pooledA != null && pooledB != null ? pooledA - pooledB : null;

  const v = VERDICT_COPY[verdict.verdict] || VERDICT_COPY.unmeasured;
  const contradicted = verdict.verdict === 'inconsistent';
  const totalWith = num(pooled?.with_n);

  return (
    <tr className={`adm-pred-row is-${verdict.verdict}`}>
      <th scope="row" className="adm-pred-label">
        {LABEL[signal] || signal}
        <span className="adm-pred-n">{formatCount(totalWith)} did</span>
      </th>

      {bands.map((c) => <BandCell key={c.band} cell={c} />)}

      <td className="adm-pred-pooled">
        {pooledD == null ? '—' : (
          <span className={contradicted ? 'is-struck' : ''}
            title={contradicted
              ? 'The bands disagree with each other, so this pooled figure is an artefact of depth'
              : 'Pooled across all depths'}>
            {pooledD > 0 ? '+' : ''}{pooledD.toFixed(0)}
          </span>
        )}
      </td>

      <td className="adm-pred-verdict">
        <span className={`adm-pred-chip is-${v.tone}`}>{v.text}</span>
      </td>
    </tr>
  );
}

export function ReturnPredictors({ rows = [] }) {
  const bySignal = new Map();
  for (const r of rows || []) {
    if (!bySignal.has(r.signal)) bySignal.set(r.signal, []);
    bySignal.get(r.signal).push(r);
  }
  if (!bySignal.size) return <div className="admin-empty">Nothing measured yet.</div>;

  // Bands present in the data, in order, so the header cannot drift from the
  // migration's banding.
  const bandNames = [...new Set((rows || [])
    .filter((r) => r.band !== 'all')
    .sort((a, b) => num(a.band_ord) - num(b.band_ord))
    .map((r) => r.band))];

  const ranked = [...bySignal.entries()].sort((a, b) => {
    const va = consistency(a[1].filter((c) => c.band !== 'all').map((c) => ({
      withSucc: num(c.with_ret), withN: num(c.with_n),
      withoutSucc: num(c.without_ret), withoutN: num(c.without_n),
    })));
    const vb = consistency(b[1].filter((c) => c.band !== 'all').map((c) => ({
      withSucc: num(c.with_ret), withN: num(c.with_n),
      withoutSucc: num(c.without_ret), withoutN: num(c.without_n),
    })));
    return (ORDER[va.verdict] - ORDER[vb.verdict]) || a[0].localeCompare(b[0]);
  });

  return (
    <section className="admin-chart-panel admin-chart-panel-wide adm-pred-wrap">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Day-one behaviour vs coming back</h3>
        <span className="admin-chart-sub t-meta">
          crossed with depth, because depth drives both sides of every one of these
        </span>
      </header>
      <table className="adm-pred">
        <thead>
          <tr>
            <th scope="col" className="adm-pred-label">Did this on day one</th>
            {bandNames.map((b) => (
              <th scope="col" key={b} className="adm-pred-cell">{b}</th>
            ))}
            <th scope="col" className="adm-pred-pooled">pooled</th>
            <th scope="col" className="adm-pred-verdict">verdict</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map(([signal, cells]) => <Row key={signal} signal={signal} cells={cells} />)}
        </tbody>
      </table>

      <div className="admin-panel-note">
        Columns are day-one card counts. Each cell is the difference in return rate, in points,
        between people who did the thing and people who did not — measured inside that band, so
        depth cannot manufacture it. <strong>pooled</strong> ignores the bands, and is struck
        through wherever the bands contradict it: that is the confound, shown rather than
        described. A dot means nobody in that band ever did it.
      </div>
    </section>
  );
}
