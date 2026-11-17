// The signed-in app (tests/commentApp.js) plus what Send to… reads and writes:
// the chat list and people the sheet shows, rpc/send_to_status,
// rpc/send_board_to and inserts into messages. Registered after commentApp's
// catch-all, so these answer first and everything else falls through to it;
// commentApp.js itself is left as the other specs know it.
//
//   const app = await signedInForSend(page, baseURL, { canGrant, closed });
//   app.sent.rpc('send_board_to')   bodies of every call to that rpc, in order
//   app.sent.messages               bodies of every insert into messages
//   app.sent.calls                  every recorded request: { name, body }
//
// opts.canGrant   what send_to_status says about the sender (default true)
// opts.closed     user ids the cluster is still closed to (default: Maya)

import { signedIn, UID, WS, BOARD, OTHER } from './commentApp.js';

export { UID, WS, BOARD, OTHER };
export const PRIYA = '22222222-2222-4222-8222-222222222222';
export const CONV_MAYA = 'c1111111-1111-4111-8111-111111111111';
export const PEOPLE = [
  { user_id: OTHER, name: 'Maya Reyes', email: 'maya@example.com', color: '#d98c2b' },
  { user_id: PRIYA, name: 'Priya Nair', email: 'priya@example.com', color: '#6aa86a' },
];

export async function signedInForSend(page, baseURL, { canGrant = true, closed = [OTHER] } = {}) {
  const app = await signedIn(page, baseURL);
  const calls = [];
  const sent = {
    calls,
    rpc: (name) => calls.filter((c) => c.name === `rpc/${name}`).map((c) => c.body),
    get messages() { return calls.filter((c) => c.name === 'messages').map((c) => c.body); },
  };
  const iso = (m) => new Date(Date.now() - m * 60000).toISOString();
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  // Who is in each seeded conversation, other than me.
  const members = { [CONV_MAYA]: [OTHER] };

  await page.route('https://example.supabase.co/**', async (route) => {
    const req = route.request();
    const m = req.method();
    const url = req.url();
    if (m === 'OPTIONS') return route.fallback();
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(b) });
    const body = () => { try { return req.postDataJSON() || {}; } catch (_) { return {}; } };
    const one = (req.headers().accept || '').includes('vnd.pgrst.object');

    if (url.includes('/rest/v1/conversation_summary') && m === 'GET') {
      return json([{ conversation_id: CONV_MAYA, title: null, created_at: iso(500), last_message_at: iso(20), last_message_sender_id: OTHER }]);
    }
    if (url.includes('/rest/v1/conversation_participants') && m === 'GET') {
      return json([
        { conversation_id: CONV_MAYA, user_id: UID, joined_at: iso(500), left_at: null, last_read_at: iso(10) },
        { conversation_id: CONV_MAYA, user_id: OTHER, joined_at: iso(500), left_at: null, last_read_at: iso(10) },
      ]);
    }
    if (url.includes('rpc/list_messageable_users')) return json(PEOPLE);
    if (url.includes('rpc/send_to_status')) {
      const b = body();
      calls.push({ name: 'rpc/send_to_status', body: b });
      const asked = new Set([...(b.p_user_ids || []), ...(b.p_conversation_ids || []).flatMap((c) => members[c] || [])]);
      return json({ can_grant: canGrant, closed: closed.filter((id) => asked.has(id)) });
    }
    if (url.includes('rpc/send_board_to')) {
      const b = body();
      calls.push({ name: 'rpc/send_board_to', body: b });
      const dm = (u) => `d${u.slice(1)}`;
      const targets = [...(b.p_conversation_ids || []), ...(b.p_user_ids || []).map(dm)];
      return json({
        targets,
        people: (b.p_user_ids || []).map((u) => ({ user_id: u, conversation_id: dm(u), access: 'granted' })),
        conversations: (b.p_conversation_ids || []).map((c) => ({ conversation_id: c, granted: [], closed: [] })),
      });
    }
    if (url.includes('/rest/v1/messages') && m === 'POST') {
      const b = body();
      calls.push({ name: 'messages', body: b });
      const row = { ...b, created_at: new Date().toISOString(), edited_at: null, deleted_at: null };
      return json(one ? row : [row], 201);
    }
    return route.fallback();
  });
  return { ...app, sent };
}
