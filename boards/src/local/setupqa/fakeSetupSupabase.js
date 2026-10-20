// An in-memory fake of the Supabase client, just enough for the first-run
// setup (?setupqa=1, local/SetupQaHarness.jsx): sign-in by code, the tier
// read, the setup gate's reads, the workspace bootstrap and rename, the
// profile settings merge, workspace invites and invite links (0450/0451), and
// the analytics insert, which it keeps so a spec can read what was logged.
//
// Plain JS with no Vite or React imports. Dev only: the harness installs it
// through supabase.js's installSupabaseForQa, a no-op outside a DEV build.
//
// Rules it keeps, because the real thing does:
//  - a query builder is a thenable with ONLY `then`: a stray `.catch()` on a
//    builder is a TypeError here, as it is quietly wrong against PostgREST;
//  - an RPC's refusal resolves { error } with the server's message and hint;
//  - only a workspace's owner can rename it, and a refused update matches zero
//    rows and raises nothing (RLS);
//  - verifyOtp tells onAuthStateChange listeners SIGNED_IN before it returns.

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const nowIso = () => new Date().toISOString();

function uuid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const QA_LINK_TOKEN = '6f1c2a9e-3b7d-4c55-9a1e-2d4b8c0f7a31';

// The people and the workspace someone can be invited into, and the account
// that signs in (or already is).
export function buildSetupDb({ signedOut = false, invitee = false, resume = null, linkMode = null, inviteLimitAt = null, deadLink = false, inws = null } = {}) {
  const me = { id: 'qa-me', email: 'maya@example.com', created_at: nowIso() };
  const lostTime = { id: 'ws-lost-time', name: 'Lost Time', created_by: 'qa-nora', created_at: '2026-09-01T00:00:00Z' };
  const db = {
    users: [me],
    session: signedOut ? null : { access_token: 'qa', user: me },
    tier: 'demo',
    profiles: [{ user_id: me.id, settings: {} }],
    workspaces: [lostTime],
    members: [
      { workspace_id: lostTime.id, user_id: 'qa-nora', role: 'owner', created_at: '2026-09-01T00:00:00Z' },
      { workspace_id: lostTime.id, user_id: 'qa-jon', role: 'editor', created_at: '2026-09-02T00:00:00Z' },
      { workspace_id: lostTime.id, user_id: 'qa-priya', role: 'editor', created_at: '2026-09-03T00:00:00Z' },
    ],
    people: [
      { user_id: 'qa-nora', display_name: 'Nora Vance', color: '#c9774b' },
      { user_id: 'qa-jon', display_name: 'Jon Park', color: '#4b8bc9' },
      { user_id: 'qa-priya', display_name: 'Priya Shah', color: '#7a5bc9' },
      { user_id: me.id, display_name: 'Maya Chen', color: '#9a6b88' },
    ],
    boards: [],
    links: {
      [`${lostTime.id}:editor`]: {
        token: QA_LINK_TOKEN, workspace_id: lostTime.id, role: 'editor', uses: 2, max_uses: 25,
        expires_at: new Date(Date.now() + 20 * 864e5).toISOString(), live: !deadLink, created_by: 'qa-nora',
      },
    },
    linkMode,
    inviteLimitAt,
    invitesSent: 0,
    invites: [],
    events: [],
  };
  if (invitee) {
    db.members.push({ workspace_id: lostTime.id, user_id: me.id, role: 'editor', created_at: nowIso() });
  }
  if (resume === 'who' || resume === 'invite') {
    const mine = { id: 'ws-northlight', name: 'Northlight', created_by: me.id, personal: true, created_at: nowIso() };
    db.workspaces.push(mine);
    db.members.push({ workspace_id: mine.id, user_id: me.id, role: 'owner', created_at: nowIso() });
    db.profiles[0].settings.welcome = {
      v: 1, step: resume, done: false, invitee: false,
      team: resume === 'invite' ? 'few' : null, work: resume === 'invite' ? 'film' : null,
      invite: null, named_at: nowIso(), done_at: null,
    };
  }
  // In the workspace after the setup (SetupInWorkspace): their own Northlight,
  // the setup finished, the invite step skipped for the re-ask and done for the
  // tips; or, as a joiner, a member of Nora's Lost Time.
  if (inws === 'tips' || inws === 'reask') {
    const mine = { id: 'ws-northlight', name: 'Northlight', created_by: me.id, personal: true, created_at: nowIso() };
    db.workspaces.push(mine);
    db.members.push({ workspace_id: mine.id, user_id: me.id, role: 'owner', created_at: nowIso() });
    db.profiles[0].settings.welcome = {
      v: 1, step: 'done', done: true, invitee: false, team: 'few', work: 'film',
      invite: inws === 'reask' ? 'skipped' : 'sent', named_at: nowIso(), done_at: nowIso(),
    };
  } else if (inws === 'joiner' && !invitee) {
    db.members.push({ workspace_id: lostTime.id, user_id: me.id, role: 'editor', created_at: nowIso() });
  }
  return db;
}

