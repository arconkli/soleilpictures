// gsc-sync — pull Search Console performance into the database daily.
//
// Two destinations per run (both rolling-28-day SNAPSHOT rows at today's date,
// matching the CSV importer's semantics so readers take the latest snapshot and
// re-runs never double-count):
//   * seo_board_stats (0137/0138) — per-/c/<slug> page totals (unchanged legacy
//     shape; admin_public_board_stats reads it).
//   * seo_page_stats (0196) — ALL site paths (landing pages, /, /pricing,
//     /explore, /c/*): page totals as query='', plus per-(page,query) rows.
//     admin_page_search_stats reads it. /share/<token> aggregates to '/share'
//     (tokens are capability URLs — never stored; same convention as lp_*).
//
// ── Manual setup (one-time) ─────────────────────────────────────────────────
//   1. GCP: create a project, enable the "Google Search Console API".
//   2. Create a service account; download its JSON key.
//   3. In Search Console → the property → Settings → Users and permissions →
//      add the service-account email as a Restricted user. This site uses the
//      soleilpictures.com DOMAIN property.
//   4. Set secrets:
//        supabase secrets set GSC_SERVICE_ACCOUNT_JSON='<the full JSON key>'
//        supabase secrets set GSC_SITE_URL='sc-domain:soleilpictures.com'
//        (URL-prefix property would be 'https://clusters.soleilpictures.com/';
//        GSC_APP_HOST filters domain-property rows to the app subdomain.)
//   5. Deploy:  supabase functions deploy gsc-sync   (or via MCP deploy_edge_function)
//   6. pg_cron daily POST with the x-cron-secret header (see 'gsc-sync-daily').
//
// Auth (mirrors seo-health): x-cron-secret OR Bearer service-role. Until the
// GSC secrets are set the function no-ops with 200 {skipped} so the daily cron
// doesn't alarm.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const SA_JSON = Deno.env.get('GSC_SERVICE_ACCOUNT_JSON') || '';
const SITE_URL = Deno.env.get('GSC_SITE_URL') || 'https://clusters.soleilpictures.com/';
// Domain properties (sc-domain:) return rows for EVERY subdomain — without this
// guard, soleilpictures.com/ and clusters.soleilpictures.com/ would both
// normalize to '/' and merge. Only the app host is ingested.
const APP_HOST = (Deno.env.get('GSC_APP_HOST') || 'clusters.soleilpictures.com').toLowerCase();

const RETENTION_DAYS = 180;

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
function ymd(d: Date): string { return d.toISOString().slice(0, 10); }

// GSC 'page' key (absolute URL) → canonical stored path. Null = drop the row
// (bad URL, off-host subdomain, or junk).
function normPath(pageUrl: string): string | null {
  let u: URL;
  try { u = new URL(pageUrl); } catch { return null; }
  if (u.hostname.toLowerCase() !== APP_HOST) return null;
  let p = u.pathname.toLowerCase();
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  if (!p) p = '/';
  if (p.startsWith('/share/')) p = '/share';   // never store share tokens
  if (p.length > 120) return null;             // junk/scanner URLs
  return p;
}

