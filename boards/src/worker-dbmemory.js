// The database memory watch, every five minutes (worker.js scheduled()). Every
// other check runs inside Postgres, which is the thing that stops when memory
// runs out, so this reads the server's own figures from Supabase's metrics
// endpoint, keeps them with db_memory_record (0908), and pages through
// ops_alert_raise (0369) while memory is short. What counts as a problem is
// decided in lib/dbMemory.js; this file only does the I/O. It never throws.

import { alertText, judge, parseReading } from './lib/dbMemory.js';
import { jobFailed } from './lib/workerErrors.js';

// Failing to record a failure must not stop the run.
async function failed(env, e, phase) {
  try { await jobFailed(env, 'db_memory', e, phase); } catch (_) { /* nothing more to do */ }
}

const svcHeaders = (env) => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  'content-type': 'application/json',
});

export async function runDbMemoryWatch(env, { fetchImpl = fetch } = {}) {
  try {
    if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_ROLE_KEY) {
      console.log('[db-memory] skipped: no service role');
      return null;
    }
    let reading;
    try {
      const res = await fetchImpl(`${env.SUPABASE_URL}/customer/v1/privileged/metrics`, {
        headers: { authorization: 'Basic ' + btoa(`service_role:${env.SUPABASE_SERVICE_ROLE_KEY}`) },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`metrics ${res.status}`);
      reading = parseReading(await res.text());
      if (!reading) throw new Error('metrics: no memory figures');
    } catch (e) {
      console.error('[db-memory] could not read the metrics:', e?.message || e);
      await failed(env, e);
      return null;
    }

    let prev = null;
    let recorded = true;
    try {
      const res = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/rpc/db_memory_record`, {
        method: 'POST',
        headers: svcHeaders(env),
        body: JSON.stringify({ p: reading }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
      prev = (await res.json()) ?? null;
    } catch (e) {
      console.error('[db-memory] could not record:', e?.message || e);
      await failed(env, e, 'record');
      recorded = false;
      prev = null;
    }

    const j = judge(prev, reading, { recorded });
    if (j.verdict !== 'ok') {
      const { title, body } = alertText(j, reading);
      // The alert is raised in the same database, so while the database isn't
      // answering at all it most likely can't land; this watch is for the
      // hours of running short before a lockup (on 17 Nov 2026 the server
      // swapped for hours first).
      try {
        const res = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/rpc/ops_alert_raise`, {
          method: 'POST',
          headers: svcHeaders(env),
          body: JSON.stringify({
            p_kind: 'db_memory', p_title: title, p_body: body, p_page: true,
            p_dedupe_key: 'db_memory', p_dedupe_window: '1 hour',
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
      } catch (e) {
        console.error('[db-memory] could not raise:', e?.message || e);
        await failed(env, e, 'raise');
      }
    }
    console.log(`[db-memory] ${j.verdict}; free ${j.availPct == null ? '?' : Math.round(j.availPct)}%, swap used ${j.swapUsedPct == null ? '?' : Math.round(j.swapUsedPct)}%`);
    return j;
  } catch (e) {
    console.error('[db-memory] failed:', e?.message || e);
    await failed(env, e);
    return null;
  }
}
