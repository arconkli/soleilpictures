// signedInStub — boots the REAL signed-in app with every Supabase request
// stubbed, so a spec can exercise paths ?local=1 never reaches (it renders a
// harness, not App). Nothing leaves the machine: the dev host is passed
// through, example.supabase.co is answered here, and every other host is
// aborted (the one console error to expect is net::ERR_FAILED from those).
//
//   const { calls } = await bootSignedIn(page, { rpc: { list_my_teams: [...] }, path: '/team' });
//   await page.waitForSelector('.sb-ws-trigger');
//   calls.filter((c) => c.path === 'rpc/invite_to_team')   // what was sent
//
// rpc[name]   a value, or (body) => value, or { status, body } for an error.
// rest[table] a value, or (url, method) => value, or { status, body }.
// functions[name] a value, or (body) => value, or { status, body }.
// Use only @example.com addresses.

export const USER_ID = '11111111-1111-4111-8111-111111111111';
export const WS_ID = '22222222-2222-4222-8222-222222222222';
export const ROOT_ID = '33333333-3333-4333-8333-333333333333';
export const ORG = '44444444-4444-4444-8444-444444444444';

const SUPABASE_HOST = 'example.supabase.co';
const DEV_HOSTS = new Set(['127.0.0.1', 'localhost']);

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

function sessionFor(email) {
  const now = Math.floor(Date.now() / 1000);
  const jwt = [
    b64url({ alg: 'HS256', typ: 'JWT' }),
    b64url({ sub: USER_ID, email, exp: now + 3600, role: 'authenticated', aud: 'authenticated' }),
    'sig',
  ].join('.');
  return {
    access_token: jwt,
    refresh_token: 'r',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    user: {
      id: USER_ID, email, aud: 'authenticated', role: 'authenticated',
      user_metadata: { full_name: 'Sam Rivera' }, app_metadata: {},
    },
  };
}

const hasStatus = (v) => v && typeof v === 'object' && !Array.isArray(v) && typeof v.status === 'number';

export async function bootSignedIn(page, { rpc = {}, rest = {}, functions = {}, email = 'sam@example.com', path = '/' } = {}) {
  const calls = [];
  const session = sessionFor(email);
  const created = '2026-10-01T00:00:00Z';
  const workspace = { id: WS_ID, name: 'Studio work', created_by: USER_ID, org_id: null, created_at: created };
  const root = {
    id: ROOT_ID, workspace_id: WS_ID, parent_board_id: null, deleted_at: null, name: 'Studio',
    kind: 'canvas', created_by: USER_ID, created_at: created,
  };

  await page.addInitScript((s) => {
    try { localStorage.setItem('sb-example-auth-token', JSON.stringify(s)); } catch (_) {}
  }, session);

  const cors = (req) => ({
    'access-control-allow-origin': req.headers().origin || '*',
    'access-control-allow-headers': req.headers()['access-control-request-headers'] || '*',
    'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'access-control-expose-headers': '*',
  });

  const send = (route, value, status = 200) => {
    let code = status;
    let body = value;
    if (hasStatus(value)) { code = value.status; body = value.body; }
    return route.fulfill({
      status: code,
      headers: { ...cors(route.request()), 'content-type': 'application/json' },
      body: JSON.stringify(body === undefined ? null : body),
    });
  };

  const resolve = (v, ...args) => (typeof v === 'function' ? v(...args) : v);

  await page.context().route(/.*/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (DEV_HOSTS.has(url.hostname)) return route.continue();
    if (url.hostname !== SUPABASE_HOST) return route.abort();
    if (req.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: cors(req) });
    }

    const method = req.method();
    let body = null;
    try { body = req.postDataJSON(); } catch (_) { body = req.postData() || null; }
    const p = url.pathname;

    if (p.startsWith('/auth/v1/user')) return send(route, session.user);
    if (p.startsWith('/auth/v1/token')) return send(route, session);
    if (p.startsWith('/auth/v1/')) return send(route, {});

    if (p.startsWith('/rest/v1/rpc/')) {
      const name = p.slice('/rest/v1/rpc/'.length);
      calls.push({ path: `rpc/${name}`, method, body });
      if (Object.prototype.hasOwnProperty.call(rpc, name)) return send(route, resolve(rpc[name], body));
      if (name === 'get_my_tier') return send(route, [{ tier: 'admin', demo_card_count: 0, onboarding: { done: true } }]);
      if (name === 'get_or_create_personal_workspace') return send(route, workspace);
      return send(route, []);
    }

    if (p.startsWith('/rest/v1/')) {
      const table = p.slice('/rest/v1/'.length);
      calls.push({ path: table, method, body });
      if (Object.prototype.hasOwnProperty.call(rest, table)) return send(route, resolve(rest[table], url, method));
      if (method === 'GET' && table === 'workspace_members') {
        return send(route, [{ workspace_id: WS_ID, role: 'owner', created_at: created, user_id: USER_ID, workspaces: workspace }]);
      }
      if (method === 'GET' && table === 'boards') return send(route, [root]);
      if (method === 'GET' && String(req.headers().accept || '').includes('vnd.pgrst.object')) {
        return send(route, { code: 'PGRST116', message: 'no rows', details: null, hint: null }, 406);
      }
      return send(route, []);
    }

    if (p.startsWith('/functions/v1/')) {
      const name = p.slice('/functions/v1/'.length).split('?')[0];
      calls.push({ path: `functions/${name}`, method, body });
      if (Object.prototype.hasOwnProperty.call(functions, name)) return send(route, resolve(functions[name], body));
      return send(route, {});
    }

    if (p.startsWith('/storage/')) {
      calls.push({ path: p.slice(1), method, body });
      return send(route, []);
    }

    return send(route, {});
  });

  // Closing Vite's HMR socket makes the client reload, so only the dev host's
  // sockets connect through.
  await page.context().routeWebSocket(/.*/, (ws) => {
    let host = '';
    try { host = new URL(ws.url()).hostname; } catch (_) {}
    if (DEV_HOSTS.has(host)) ws.connectToServer();
    else ws.close();
  });

  await page.goto(path);
  return { calls };
}