// onWrite(db) runs after every call, so the harness can keep the fake across a
// reload (joining by the card reloads into the workspace).
export function createSetupFake({ db, latency = 0, onWrite } = {}) {
  if (!db) throw new Error('createSetupFake needs a db');
  const calls = [];
  const listeners = new Set();
  let latencyMs = latency;
  const wait = () => (latencyMs ? new Promise((r) => setTimeout(r, latencyMs)) : Promise.resolve());
  const me = () => db.session?.user?.id || null;
  const written = (v) => { try { onWrite?.(db); } catch (_) { /* keeping it is best-effort */ } return v; };
  const result = (data, error = null) => ({ data, error, status: error ? 400 : 200, statusText: error ? 'Bad Request' : 'OK' });
  const refuse = (message, extra = {}) => result(null, { message, code: 'P0001', details: null, hint: null, ...extra });

  function profileOf(uid) {
    let p = db.profiles.find((r) => r.user_id === uid);
    if (!p) { p = { user_id: uid, settings: {} }; db.profiles.push(p); }
    return p;
  }
  const linkByToken = (t) => Object.values(db.links).find((l) => l.token === t) || null;
  const isMember = (wsId, uid) => db.members.some((m) => m.workspace_id === wsId && m.user_id === uid);

  function handleRpc(name, a = {}) {
    const uid = me();
    switch (name) {
      case 'get_my_tier': {
        if (!uid) return refuse('not signed in', { code: '42501' });
        const p = profileOf(uid);
        return result([{
          tier: db.tier, onboarding: p.settings.onboarding || {}, demo_card_count: 0, effective_card_limit: 50,
          banned: false, ad_offer_pending: false, bonus_card_credits: 0,
        }]);
      }
      case 'merge_profile_settings': {
        const p = profileOf(uid);
        Object.assign(p.settings, clone(a.p_patch || {}));
        return result(clone(p.settings));
      }
      case 'get_or_create_personal_workspace': {
        let w = db.workspaces.find((x) => x.created_by === uid && x.personal);
        if (!w) {
          w = { id: uuid(), name: a.p_name || 'Personal Workspace', created_by: uid, personal: true, created_at: nowIso() };
          db.workspaces.push(w);
          db.members.push({ workspace_id: w.id, user_id: uid, role: 'owner', created_at: nowIso() });
        }
        return result(clone(w));
      }
      case 'create_workspace_invite_link': {
        if (db.linkMode === 'limit') return refuse('workspace invite link limit reached', { hint: 'link_limit', code: '54000' });
        if (db.linkMode === 'paused') return refuse('sharing is paused on this account while we review unusual activity');
        if (db.linkMode === 'error') return refuse('something went wrong', { code: 'XX000' });
        const key = `${a.p_workspace_id}:${a.p_role}`;
        db.links[key] ||= {
          token: uuid(), workspace_id: a.p_workspace_id, role: a.p_role, uses: 0, max_uses: 5,
          expires_at: new Date(Date.now() + 7 * 864e5 - 60000).toISOString(), live: true, created_by: uid,
        };
        return result(db.links[key].token);
      }
      case 'get_workspace_invite_link_terms': {
        const l = linkByToken(a.p_token);
        if (!l || l.created_by !== uid) return result([]);
        return result([{ role: l.role, expires_at: l.expires_at, max_uses: l.max_uses, uses: l.uses, live: l.live }]);
      }
      case 'invite_workspace_member': {
        const e = String(a.p_email || '').toLowerCase();
        if (db.inviteLimitAt != null && db.invitesSent >= db.inviteLimitAt) {
          return refuse(`invite limit reached: a new account can send ${db.inviteLimitAt} invitations on its first day. You can send more tomorrow.`);
        }
        if (e.startsWith('fail')) return refuse('could not send that invitation', { code: 'XX000' });
        db.invitesSent += 1;
        db.invites.push({ email: e, role: a.p_role, workspace_id: a.p_workspace_id });
        if (e.startsWith('member')) return result('already_member');
        if (e.startsWith('known')) return result('granted');
        return result('pending');
      }
      case 'peek_workspace_invite_link': {
        const l = linkByToken(a.p_token);
        if (!l || !l.live) return result([{ status: 'dead', workspace_name: null, inviter_name: null, role: null }]);
        const ws = db.workspaces.find((w) => w.id === l.workspace_id);
        const maker = db.people.find((p) => p.user_id === l.created_by);
        return result([{
          status: uid && isMember(l.workspace_id, uid) ? 'member' : 'live',
          workspace_name: ws?.name || 'a workspace',
          inviter_name: String(maker?.display_name || '').split(' ')[0] || 'Someone',
          role: l.role,
        }]);
      }
      case 'claim_workspace_invite_link': {
        if (!uid) return refuse('sign in to join', { code: '42501' });
        const l = linkByToken(a.p_token);
        if (!l || !l.live) return result([{ workspace_id: null, role: null, status: 'dead' }]);
        if (isMember(l.workspace_id, uid)) return result([{ workspace_id: l.workspace_id, role: 'editor', status: 'member' }]);
        db.members.push({ workspace_id: l.workspace_id, user_id: uid, role: l.role, created_at: nowIso() });
        l.uses += 1;
        return result([{ workspace_id: l.workspace_id, role: l.role, status: 'joined' }]);
      }
      default:
        return result(null);
    }
  }

  function rpc(name, args) {
    calls.push({ kind: 'rpc', name, args: clone(args) });
    return { then: (res, rej) => wait().then(() => written(handleRpc(name, args))).then(res, rej) };
  }

  const TABLES = {
    profiles: () => db.profiles,
    workspace_members: () => db.members,
    workspaces: () => db.workspaces,
    member_profiles: () => db.people,
    boards: () => db.boards,
  };
  const matches = (row, filters) => filters.every(([op, c, v]) => (
    op === 'eq' ? row[c] === v : op === 'in' ? (v || []).includes(row[c]) : op === 'is' ? (row[c] ?? null) === v : true
  ));

  function runQuery(q) {
    calls.push({ kind: 'from', table: q.table, op: q.op, filters: clone(q.filters), payload: clone(q.payload) });
    if (q.table === 'analytics_events' && q.op === 'insert') {
      const rows = Array.isArray(q.payload) ? q.payload : [q.payload];
      db.events.push(...rows.map(clone));
      return result(null);
    }
    const source = TABLES[q.table]?.();
    if (!source) return result(q.maybe || q.single ? null : []);
    if (q.op === 'update') {
      const hit = source.filter((r) => matches(r, q.filters));
      const allowed = q.table === 'workspaces' ? hit.filter((w) => w.created_by === me()) : hit;
      allowed.forEach((r) => Object.assign(r, clone(q.payload)));
      return result(null);
    }
    if (q.op === 'insert' || q.op === 'upsert') {
      const rows = Array.isArray(q.payload) ? q.payload : [q.payload];
      source.push(...rows.map(clone));
      return result(null);
    }
    let out = source.filter((r) => matches(r, q.filters)).map((r) => {
      const row = clone(r);
      if (q.table === 'workspace_members' && /workspaces\(/.test(q.cols)) {
        row.workspaces = clone(db.workspaces.find((w) => w.id === r.workspace_id) || null);
      }
      return row;
    });
    if (q.order) {
      const [col, opts] = q.order;
      const dir = opts?.ascending === false ? -1 : 1;
      out = out.sort((x, y) => (x[col] > y[col] ? dir : x[col] < y[col] ? -dir : 0));
    }
    if (q.limit != null) out = out.slice(0, q.limit);
    if (q.maybe || q.single) return result(out[0] ?? null);
    return result(out);
  }

  function from(table) {
    const q = { table, op: 'select', cols: '*', filters: [], payload: null, maybe: false, single: false, limit: null, order: null };
    const api = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') return (res, rej) => wait().then(() => written(runQuery(q))).then(res, rej);
        if (prop === 'catch' || prop === 'finally') return undefined;
        switch (prop) {
          case 'select': return (cols = '*') => { if (q.op === 'select') q.cols = cols; return api; };
          case 'insert': return (p) => { q.op = 'insert'; q.payload = p; return api; };
          case 'upsert': return (p) => { q.op = 'upsert'; q.payload = p; return api; };
          case 'update': return (p) => { q.op = 'update'; q.payload = p; return api; };
          case 'delete': return () => { q.op = 'delete'; return api; };
          case 'eq': return (c, v) => { q.filters.push(['eq', c, v]); return api; };
          case 'in': return (c, v) => { q.filters.push(['in', c, v]); return api; };
          case 'is': return (c, v) => { q.filters.push(['is', c, v]); return api; };
          case 'order': return (c, o) => { q.order = [c, o]; return api; };
          case 'limit': return (n) => { q.limit = n; return api; };
          case 'maybeSingle': return () => { q.maybe = true; return api; };
          case 'single': return () => { q.single = true; return api; };
          default: return () => api;
        }
      },
    });
    return api;
  }

  const notify = (event) => { for (const cb of [...listeners]) { try { cb(event, clone(db.session)); } catch (_) { /* a listener's problem */ } } };

  const auth = {
    async getSession() { await wait(); return { data: { session: clone(db.session) }, error: null }; },
    async getUser() { return { data: { user: clone(db.session?.user || null) }, error: null }; },
    onAuthStateChange(cb) {
      listeners.add(cb);
      return { data: { subscription: { unsubscribe() { listeners.delete(cb); } } } };
    },
    async signInWithOtp({ email } = {}) {
      calls.push({ kind: 'auth', name: 'signInWithOtp', email });
      await wait();
      return { data: {}, error: null };
    },
    async verifyOtp({ email, token } = {}) {
      calls.push({ kind: 'auth', name: 'verifyOtp', email });
      await wait();
      if (token === '000000') return { data: {}, error: { message: 'Token has expired or is invalid', status: 403 } };
      let user = db.users.find((u) => u.email === email);
      if (!user) { user = { id: 'qa-new', email, created_at: nowIso() }; db.users.push(user); }
      db.session = { access_token: 'qa', user };
      written();
      notify('SIGNED_IN');
      return { data: { session: clone(db.session), user: clone(user) }, error: null };
    },
    async signOut() { db.session = null; written(); notify('SIGNED_OUT'); return { error: null }; },
    async refreshSession() { return { data: { session: clone(db.session) }, error: null }; },
    async exchangeCodeForSession() { return { data: { session: clone(db.session) }, error: null }; },
  };

  function channel() {
    const ch = {
      on: () => ch,
      subscribe: (cb) => { try { cb?.('SUBSCRIBED'); } catch (_) {} return ch; },
      unsubscribe: async () => 'ok',
      send: async () => 'ok',
      track: async () => 'ok',
      untrack: async () => 'ok',
      presenceState: () => ({}),
    };
    return ch;
  }

  return {
    auth,
    rpc,
    from,
    channel,
    removeChannel: async () => 'ok',
    removeAllChannels: async () => [],
    getChannels: () => [],
    realtime: { setAuth() {}, connect() {}, disconnect() {}, channels: [] },
    storage: { from: () => ({ upload: async () => ({ data: null, error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }), createSignedUrl: async () => ({ data: null, error: null }) }) },
    functions: { invoke: async () => ({ data: null, error: null }) },
    qa: {
      db,
      calls,
      events: () => db.events.map((e) => ({ event: e.event, props: e.props })),
      setLatency(ms) { latencyMs = Number(ms) || 0; },
      setLinkMode(mode) { db.linkMode = mode || null; },
    },
  };
}