async function getAccessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)).buffer);
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })}`;
  const key = await crypto.subtle.importKey(
    'pkcs8', pemToArrayBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64url(sig)}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('oauth failed: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}

async function gscQuery(token: string, body: Record<string, unknown>): Promise<any[]> {
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  const data = await res.json();
  if (!res.ok) throw new Error('gsc query failed: ' + JSON.stringify(data).slice(0, 300));
  return data.rows || [];
}

async function upsert(table: string, conflict: string, rows: unknown[]): Promise<void> {
  if (!rows.length) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflict}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
      prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`upsert ${table} failed: ` + (await res.text()).slice(0, 200));
}

Deno.serve(async (req) => {
  // Cron/server only: x-cron-secret (pg_cron) OR the service-role key as bearer.
  const cronHeader = req.headers.get('x-cron-secret') || '';
  const auth = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const okCron = !!CRON_SECRET && cronHeader === CRON_SECRET;
  const okService = !!auth && auth === SERVICE_KEY;
  if (!okCron && !okService) return new Response('forbidden', { status: 403 });

  if (!SA_JSON) {
    // Not configured yet — succeed quietly so the daily cron doesn't alarm.
    return new Response(JSON.stringify({ ok: false, skipped: 'GSC_SERVICE_ACCOUNT_JSON not set' }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  try {
    const sa = JSON.parse(SA_JSON);
    const token = await getAccessToken(sa);

    const end = new Date();
    const start = new Date(end.getTime() - 28 * 86400000);
    const range = { startDate: ymd(start), endDate: ymd(end) };
    const day = ymd(end);
    const nowIso = new Date().toISOString();

    // One pass per search type: page totals + per-(page,query) detail into
    // seo_page_stats (search_type column, 0197). seo_board_stats stays
    // WEB-ONLY (legacy shape; admin_public_board_stats reads it).
    const SEARCH_TYPES = ['web', 'image'];
    const boardRows: unknown[] = [];
    const pageStatRows: unknown[] = [];
    const counts: Record<string, { pages: number; page_queries: number }> = {};

    for (const st of SEARCH_TYPES) {
      const pageRows = await gscQuery(token, { ...range, type: st, dimensions: ['page'], rowLimit: 1000 });

      const totals = new Map<string, any>();
      for (const r of pageRows) {
        const pageUrl = r.keys?.[0] || '';
        const path = normPath(pageUrl);
        if (!path) continue;
        const m = path.match(/^\/c\/([a-z0-9][a-z0-9-]{0,79})$/);
        if (st === 'web' && m) {
          boardRows.push({
            slug: m[1],
            day,
            clicks: Math.round(r.clicks || 0),
            impressions: Math.round(r.impressions || 0),
            ctr: r.ctr != null ? Number((r.ctr * 100).toFixed(2)) : null,
            position: r.position != null ? Number(r.position.toFixed(1)) : null,
            updated_at: nowIso,
          });
        }
        const prev = totals.get(path);   // '/share' aggregation can merge rows
        totals.set(path, {
          path, day, query: '', search_type: st,
          clicks: Math.round(r.clicks || 0) + (prev?.clicks || 0),
          impressions: Math.round(r.impressions || 0) + (prev?.impressions || 0),
          position: prev ? prev.position : (r.position != null ? Number(r.position.toFixed(1)) : null),
          updated_at: nowIso,
        });
      }

      // Per-(page, query) — the ranking-query detail for every path.
      const pqRows = await gscQuery(token, { ...range, type: st, dimensions: ['page', 'query'], rowLimit: 5000 });
      const detail = new Map<string, any>();
      for (const r of pqRows) {
        const path = normPath(r.keys?.[0] || '');
        const query = String(r.keys?.[1] || '').slice(0, 200);
        if (!path || !query) continue;
        const k = `${path} ${query}`;
        const prev = detail.get(k);
        detail.set(k, {
          path, day, query, search_type: st,
          clicks: Math.round(r.clicks || 0) + (prev?.clicks || 0),
          impressions: Math.round(r.impressions || 0) + (prev?.impressions || 0),
          position: prev ? prev.position : (r.position != null ? Number(r.position.toFixed(1)) : null),
          updated_at: nowIso,
        });
      }

      pageStatRows.push(...totals.values(), ...detail.values());
      counts[st] = { pages: totals.size, page_queries: detail.size };
    }

    await upsert('seo_board_stats', 'slug,day', boardRows);
    await upsert('seo_page_stats', 'path,day,query,search_type', pageStatRows);

    // Retention: snapshots accumulate daily; keep a rolling window.
    const cutoff = ymd(new Date(end.getTime() - RETENTION_DAYS * 86400000));
    await fetch(`${SUPABASE_URL}/rest/v1/seo_page_stats?day=lt.${cutoff}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
    });

    return new Response(
      JSON.stringify({ ok: true, day, boards: boardRows.length, web: counts.web, image: counts.image }),
      { headers: { 'content-type': 'application/json' } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), { status: 500 });
  }
});
