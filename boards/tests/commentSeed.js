// A stand-in for the comments backend, for the ?local=1 harness (which has
// none: left alone, every read and write there fails). The harness's own
// seeded cluster ('root': b-features, home-image, home-pal, b-stills,
// home-note, b-halcyon …) gets a handful of conversations, kept in memory and
// served to the page through page.route, so a spec can post, edit, resolve and
// delete and then read back what the "database" holds.
//
//   const db = await seedComments(page);            // before page.goto
//   db.rows      the comments table, live
//   db.writes    every request that was not a read, as 'METHOD /path'
//   db.calls     what was done to comments: ['POST', body] ['PATCH', id, body]
//                ['delete', id] ['restore', id]
//
//   db.reads     every read, as 'METHOD /path'
//
// opts.columns: whether the table has the columns of the migration still to come, `mentions`
// and `edited_at`. The client has to work both ways.
// opts.replyReopens: that migration's rule, switched on: a reply that lands on a resolved (or
// put-away) conversation reopens it, inside the reply's own write.

export const ME = 'local-qa-user';   // who the ?local=1 harness signs in as
const U = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
export const PEOPLE = [
  { user_id: U[0], display_name: 'Maya Reyes', color: '#d98c2b', avatar_url: null },
  { user_id: U[1], display_name: 'Theo Lindqvist', color: '#4f8fd6', avatar_url: null },
  { user_id: U[2], display_name: 'Priya Nair', color: '#6aa86a', avatar_url: null },
];
const id = (n) => `a0000000-0000-4000-8000-00000000000${n}`;
export const IDS = {
  features: id(1),      // on the Features cluster card, by Maya, one reply
  image: id(2),         // on the image, by Theo
  palette: id(3),       // on the palette, by Priya
  point: id(4),         // on a point of the canvas, by Theo
  featuresReply: id(5), // Theo's reply to `features`
  resolved: id(6),      // on Stills, by Priya, resolved
  hidden: id(7),        // on the note, by Maya, put away by the old per-comment Hide
  mine: id(8),          // on Halcyon, by me
  mineReply: id(9),     // Maya's reply to `mine`: so it waits on me ("For you")
  vote: 'c0000000-0000-4000-8000-000000000001',
};

