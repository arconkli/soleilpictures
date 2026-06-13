// gsc-sync — pull per-page Search Console performance for /c/<slug> marketing
// boards into seo_board_stats (migration 0137/0138). The AUTOMATED path; the
// admin "Import GSC CSV" button is the zero-setup alternative.
//
// Writes a rolling-28-day SNAPSHOT row per slug at today's date, matching the
// CSV importer's semantics so admin_public_board_stats (latest snapshot per
// slug) reads both sources interchangeably.
//
// ── Manual setup (one-time) ─────────────────────────────────────────────────
//   1. GCP: create a project, enable the "Google Search Console API".
//   2. Create a service account; download its JSON key.
//   3. In Search Console → property (clusters.soleilpictures.com) → Settings →
//      Users and permissions → add the service-account email as a Full/Restricted user.
//   4. Set secrets:
//        supabase secrets set GSC_SERVICE_ACCOUNT_JSON='<the full JSON key>'
//        supabase secrets set GSC_SITE_URL='https://clusters.soleilpictures.com/'
//        (or 'sc-domain:soleilpictures.com' for a domain property)
//   5. Deploy:  supabase functions deploy gsc-sync   (or via MCP deploy_edge_function)
//   6. Schedule daily (pg_cron + pg_net, or an external cron) POSTing with the
//      service-role key as the bearer:
//        select cron.schedule('gsc-sync-daily','30 5 * * *', $$
//          select net.http_post(
//            url := 'https://ehlhlmbpwwalmeisvmdp.supabase.co/functions/v1/gsc-sync',
//            headers := jsonb_build_object('Authorization','Bearer '||'<SERVICE_ROLE_KEY-from-vault>'));
//        $$);
//
// Gate: caller must present the service-role key as the bearer (cron/server only).

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SA_JSON = Deno.env.get('GSC_SERVICE_ACCOUNT_JSON') || '';
const SITE_URL = Deno.env.get('GSC_SITE_URL') || 'https://clusters.soleilpictures.com/';

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

Deno.serve(async (req) => {
  // Server/cron only.
  const auth = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!auth || auth !== SERVICE_KEY) return new Response('forbidden', { status: 403 });
  if (!SA_JSON) return new Response(JSON.stringify({ error: 'GSC_SERVICE_ACCOUNT_JSON not set' }), { status: 500 });

  try {
    const sa = JSON.parse(SA_JSON);
    const token = await getAccessToken(sa);

    const end = new Date();
    const start = new Date(end.getTime() - 28 * 86400000);
    const gscRes = await fetch(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/searchAnalytics/query`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ startDate: ymd(start), endDate: ymd(end), dimensions: ['page'], rowLimit: 1000 }),
      },
    );
    const data = await gscRes.json();
    if (!gscRes.ok) return new Response(JSON.stringify({ error: 'gsc query failed', detail: data }), { status: 502 });

    const day = ymd(end);
    const rows = (data.rows || [])
      .map((r: any) => {
        const page = r.keys?.[0] || '';
        const m = page.match(/\/c\/([a-z0-9][a-z0-9-]{0,79})/i);
        if (!m) return null;
        return {
          slug: m[1].toLowerCase(),
          day,
          clicks: Math.round(r.clicks || 0),
          impressions: Math.round(r.impressions || 0),
          ctr: r.ctr != null ? Number((r.ctr * 100).toFixed(2)) : null,
          position: r.position != null ? Number(r.position.toFixed(1)) : null,
          updated_at: new Date().toISOString(),
        };
      })
      .filter(Boolean);

    if (rows.length) {
      const up = await fetch(`${SUPABASE_URL}/rest/v1/seo_board_stats?on_conflict=slug,day`, {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY,
          authorization: `Bearer ${SERVICE_KEY}`,
          'content-type': 'application/json',
          prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(rows),
      });
      if (!up.ok) return new Response(JSON.stringify({ error: 'upsert failed', detail: (await up.text()).slice(0, 200) }), { status: 502 });
    }

    return new Response(JSON.stringify({ ok: true, synced: rows.length, day }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500 });
  }
});
