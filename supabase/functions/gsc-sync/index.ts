// gsc-sync — pull Search Console performance into the database daily.
//
// THREE destinations per run. Two are rolling-28-day SNAPSHOT rows at today's
// date (matching the CSV importer's semantics so readers take the latest
// snapshot and re-runs never double-count):
//   * seo_board_stats (0137/0138) — per-/c/<slug> page totals (unchanged legacy
//     shape; admin_public_board_stats reads it).
//   * seo_page_stats (0196) — ALL site paths (landing pages, /, /pricing,
//     /explore, /c/*): page totals as query='', plus per-(page,query) rows.
//     admin_page_search_stats reads it. /share/<token> aggregates to '/share'
//     (tokens are capability URLs — never stored; same convention as lp_*).
// The third is TRUE PER-DAY data:
//   * seo_page_daily (0254) — same shape, but `day` is the real Search Console
//     date rather than the sync stamp. Safe to SUM across days.
//
// ── Why both shapes (2026-08-22) ────────────────────────────────────────────
// The snapshot tables answer "where do we stand today" in one row per path, and
// every existing reader depends on that. They CANNOT answer "did the retitle we
// shipped on the 4th work", because a 28-day window dilutes any change to 1/28
// per day and its before/after windows overlap. Both 2026-08 retitles were
// graded on an instrument that could not resolve them. seo_page_daily fixes
// that without redefining `day` under the existing 4k rows.
//
// GOTCHA: Google restates the trailing ~3 days and finalizes late. The daily
// pass therefore re-fetches a 10-day tail every run and upserts, rather than
// only fetching yesterday. A one-off history load is available via a request
// body of {backfillDays: 90} or explicit {startDate, endDate}.
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

// Google's per-request row ceiling. The old calls passed rowLimit 1000/5000 with
// no startRow loop, which silently truncated the moment the site outgrew them —
// adding a `date` dimension multiplies row count by the window length, so paging
// is no longer optional.
const PAGE_SIZE = 25000;
// PostgREST bodies stay bounded; a 90-day backfill is tens of thousands of rows.
const UPSERT_CHUNK = 1000;
// How far back the daily pass re-reads on every run. Covers Google's ~3-day
// finalization lag with room to spare.
const DAILY_TAIL_DAYS = 10;
// Backstop against a pathological paging loop.
const MAX_ROWS_PER_QUERY = 200000;

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