export function commentRows({ boardId = 'root', workspaceId = 'local-workspace', me = ME } = {}) {
  const now = Date.now();
  const iso = (minutesAgo) => new Date(now - minutesAgo * 60000).toISOString();
  const row = (o) => ({
    workspace_id: workspaceId, board_id: boardId, anchor_kind: 'card', anchor_id: null, anchor_x: null, anchor_y: null,
    doc_page_id: null, doc_from: null, doc_to: null, reply_to: null, hidden: false, resolved: false,
    offset_x: 0, offset_y: 0, deleted_at: null, updated_at: iso(5), ...o,
  });
  return [
    row({ id: IDS.features, anchor_id: 'b-features', author: U[0], body: 'Warmer grade on this one, closer to the dusk stills', created_at: iso(120) }),
    row({ id: IDS.image, anchor_id: 'home-image', author: U[1], body: 'Can we get the alley at blue hour?', created_at: iso(90) }),
    row({ id: IDS.palette, anchor_id: 'home-pal', author: U[2], body: 'Love this palette for the bar scene', created_at: iso(60) }),
    row({ id: IDS.point, anchor_kind: 'point', anchor_x: 1150, anchor_y: 140, author: U[1], body: 'Leave this corner open for the title treatment', created_at: iso(30) }),
    row({ id: IDS.featuresReply, anchor_id: 'b-features', author: U[1], body: 'Agreed, I will pull the dusk set tonight', reply_to: IDS.features, created_at: iso(10) }),
    row({ id: IDS.resolved, anchor_id: 'b-stills', author: U[2], body: 'Crop this frame tighter on the left', resolved: true, created_at: iso(300) }),
    row({ id: IDS.hidden, anchor_id: 'home-note', author: U[0], body: 'Hold the inbox note until Friday', hidden: true, created_at: iso(280) }),
    row({ id: IDS.mine, anchor_id: 'b-halcyon', author: me, body: 'Halcyon needs a second pass', created_at: iso(50) }),
    row({ id: IDS.mineReply, anchor_id: 'b-halcyon', author: U[0], body: 'On it, back to you tomorrow', reply_to: IDS.mine, created_at: iso(20) }),
  ];
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

export async function seedComments(page, { rows = commentRows(), columns = true, voteCard = true, replyReopens = false } = {}) {
  const writes = [];
  const reads = [];
  const calls = [];
  let seq = 100;
  if (columns) rows.forEach((r) => { if (!('mentions' in r)) r.mentions = []; if (!('edited_at' in r)) r.edited_at = null; });
  await page.route('https://example.supabase.co/**', async (route) => {
    const req = route.request();
    const url = req.url();
    const m = req.method();
    const path = new URL(url).pathname;
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(b) });
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const one = (req.headers().accept || '').includes('vnd.pgrst.object');
    const body = () => { try { return req.postDataJSON() || {}; } catch (_) { return {}; } };
    // reads that happen to be POSTs
    if (path.endsWith('/rpc/users_by_ids')) return json(PEOPLE.map((p) => ({ user_id: p.user_id, email: `${p.display_name.split(' ')[0].toLowerCase()}@example.com` })));
    if (path.endsWith('/rpc/list_vote_cards')) {
      return json(voteCard ? [{
        id: IDS.vote, workspace_id: 'local-workspace', board_id: 'root', author: U[2], label: 'Keep the cold open?',
        anchor_kind: 'point', anchor_id: null, anchor_x: 700, anchor_y: 620, offset_x: 0, offset_y: 0,
        hidden: false, resolved: false, deleted_at: null, up_count: 2, down_count: 0, my_value: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }] : []);
    }
    if (m !== 'GET' && m !== 'HEAD') writes.push(`${m} ${path}`);
    else reads.push(`${m} ${path}`);
    if (path.includes('/rpc/list_board_shares') || path.includes('/rpc/list_inherited_board_shares')) { writes.pop(); reads.push(`${m} ${path}`); return json([]); }
    if (path.endsWith('/rpc/soft_delete_comment')) {
      const r = rows.find((x) => x.id === body().p_comment_id);
      if (r) r.deleted_at = new Date().toISOString();
      calls.push(['delete', body().p_comment_id]);
      return json(null);
    }
    if (path.endsWith('/rpc/restore_comment')) {
      const r = rows.find((x) => x.id === body().p_comment_id);
      if (r) r.deleted_at = null;
      calls.push(['restore', body().p_comment_id]);
      return json(null);
    }
    if (path.endsWith('/rest/v1/comments')) {
      if (m === 'GET') {
        // one row by id (its resolved / hidden, read after a reply), or the cluster's
        const rid = (url.match(/[?&]id=eq\.([^&]+)/) || [])[1];
        const live = rows.filter((r) => !r.deleted_at && (!rid || r.id === rid));
        if (rid) calls.push(['GET', rid]);
        return json(one ? (live[0] || null) : live);
      }
      const b = body();
      if (!columns && (('mentions' in b) || ('edited_at' in b))) {
        const col = 'mentions' in b ? 'mentions' : 'edited_at';
        calls.push([m, 'REFUSED', col]);
        return json({ code: 'PGRST204', message: `Could not find the '${col}' column of 'comments' in the schema cache` }, 400);
      }
      if (m === 'POST') {
        seq += 1;
        const r = {
          id: `b0000000-0000-4000-8000-000000000${seq}`, hidden: false, resolved: false, deleted_at: null,
          anchor_id: null, anchor_x: null, anchor_y: null, reply_to: null, offset_x: 0, offset_y: 0,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          ...(columns ? { mentions: [], edited_at: null } : {}), ...b,
        };
        rows.push(r);
        if (replyReopens && r.reply_to) {
          const root = rows.find((x) => x.id === r.reply_to);
          if (root) { root.resolved = false; root.hidden = false; }
        }
        calls.push(['POST', b]);
        return json(one ? r : [r], 201);
      }
      if (m === 'PATCH') {
        const rid = (url.match(/id=eq\.([^&]+)/) || [])[1];
        const r = rows.find((x) => x.id === rid);
        if (r) { Object.assign(r, b); if (columns && 'body' in b) r.edited_at = new Date().toISOString(); }
        calls.push(['PATCH', rid, b]);
        return json(one ? r : (r ? [r] : []));
      }
    }
    if (path.endsWith('/rest/v1/member_profiles')) return json(PEOPLE);
    if (m === 'GET' && one) return json({ code: 'PGRST116', message: 'no rows' }, 406);
    return json([]);
  });
  return { rows, writes, reads, calls };
}

// The canvas, with its comments in: `open` real pins are on it.
export async function openSeeded(page, { query = '', pins = 5 } = {}) {
  await page.goto(`/?local=1&reset=1${query}`);
  await page.locator('.canvas-wrap').waitFor({ state: 'visible', timeout: 60000 });
  if (pins != null) await page.locator('.cmt-pin[data-cmt-pin], .cmt-pin--count').first().waitFor({ state: 'attached', timeout: 30000 });
}

// The zoom the canvas is at, as its own readout says it ("100%").
export const zoomPct = (page) => page.locator('.cnv-zoom-val').innerText().then((t) => parseInt(t, 10));

// Set the zoom with the canvas's own slider (a log scale from 10% to 500%).
export async function setZoom(page, pct) {
  const v = Math.round((Math.log(pct / 10) / Math.log(50)) * 1000);
  await page.locator('.cnv-zoom-slider').fill(String(v));
  await page.waitForFunction((want) => parseInt(document.querySelector('.cnv-zoom-val')?.textContent || '', 10) === want, pct);
}

// How many conversations the pins on the canvas stand for: each pin is one,
// a count pin as many as it says.
export const pinTally = (page) => page.evaluate(() => {
  const singles = document.querySelectorAll('.cmt-pin[data-cmt-pin]').length;
  const counts = [...document.querySelectorAll('.cmt-pin--count .cmt-pin-n')].map((e) => parseInt(e.textContent, 10));
  return { singles, counts, total: singles + counts.reduce((a, b) => a + b, 0) };
});
