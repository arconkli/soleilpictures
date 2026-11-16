// The real signed-in app, every Supabase call answered by the test, for the
// comment paths the harnesses cannot reach: a note or a doc on a real cluster
// (its Y.Doc, App.jsx's router and its links). The cluster's content is held
// here as the app saves it (board_state.doc) and handed back on the next
// load, so a link opened in a second page.goto finds what the first wrote.
//
//   const app = await signedIn(page, baseURL);
//   app.state.doc    what was last saved      app.state.saves  how many saves
//   opts.rows        the comments table (canvas comments), empty unless given
//
// pointRows() is two conversations on points of the cluster's canvas (no card
// needed), for opts.rows: POINT.theirs by Maya with a reply, POINT.mine by me.

export const UID = '99999999-9999-4999-8999-999999999999';
export const WS = '77777777-7777-4777-8777-777777777777';
export const BOARD = '55555555-5555-4555-8555-555555555555';
export const OTHER = '11111111-1111-4111-8111-111111111111';
// An empty Y.Doc as board_state holds one (base64 of its update): with it the
// cluster reads as loaded from the server, not only from this device's copy.
const EMPTY_DOC = 'AAA=';

export const POINT = { theirs: 'a0000000-0000-4000-8000-000000000001', reply: 'a0000000-0000-4000-8000-000000000002', mine: 'a0000000-0000-4000-8000-000000000003' };
export function pointRows() {
  const now = Date.now();
  const iso = (m) => new Date(now - m * 60000).toISOString();
  const row = (o) => ({
    workspace_id: WS, board_id: BOARD, anchor_kind: 'point', anchor_id: null, anchor_x: 500, anchor_y: 520,
    doc_page_id: null, doc_from: null, doc_to: null, reply_to: null, hidden: false, resolved: false,
    offset_x: 0, offset_y: 0, deleted_at: null, updated_at: iso(5), mentions: [], edited_at: null, ...o,
  });
  return [
    row({ id: POINT.theirs, author: OTHER, body: 'Leave this corner open for the title treatment', created_at: iso(120) }),
    row({ id: POINT.reply, author: UID, body: 'Agreed, keeping it clear', reply_to: POINT.theirs, created_at: iso(30) }),
    row({ id: POINT.mine, author: UID, anchor_x: 820, anchor_y: 380, body: 'Second pass on the light here', created_at: iso(50) }),
  ];
}

export async function signedIn(page, baseURL, { rows = [] } = {}) {
  const now = Date.now();
  const iso = (m) => new Date(now - m * 60000).toISOString();
  const state = { doc: EMPTY_DOC, saves: 0 };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const user = {
    id: UID, aud: 'authenticated', role: 'authenticated', email: 'tester@example.com', email_confirmed_at: iso(9999),
    app_metadata: { provider: 'email' }, user_metadata: { full_name: 'Tess Tester' }, created_at: iso(99999),
  };
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, exp: Math.floor(now / 1000) + 3600, role: 'authenticated', email: user.email })}.sig`;
  const session = { access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(now / 1000) + 3600, user };
  const workspace = { id: WS, name: 'Test Studio', owner: UID, created_at: iso(99999), kind: 'personal' };
  const board = {
    id: BOARD, workspace_id: WS, parent_board_id: null, name: 'Test Studio', title: 'Test Studio', deleted_at: null,
    created_at: iso(9999), updated_at: iso(99), created_by: UID, view: 'canvas', position: 0,
  };
  await page.addInitScript((s) => {
    try {
      if (!sessionStorage.getItem('planted')) {
        localStorage.setItem('sb-example-auth-token', s);
        sessionStorage.setItem('planted', '1');
      }
    } catch (_) { /* the app then shows its sign-in page, and the test says so */ }
  }, JSON.stringify(session));
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  await page.route(/.*/, async (route) => {
    const req = route.request();
    const url = req.url();
    const m = req.method();
    if (url.startsWith(baseURL)) return route.fallback();
    if (!url.startsWith('https://example.supabase.co')) return route.abort();
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(b) });
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const one = (req.headers().accept || '').includes('vnd.pgrst.object');
    if (url.includes('/auth/v1/user')) return json(user);
    if (url.includes('/auth/v1/token')) return json(session);
    if (url.includes('/auth/v1/')) return json({});
    if (url.includes('rpc/get_my_tier')) return json([{ tier: 'admin', demo_card_count: 0, onboarding: { done: true } }]);
    if (url.includes('rpc/get_or_create_personal_workspace')) return json(workspace);
    if (url.includes('/rest/v1/workspace_members')) return json([{ workspace_id: WS, role: 'owner', created_at: iso(9999), user_id: UID, workspaces: workspace }]);
    if (url.includes('/rest/v1/boards') && m === 'GET') return one ? json(board) : json([board]);
    if (url.includes('/rest/v1/board_state')) {
      if (m === 'GET') return json(one ? { doc: state.doc } : [{ doc: state.doc }]);
      let b = null;
      try { b = req.postDataJSON(); } catch (_) { /* not a save */ }
      const doc = Array.isArray(b) ? b[0]?.doc : b?.doc;
      if (doc) { state.doc = doc; state.saves += 1; }
      return json([]);
    }
    if (url.includes('/rest/v1/comments')) return json(m === 'GET' ? rows.filter((r) => !r.deleted_at) : []);
    if (url.includes('/rest/v1/member_profiles')) {
      return json([
        { user_id: OTHER, display_name: 'Maya Reyes', color: '#d98c2b', avatar_url: null },
        { user_id: UID, display_name: 'Tess Tester', color: '#4f8fd6', avatar_url: null },
      ]);
    }
    if (m === 'GET' && one) return json({ code: 'PGRST116', message: 'no rows' }, 406);
    if (url.includes('/functions/') || url.includes('/storage/')) return json({});
    return json([]);
  });
  await page.routeWebSocket(/.*/, (ws) => { if (ws.url().startsWith(baseURL.replace(/^http/, 'ws'))) ws.connectToServer(); else ws.close(); });
  return { rows, state };
}