// Page through a Search Console query until it stops returning full pages.
async function gscQueryAll(token: string, body: Record<string, unknown>): Promise<any[]> {
  const out: any[] = [];
  for (let startRow = 0; startRow < MAX_ROWS_PER_QUERY; startRow += PAGE_SIZE) {
    const rows = await gscQuery(token, { ...body, rowLimit: PAGE_SIZE, startRow });
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

// Fold a GSC row into an accumulator. Rows only ever merge when two distinct
// URLs normalize to one stored path (/share/<token> → /share), and in that case
// `position` must be IMPRESSION-WEIGHTED: the previous code kept whichever
// position arrived first, so a 1-impression row could outvote a 500-impression
// one.
type Acc = { clicks: number; impressions: number; position: number | null };
function foldRow(prev: Acc | undefined, r: any): Acc {
  const clicks = Math.round(r.clicks || 0);
  const impressions = Math.round(r.impressions || 0);
  const position = r.position != null ? Number(r.position) : null;
  if (!prev) return { clicks, impressions, position };
  const totalImp = prev.impressions + impressions;
  let merged = prev.position;
  if (prev.position != null && position != null) {
    merged = totalImp > 0
      ? (prev.position * prev.impressions + position * impressions) / totalImp
      : (prev.position + position) / 2;
  } else if (prev.position == null) {
    merged = position;
  }
  return { clicks: prev.clicks + clicks, impressions: totalImp, position: merged };
}
function round1(n: number | null): number | null {
  return n == null ? null : Number(n.toFixed(1));
}

async function upsert(table: string, conflict: string, rows: unknown[]): Promise<void> {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflict}`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        authorization: `Bearer ${SERVICE_KEY}`,
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) throw new Error(`upsert ${table} failed: ` + (await res.text()).slice(0, 200));
  }
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

  // Optional one-off history load. Daily cron sends no body and gets the
  // DAILY_TAIL_DAYS tail; a manual call may ask for {backfillDays: 90} or an
  // explicit {startDate, endDate} to page through Search Console's 16 months.
  let opts: { backfillDays?: number; startDate?: string; endDate?: string } = {};
  try { opts = (await req.json()) || {}; } catch { /* no body — the cron path */ }

  try {
    const sa = JSON.parse(SA_JSON);
    const token = await getAccessToken(sa);

    const end = new Date();
    const start = new Date(end.getTime() - 28 * 86400000);
    const range = { startDate: ymd(start), endDate: ymd(end) };
    const day = ymd(end);
    const nowIso = new Date().toISOString();

    // Window for the true-per-day pass (seo_page_daily), independent of the
    // 28-day snapshot window above.
    const tailDays = Math.max(1, Math.min(480, Number(opts.backfillDays) || DAILY_TAIL_DAYS));
    const dailyRange = {
      startDate: opts.startDate || ymd(new Date(end.getTime() - tailDays * 86400000)),
      endDate: opts.endDate || ymd(end),
    };

    // One pass per search type: page totals + per-(page,query) detail into
    // seo_page_stats (search_type column, 0197). seo_board_stats stays
    // WEB-ONLY (legacy shape; admin_public_board_stats reads it).
    const SEARCH_TYPES = ['web', 'image'];
    const boardRows: unknown[] = [];
    const pageStatRows: unknown[] = [];
    const counts: Record<string, { pages: number; page_queries: number }> = {};

    for (const st of SEARCH_TYPES) {
      const pageRows = await gscQueryAll(token, { ...range, type: st, dimensions: ['page'] });

      const totals = new Map<string, Acc>();
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
        totals.set(path, foldRow(totals.get(path), r));   // '/share' can merge rows
      }

      // Per-(page, query) — the ranking-query detail for every path.
      const pqRows = await gscQueryAll(token, { ...range, type: st, dimensions: ['page', 'query'] });
      const detail = new Map<string, Acc>();
      const detailKeys = new Map<string, { path: string; query: string }>();
      for (const r of pqRows) {
        const path = normPath(r.keys?.[0] || '');
        const query = String(r.keys?.[1] || '').slice(0, 200);
        if (!path || !query) continue;
        const k = `${path}\0${query}`;
        detailKeys.set(k, { path, query });
        detail.set(k, foldRow(detail.get(k), r));
      }

      for (const [path, a] of totals) {
        pageStatRows.push({
          path, day, query: '', search_type: st,
          clicks: a.clicks, impressions: a.impressions, position: round1(a.position),
          updated_at: nowIso,
        });
      }
      for (const [k, a] of detail) {
        const { path, query } = detailKeys.get(k)!;
        pageStatRows.push({
          path, day, query, search_type: st,
          clicks: a.clicks, impressions: a.impressions, position: round1(a.position),
          updated_at: nowIso,
        });
      }
      counts[st] = { pages: totals.size, page_queries: detail.size };
    }

    // -- True per-day pass into seo_page_daily (0254) -------------------------
    // Page totals come from their OWN ['date','page'] query rather than summing
    // the per-query rows: Search Console omits low-volume queries entirely, so
    // summing them undercounts a page by 65-90% on this site.
    const dailyRows: unknown[] = [];
    const dailyCounts: Record<string, { pages: number; page_queries: number }> = {};
    const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

    for (const st of SEARCH_TYPES) {
      const totals = new Map<string, Acc>();
      const totalKeys = new Map<string, { path: string; d: string }>();
      for (const r of await gscQueryAll(token, { ...dailyRange, type: st, dimensions: ['date', 'page'] })) {
        const d = String(r.keys?.[0] || '');
        const path = normPath(r.keys?.[1] || '');
        if (!path || !isDate(d)) continue;
        const k = `${path}\0${d}`;
        totalKeys.set(k, { path, d });
        totals.set(k, foldRow(totals.get(k), r));
      }

      const detail = new Map<string, Acc>();
      const detailKeys = new Map<string, { path: string; d: string; query: string }>();
      for (const r of await gscQueryAll(token, { ...dailyRange, type: st, dimensions: ['date', 'page', 'query'] })) {
        const d = String(r.keys?.[0] || '');
        const path = normPath(r.keys?.[1] || '');
        const query = String(r.keys?.[2] || '').slice(0, 200);
        if (!path || !query || !isDate(d)) continue;
        const k = `${path}\0${d}\0${query}`;
        detailKeys.set(k, { path, d, query });
        detail.set(k, foldRow(detail.get(k), r));
      }

      for (const [k, a] of totals) {
        const { path, d } = totalKeys.get(k)!;
        dailyRows.push({
          path, day: d, query: '', search_type: st,
          clicks: a.clicks, impressions: a.impressions, position: round1(a.position),
          updated_at: nowIso,
        });
      }
      for (const [k, a] of detail) {
        const { path, d, query } = detailKeys.get(k)!;
        dailyRows.push({
          path, day: d, query, search_type: st,
          clicks: a.clicks, impressions: a.impressions, position: round1(a.position),
          updated_at: nowIso,
        });
      }
      dailyCounts[st] = { pages: totals.size, page_queries: detail.size };
    }

    await upsert('seo_board_stats', 'slug,day', boardRows);
    await upsert('seo_page_stats', 'path,day,query,search_type', pageStatRows);
    await upsert('seo_page_daily', 'path,day,query,search_type', dailyRows);

    // Retention: snapshots accumulate daily; keep a rolling window.
    const cutoff = ymd(new Date(end.getTime() - RETENTION_DAYS * 86400000));
    for (const t of ['seo_page_stats', 'seo_page_daily']) {
      await fetch(`${SUPABASE_URL}/rest/v1/${t}?day=lt.${cutoff}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
      });
    }

    return new Response(
      JSON.stringify({
        ok: true, day,
        boards: boardRows.length,
        web: counts.web, image: counts.image,
        daily: { range: dailyRange, rows: dailyRows.length, ...dailyCounts },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), { status: 500 });
  }
});
