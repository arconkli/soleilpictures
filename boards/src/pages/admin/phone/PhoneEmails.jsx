/* Emails: what we sent in the last 7 days, one row per template (team accounts
   left out). Numbers and friendly names from lib/phonePageModels.js. */
import { emailsModel } from '../../../lib/phonePageModels.js';
import { NumStats } from './phoneCharts.jsx';
import { PageShell, FullAdmin, Held } from './PhonePageShell.jsx';
import { Fig } from './phoneFig.jsx';

export function EmailsPage({ data = {}, errors = {}, now, onBack, onRetry }) {
  const m = emailsModel(data.emails);
  return (
    <PageShell id="emails" kicker="Last 7 days" title="Emails" now={now} onBack={onBack}>
      {m
        ? <NumStats items={m.tiles} />
        : <Held value={data.emails} error={errors.emails} onRetry={onRetry} h={90}>{() => null}</Held>}

      <Fig
        n={1} topic="Emails" title="What we sent"
        value={data.emails} error={errors.emails} onRetry={onRetry} h={240}
        build={() => m && {
          dek: m.dek,
          note: m.caption,
          body: m.rows.length
            ? (
              <div className="ap-eml">
                {m.rows.map((r) => (
                  <div className="ap-em" key={r.key}>
                    <span className="ap-en">{r.name}</span>
                    <span className="ap-es"><b>{r.sentText}</b> sent</span>
                    <span className="ap-eb" aria-hidden="true"><i style={{ width: `${Math.max(1, r.frac * 100)}%` }} /></span>
                    {r.line ? <span className="ap-eo">{r.line}</span> : null}
                  </div>
                ))}
              </div>
            )
            : <p className="ap-wait">Nothing was sent in the last 7 days.</p>,
        }}
      />
      <FullAdmin href="/admin?tab=emails&full=1" />
    </PageShell>
  );
}
