// An in-memory fake of the Supabase client, just enough for the Messages panel
// (?msgqa=1, local/MessagesQaHarness.jsx): PostgREST-style queries over a few
// tables, the messaging RPCs, a storage bucket, and realtime channels.
//
// Plain JS with no Vite or React imports, so node --test can import it. Dev
// only: the harness installs it through supabase.js's installSupabaseForQa,
// which is a no-op outside a DEV build.
//
// Rules it keeps, because the real thing does:
//  - a query builder is a thenable with ONLY `then` (no catch/finally): a stray
//    `.catch()` on a builder is a TypeError here exactly as it is quietly wrong
//    against PostgREST, and the fake must fail loudly;
//  - you see only conversations you participate in; conversation_participants
//    updates touch only your own row; messages updates only your own 'user'
//    rows; a refused write matches zero rows and raises nothing (RLS);
//  - a channel `.on()` after `.subscribe()` throws, and channels are deduped by
//    topic within one client;
//  - the messages-insert trigger bumps conversations.last_message_at and, for
//    non-system rows, broadcasts 'inbox-ping' to every other active
//    participant's `user:<id>` topic (migration 0081).

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

function uuid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const err = (message, code = 'XX000', extra = {}) => ({ message, code, details: null, hint: null, ...extra });
const TIME_COLS = new Set(['created_at', 'last_message_at', 'last_read_at', 'left_at', 'joined_at', 'edited_at', 'deleted_at', 'updated_at']);
const ms = (v) => (v == null ? null : (typeof v === 'number' ? v : Date.parse(v)));

// Tables the Messages panel (or something it mounts) reads that this fake has
// nothing to say about. They answer empty rather than erroring.
const EMPTY_TABLES = new Set([
  'entity_search', 'entity_aliases', 'entity_ignore_terms', 'tags', 'boards', 'card_index',
]);

export function createFakeSupabase({ db, selfId, latency = 0, onCall } = {}) {
  if (!db) throw new Error('createFakeSupabase needs a db');
  db.messages ||= [];
  db.conversations ||= [];
  db.conversation_participants ||= [];
  db.people ||= [];
  db.storage ||= new Map();

  let latencyCfg = latency;
  const failures = []; // { target, times, error }
  const calls = [];
  const hooks = {};
  let lastStamp = 0;

  const clock = {
    skew: 0,
    // Monotonic, so two writes in one millisecond still order.
    now() {
      const t = Math.max(Date.now() + clock.skew, lastStamp + 1);
      lastStamp = t;
      return new Date(t).toISOString();
    },
  };

  // Every channel on every client, by topic: the wire. A client dedupes by
  // topic; the wire does not, which is how a second client (another browser)
  // can hear the first.
  const bus = new Map();
  const clients = [];

  function record(kind, target, args) {
    const entry = { kind, target, args: clone(args), at: Date.now() };
    calls.push(entry);
    try { onCall?.(entry); } catch (_) {}
    return entry;
  }
  function wait(target) {
    let ms_ = 0;
    if (typeof latencyCfg === 'number') ms_ = latencyCfg;
    else if (latencyCfg && typeof latencyCfg === 'object') ms_ = latencyCfg[target] ?? latencyCfg.default ?? 0;
    return new Promise((r) => setTimeout(r, ms_));
  }
  function takeFailure(target) {
    const f = failures.find((x) => x.target === target && x.times > 0);
    if (!f) return null;
    f.times--;
    return f.error;
  }

  // ── data helpers ───────────────────────────────────────────────────
  const personById = (id) => db.people.find((p) => p.user_id === id) || null;
  const myPart = (conversationId, uid) =>
    db.conversation_participants.find((p) => p.conversation_id === conversationId && p.user_id === uid) || null;
  const convIdsOf = (uid) => new Set(db.conversation_participants.filter((p) => p.user_id === uid).map((p) => p.conversation_id));
  const isActive = (conversationId, uid) => { const p = myPart(conversationId, uid); return !!p && !p.left_at; };

  function summaryRows(uid) {
    const mine = convIdsOf(uid);
    return db.conversations.filter((c) => mine.has(c.id)).map((c) => {
      let lm = null;
      for (const m of db.messages) {
        if (m.conversation_id !== c.id || m.deleted_at) continue;
        if (!lm || m.created_at > lm.created_at) lm = m;
      }
      return {
        conversation_id: c.id,
        workspace_id: c.workspace_id,
        title: c.title ?? null,
        created_by: c.created_by,
        created_at: c.created_at,
        last_message_at: c.last_message_at ?? null,
        last_message_body: lm ? lm.body : null,
        last_message_sender_id: lm ? lm.sender_id : null,
        last_message_sender_email: lm ? lm.sender_email : null,
        last_message_kind: lm ? lm.kind : null,
        active_participant_count: db.conversation_participants.filter((p) => p.conversation_id === c.id && !p.left_at).length,
      };
    });
  }

  function visibleRows(table, uid) {
    const mine = convIdsOf(uid);
    switch (table) {
      case 'messages': return db.messages.filter((m) => mine.has(m.conversation_id));
      case 'conversation_participants': return db.conversation_participants.filter((p) => mine.has(p.conversation_id));
      case 'conversations': return db.conversations.filter((c) => mine.has(c.id));
      case 'conversation_summary': return summaryRows(uid);
      case 'member_profiles':
      case 'profiles':
        return db.people.map((p) => ({ user_id: p.user_id, display_name: p.name, color: p.color || null, avatar_url: null }));
      default:
        return EMPTY_TABLES.has(table) ? [] : null;
    }
  }

  // ── realtime wire ──────────────────────────────────────────────────
  function deliver(topic, event, payload, { except = null } = {}) {
    for (const ch of [...(bus.get(topic) || [])]) {
      if (ch === except || ch.state !== 'joined') continue;
      for (const b of ch.bindings) {
        if (b.type !== 'broadcast') continue;
        if (b.filter.event !== '*' && b.filter.event !== event) continue;
        try { b.cb({ type: 'broadcast', event, payload: clone(payload) }); }
        catch (e) { console.error('[fakeSupabase] broadcast handler threw', e); }
      }
    }
  }

  function filterPasses(filter, row) {
    if (!filter) return true;
    const m = /^([^=]+)=eq\.(.*)$/.exec(filter);
    if (!m) return true;
    return String(row?.[m[1]]) === m[2];
  }
  function emitChange(table, eventType, newRow, oldRow = null) {
    const row = newRow || oldRow;
    for (const client of clients) {
      const visible = (() => {
        if (table === 'conversation_participants') return convIdsOf(client.selfId).has(row.conversation_id);
        if (table === 'conversations') return convIdsOf(client.selfId).has(row.id);
        return false; // messages and the rest are not in the publication
      })();
      if (!visible) continue;
      for (const ch of client.registry.values()) {
        if (ch.state !== 'joined') continue;
        for (const b of ch.bindings) {
          if (b.type !== 'postgres_changes') continue;
          const f = b.filter || {};
          if (f.table && f.table !== table) continue;
          if (f.event && f.event !== '*' && f.event !== eventType) continue;
          if (!filterPasses(f.filter, row)) continue;
          try {
            b.cb({
              schema: 'public', table, eventType, commit_timestamp: clock.now(),
              new: clone(newRow) || {}, old: clone(oldRow) || {}, errors: null,
            });
          } catch (e) { console.error('[fakeSupabase] postgres_changes handler threw', e); }
        }
      }
    }
  }

  // ── the messages-insert trigger chain ──────────────────────────────
  function insertMessageRow(input) {
    const row = {
      id: input.id || uuid(),
      workspace_id: input.workspace_id ?? null,
      conversation_id: input.conversation_id,
      sender_id: input.sender_id,
      sender_email: input.sender_email ?? personById(input.sender_id)?.email ?? null,
      parent_id: input.parent_id ?? null,
      body: input.body ?? '',
      attachments: input.attachments ?? [],
      mentions: input.mentions ?? [],
      reactions: input.reactions ?? {},
      kind: input.kind || 'user',
      is_pinned: !!input.is_pinned,
      edited_at: input.edited_at ?? null,
      deleted_at: input.deleted_at ?? null,
      created_at: input.created_at || clock.now(),
    };
    if (db.messages.some((m) => m.id === row.id)) {
      const e = new Error('duplicate key value');
      e.fake = err('duplicate key value', '23505');
      throw e;
    }
    db.messages.push(row);
    const conv = db.conversations.find((c) => c.id === row.conversation_id);
    if (conv && row.kind === 'user') {
      const old = clone(conv);
      conv.last_message_at = row.created_at;
      emitChange('conversations', 'UPDATE', conv, old);
    }
    if (row.kind !== 'system') {
      const payload = {
        conversation_id: row.conversation_id,
        message_id: row.id,
        sender_id: row.sender_id,
        sender_email: row.sender_email,
        workspace_id: row.workspace_id,
        body_preview: String(row.body || '').replace(/\s+/g, ' ').slice(0, 140),
        mentions: row.mentions || [],
        has_attachments: (row.attachments || []).length > 0,
        parent_id: row.parent_id,
        created_at: row.created_at,
      };
      for (const p of db.conversation_participants) {
        if (p.conversation_id === row.conversation_id && !p.left_at && p.user_id !== row.sender_id) {
          deliver(`user:${p.user_id}`, 'inbox-ping', payload);
        }
      }
    }
    return row;
  }

  // ── query builder ──────────────────────────────────────────────────
  function cmp(a, b, col) {
    if (a == null || b == null) return null;
    if (TIME_COLS.has(col)) { const x = ms(a), y = ms(b); return x === y ? 0 : x < y ? -1 : 1; }
    return a === b ? 0 : a < b ? -1 : 1;
  }
  function likeRegex(pattern) {
    let out = '';
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i];
      if (ch === '\\' && i + 1 < pattern.length) { out += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
      if (ch === '%') out += '[\\s\\S]*';
      else if (ch === '_') out += '[\\s\\S]';
      else out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`^${out}$`, 'i');
  }
  const ops = {
    eq: (v, x) => v === x || (v != null && x != null && String(v) === String(x) && typeof v !== 'object'),
    neq: (v, x) => !ops.eq(v, x),
    is: (v, x) => (x === null ? v == null : v === x),
    in: (v, x) => x.some((y) => ops.eq(v, y)),
    ilike: (v, x) => v != null && likeRegex(String(x)).test(String(v)),
    like: (v, x) => v != null && likeRegex(String(x)).test(String(v)),
  };
  function predicate(col, op, val) {
    if (op === 'lt' || op === 'gt' || op === 'gte' || op === 'lte') {
      return (row) => {
        const c = cmp(row[col], val, col);
        if (c === null) return false;
        return op === 'lt' ? c < 0 : op === 'gt' ? c > 0 : op === 'gte' ? c >= 0 : c <= 0;
      };
    }
    if (op === 'cs' || op === 'contains') {
      return (row) => Array.isArray(row[col]) && [].concat(val).every((x) => row[col].includes(x));
    }
    const f = ops[op];
    if (!f) throw new Error(`fakeSupabase: unsupported filter ${op}`);
    return (row) => f(row[col], val);
  }
  // or('a.eq.1,b.is.null') — the simple, non-nested form.
  function parseOr(spec) {
    const parts = String(spec).split(',').map((s) => {
      const m = /^([^.]+)\.(not\.)?([a-z]+)\.(.*)$/.exec(s.trim());
      if (!m) throw new Error(`fakeSupabase: cannot parse or() part "${s}"`);
      let v = m[4];
      // PostgREST: a value holding reserved characters (an ISO time's : and .) comes quoted.
      if (/^".*"$/.test(v)) v = v.slice(1, -1).replace(/\\"/g, '"');
      if (m[3] === 'is') v = v === 'null' ? null : v === 'true';
      else if (m[3] === 'in') v = v.replace(/^\(|\)$/g, '').split(',');
      const p = predicate(m[1], m[3], v);
      return m[2] ? (r) => !p(r) : p;
    });
    return (row) => parts.some((p) => p(row));
  }
  function project(row, cols) {
    if (!cols || cols === '*' || cols.includes('(') || cols.split(',').some((c) => c.trim() === '*')) return clone(row);
    const out = {};
    for (const c of cols.split(',').map((s) => s.trim()).filter(Boolean)) out[c] = clone(row[c]);
    return out;
  }

  class QueryBuilder {
    constructor(client, table) {
      this.client = client;
      this.table = table;
      this.op = null;
      this.cols = '*';
      this.payload = null;
      this.returning = null;
      this.preds = [];
      this.filterLog = [];
      this.orders = [];
      this.limitN = null;
      this.rangeR = null;
      this.mode = 'many';
      this.countOpt = null;
      this.head = false;
      this.p = null;
    }
    select(cols = '*', opts = {}) {
      if (this.op && this.op !== 'select') this.returning = cols || '*';
      else { this.op = 'select'; this.cols = cols || '*'; this.countOpt = opts?.count || null; this.head = !!opts?.head; }
      return this;
    }
    insert(rows) { this.op = 'insert'; this.payload = rows; return this; }
    update(patch) { this.op = 'update'; this.payload = patch; return this; }
    upsert(rows) { this.op = 'upsert'; this.payload = rows; return this; }
    delete() { this.op = 'delete'; return this; }
    _f(col, op, val) { this.preds.push(predicate(col, op, val)); this.filterLog.push([col, op, val]); return this; }
    eq(c, v) { return this._f(c, 'eq', v); }
    neq(c, v) { return this._f(c, 'neq', v); }
    is(c, v) { return this._f(c, 'is', v); }
    lt(c, v) { return this._f(c, 'lt', v); }
    gt(c, v) { return this._f(c, 'gt', v); }
    gte(c, v) { return this._f(c, 'gte', v); }
    lte(c, v) { return this._f(c, 'lte', v); }
    in(c, v) { return this._f(c, 'in', v); }
    ilike(c, v) { return this._f(c, 'ilike', v); }
    like(c, v) { return this._f(c, 'like', v); }
    contains(c, v) { return this._f(c, 'contains', v); }
    not(c, op, v) { const p = predicate(c, op, v); this.preds.push((r) => !p(r)); this.filterLog.push([c, `not.${op}`, v]); return this; }
    or(spec) { this.preds.push(parseOr(spec)); this.filterLog.push(['or', spec]); return this; }
    order(col, { ascending = true, nullsFirst } = {}) { this.orders.push({ col, ascending, nullsFirst: nullsFirst ?? !ascending }); return this; }
    limit(n) { this.limitN = n; return this; }
    range(a, b) { this.rangeR = [a, b]; return this; }
    single() { this.mode = 'single'; return this; }
    maybeSingle() { this.mode = 'maybe'; return this; }

    // The only way out. No catch, no finally: see the file header.
    then(onFulfilled, onRejected) {
      if (!this.p) this.p = this._exec();
      return this.p.then(onFulfilled, onRejected);
    }

    async _exec() {
      const op = this.op || 'select';
      const target = `${op}:${this.table}`;
      record('from', target, {
        table: this.table, op, cols: this.cols, payload: this.payload, filters: this.filterLog,
        orders: this.orders, limit: this.limitN, range: this.rangeR, returning: this.returning, mode: this.mode,
      });
      await wait(target);
      const forced = takeFailure(target);
      if (forced) return { data: null, error: forced };
      try {
        return this._apply(op);
      } catch (e) {
        return { data: null, error: e.fake || err(e.message || String(e)) };
      }
    }

    _shape(rows, cols) {
      let out = rows;
      if (this.orders.length) {
        out = [...out].sort((a, b) => {
          for (const { col, ascending, nullsFirst } of this.orders) {
            const x = a[col], y = b[col];
            if (x == null && y == null) continue;
            if (x == null) return nullsFirst ? -1 : 1;
            if (y == null) return nullsFirst ? 1 : -1;
            const c = cmp(x, y, col);
            if (c) return ascending ? c : -c;
          }
          return 0;
        });
      }
      if (this.rangeR) out = out.slice(this.rangeR[0], this.rangeR[1] + 1);
      if (this.limitN != null) out = out.slice(0, this.limitN);
      const projected = out.map((r) => project(r, cols));
      if (this.mode === 'single') {
        if (projected.length !== 1) return { data: null, error: err('JSON object requested, multiple (or no) rows returned', 'PGRST116') };
        return { data: projected[0], error: null };
      }
      if (this.mode === 'maybe') {
        if (projected.length > 1) return { data: null, error: err('JSON object requested, multiple (or no) rows returned', 'PGRST116') };
        return { data: projected[0] || null, error: null };
      }
      return { data: projected, error: null };
    }

    _apply(op) {
      const uid = this.client.selfId;
      const t = this.table;
      const matches = (rows) => rows.filter((r) => this.preds.every((p) => p(r)));

      if (op === 'select') {
        const rows = visibleRows(t, uid);
        if (rows === null) return { data: null, error: err(`relation "public.${t}" does not exist`, 'PGRST205') };
        const hit = matches(rows);
        if (this.head) return { data: null, error: null, count: hit.length };
        const res = this._shape(hit, this.cols);
        if (this.countOpt) res.count = hit.length;
        return res;
      }

      if (t === 'conversation_summary') return { data: null, error: err('cannot change a view', '55000') };

      if (op === 'insert') {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload];
        const made = [];
        for (const r of list) {
          if (t === 'messages') {
            if (r.sender_id !== uid || !isActive(r.conversation_id, uid)) {
              return { data: null, error: err('new row violates row-level security policy for table "messages"', '42501') };
            }
            made.push(insertMessageRow(r));
          } else if (t === 'conversation_participants') {
            if (!isActive(r.conversation_id, uid)) return { data: null, error: err('new row violates row-level security policy for table "conversation_participants"', '42501') };
            if (myPart(r.conversation_id, r.user_id)) return { data: null, error: err('duplicate key value', '23505') };
            const row = { joined_at: clock.now(), left_at: null, last_read_at: clock.now(), ...r };
            db.conversation_participants.push(row);
            emitChange(t, 'INSERT', row);
            made.push(row);
          } else {
            return { data: null, error: err(`insert into ${t} is not supported by the fake`, '0A000') };
          }
        }
        if (!this.returning) return { data: null, error: null };
        return this._shape(made, this.returning);
      }

      if (op === 'update' || op === 'delete') {
        let pool;
        if (t === 'messages') {
          // "messages update": your own rows, kind 'user'. Anything else matches nothing.
          pool = db.messages.filter((m) => m.sender_id === uid && m.kind === 'user' && convIdsOf(uid).has(m.conversation_id));
        } else if (t === 'conversation_participants') {
          pool = db.conversation_participants.filter((p) => p.user_id === uid);
        } else if (t === 'conversations') {
          pool = op === 'update' ? db.conversations.filter((c) => convIdsOf(uid).has(c.id)) : [];
        } else {
          return { data: null, error: err(`${op} on ${t} is not supported by the fake`, '0A000') };
        }
        const hit = matches(pool);
        const done = [];
        for (const row of hit) {
          if (op === 'update') {
            const old = clone(row);
            Object.assign(row, clone(this.payload));
            done.push(row);
            if (t === 'conversation_participants' || t === 'conversations') emitChange(t, 'UPDATE', row, old);
          } else {
            const list = db[t];
            list.splice(list.indexOf(row), 1);
            done.push(row);
          }
        }
        if (!this.returning) return { data: null, error: null };
        return this._shape(done, this.returning);
      }

      return { data: null, error: err(`${op} is not supported by the fake`, '0A000') };
    }
  }

  // ── rpc ────────────────────────────────────────────────────────────
  class RpcBuilder {
    constructor(client, name, params) { this.client = client; this.name = name; this.params = params; this.p = null; }
    then(onFulfilled, onRejected) {
      if (!this.p) this.p = this._exec();
      return this.p.then(onFulfilled, onRejected);
    }
    async _exec() {
      const target = `rpc:${this.name}`;
      record('rpc', target, this.params);
      await wait(target);
      const forced = takeFailure(target);
      if (forced) return { data: null, error: forced };
      const fn = rpcs[this.name];
      if (!fn) return { data: null, error: err('not found', 'PGRST202') };
      try {
        return { data: clone(fn(this.client.selfId, this.params || {})), error: null };
      } catch (e) {
        return { data: null, error: e.fake || err(e.message || String(e)) };
      }
    }
  }
  const fail = (message, code) => { const e = new Error(message); e.fake = err(message, code); return e; };

  const rpcs = {
    toggle_message_reaction(uid, { p_message_id, p_emoji }) {
      if (!p_emoji || !String(p_emoji).trim() || String(p_emoji).length > 32) throw fail('not a reaction', '22023');
      const m = db.messages.find((x) => x.id === p_message_id && !x.deleted_at);
      if (!m) throw fail('message not found', '42704');
      if (!isActive(m.conversation_id, uid)) throw fail('not a member of this conversation', '42501');
      m.reactions = m.reactions || {};
      const list = new Set(Array.isArray(m.reactions[p_emoji]) ? m.reactions[p_emoji] : []);
      if (list.has(uid)) list.delete(uid); else list.add(uid);
      if (list.size === 0) delete m.reactions[p_emoji]; else m.reactions[p_emoji] = [...list];
      return m.reactions;
    },
    toggle_pin(uid, { p_message_id }) {
      const m = db.messages.find((x) => x.id === p_message_id);
      if (!m) throw fail(`message ${p_message_id} not found`, '42704');
      if (!myPart(m.conversation_id, uid)) throw fail('must be a workspace member to pin', '42501');
      m.is_pinned = !m.is_pinned;
      return m.is_pinned;
    },
    // 0058:362 — kind 'user', not yours, not deleted, after your last_read_at.
    // Conversations with nothing unread are absent, as in the SQL's group by.
    get_unread_counts(uid) {
      const out = {};
      for (const p of db.conversation_participants) {
        if (p.user_id !== uid) continue;
        const since = ms(p.last_read_at);
        if (since == null) continue;
        const n = db.messages.filter((m) => m.conversation_id === p.conversation_id
          && !m.deleted_at && m.kind === 'user' && m.sender_id !== uid && ms(m.created_at) > since).length;
        if (n > 0) out[p.conversation_id] = n;
      }
      return out;
    },
    find_or_create_dm(uid, { p_workspace, p_peer }) {
      if (p_peer === uid) throw fail('cannot DM yourself', '22023');
      if (!personById(p_peer)) throw fail('cannot message this user', '42501');
      for (const c of db.conversations) {
        const parts = db.conversation_participants.filter((p) => p.conversation_id === c.id);
        if (parts.length === 2 && parts.some((p) => p.user_id === uid) && parts.some((p) => p.user_id === p_peer)) {
          const mine = parts.find((p) => p.user_id === uid);
          if (mine.left_at) {
            const old = clone(mine);
            mine.left_at = null;
            emitChange('conversation_participants', 'UPDATE', mine, old);
          }
          return c.id;
        }
      }
      return newConversation(uid, p_workspace, null, [p_peer]);
    },
    create_group_conversation(uid, { p_workspace, p_title, p_member_ids }) {
      for (const id of p_member_ids || []) if (!personById(id) || id === uid) throw fail('cannot message one or more selected users', '42501');
      return newConversation(uid, p_workspace, String(p_title || '').trim() || null, p_member_ids || []);
    },
    add_conversation_participants(uid, { p_conversation_id, p_user_ids }) {
      if (!db.conversations.some((c) => c.id === p_conversation_id)) throw fail('conversation not found', '42704');
      if (!isActive(p_conversation_id, uid)) throw fail('you cannot add people to this conversation', '42501');
      const added = [];
      for (const id of p_user_ids || []) {
        if (!id || id === uid || !personById(id)) continue;
        const existing = myPart(p_conversation_id, id);
        if (!existing) {
          const row = { conversation_id: p_conversation_id, user_id: id, joined_at: clock.now(), left_at: null, last_read_at: clock.now() };
          db.conversation_participants.push(row);
          emitChange('conversation_participants', 'INSERT', row);
          added.push(id);
        } else if (existing.left_at) {
          const old = clone(existing);
          existing.left_at = null; existing.joined_at = clock.now();
          emitChange('conversation_participants', 'UPDATE', existing, old);
          added.push(id);
        }
      }
      return added;
    },
    list_messageable_users(uid, { p_query } = {}) {
      const q = String(p_query || '').trim().toLowerCase();
      return db.people
        .filter((p) => p.user_id !== uid)
        .filter((p) => !q || String(p.name || '').toLowerCase().includes(q) || String(p.email || '').toLowerCase().includes(q))
        .map((p) => ({ user_id: p.user_id, email: p.email, name: p.name, color: p.color || null }));
    },
    users_by_ids(_uid, { p_user_ids }) {
      return (p_user_ids || []).map(personById).filter(Boolean).map((p) => ({ user_id: p.user_id, email: p.email }));
    },
  };

  function newConversation(uid, workspaceId, title, memberIds) {
    const id = uuid();
    const at = clock.now();
    db.conversations.push({ id, workspace_id: workspaceId, title, created_by: uid, created_at: at, last_message_at: null });
    for (const user_id of [uid, ...memberIds]) {
      const row = { conversation_id: id, user_id, joined_at: at, left_at: null, last_read_at: at };
      db.conversation_participants.push(row);
      emitChange('conversation_participants', 'INSERT', row);
    }
    return id;
  }

  // ── realtime channels ──────────────────────────────────────────────
  function makeClient(clientSelf) {
    const registry = new Map(); // topic -> channel (a client dedupes by topic)
    const client = { selfId: clientSelf, registry };

    function allowedToJoin(topic) {
      if (topic.startsWith('conv:')) return !!myPart(topic.slice(5), clientSelf);
      if (topic.startsWith('user:')) return topic.slice(5) === clientSelf;
      return true;
    }
    function fireSubscribed(ch) {
      setTimeout(() => {
        if (ch.state !== 'joining' && ch.state !== 'joined') return;
        if (!allowedToJoin(ch.topic)) {
          ch.state = 'errored';
          ch.statusCb?.('CHANNEL_ERROR', new Error(`not allowed to join ${ch.topic}`));
          return;
        }
        ch.state = 'joined';
        ch.statusCb?.('SUBSCRIBED');
      }, 0);
    }

    function channel(topic, opts = {}) {
      const existing = registry.get(topic);
      if (existing) return existing;
      const ch = {
        topic,
        state: 'closed',
        subscribed: false,
        bindings: [],
        statusCb: null,
        selfEcho: !!opts?.config?.broadcast?.self,
        on(type, filter, cb) {
          if (ch.subscribed) throw new Error(`tried to add ${type} callbacks to ${topic} after subscribe()`);
          ch.bindings.push({ type, filter: type === 'broadcast' ? { event: '*', ...filter } : (filter || {}), cb });
          return ch;
        },
        subscribe(cb) {
          record('channel', `subscribe:${topic}`, { topic });
          ch.subscribed = true;
          ch.statusCb = cb || null;
          ch.state = 'joining';
          if (!bus.has(topic)) bus.set(topic, new Set());
          bus.get(topic).add(ch);
          fireSubscribed(ch);
          return ch;
        },
        async send(msg) {
          record('channel', `send:${topic}`, msg);
          await wait(`send:${topic}`);
          if (takeFailure(`send:${topic}`)) return 'error';
          if (msg?.type === 'broadcast') deliver(topic, msg.event, msg.payload, { except: ch.selfEcho ? null : ch });
          return 'ok';
        },
        async unsubscribe() { return teardown(ch); },
      };
      registry.set(topic, ch);
      return ch;
    }
    function teardown(ch) {
      ch.state = 'closed';
      ch.subscribed = false;
      bus.get(ch.topic)?.delete(ch);
      if (client.registry.get(ch.topic) === ch) client.registry.delete(ch.topic);
      return 'ok';
    }

    client.channel = channel;
    client.removeChannel = async (ch) => (ch ? teardown(ch) : 'ok');
    client.removeAllChannels = async () => { for (const ch of [...registry.values()]) teardown(ch); return ['ok']; };
    client.getChannels = () => [...registry.values()];
    client.from = (table) => new QueryBuilder(client, table);
    client.rpc = (name, params) => new RpcBuilder(client, name, params);

    client.storage = {
      from(bucket) {
        return {
          async upload(path, file, opts = {}) {
            record('storage', 'upload', { bucket, path, contentType: opts.contentType, size: file?.size });
            await wait('upload');
            const forced = takeFailure('upload');
            if (forced) return { data: null, error: forced };
            if (bucket !== 'message-attachments') return { data: null, error: { message: 'Bucket not found', statusCode: '404' } };
            const parts = String(path).split('/');
            if (parts.length !== 3 || !/^[0-9a-f-]{36}\.[a-z0-9]+$/i.test(parts[2]) || !parts[0]) {
              return { data: null, error: { message: 'new row violates row-level security policy', statusCode: '403' } };
            }
            if (parts[1] !== clientSelf) return { data: null, error: { message: 'new row violates row-level security policy', statusCode: '403' } };
            if (db.storage.has(path) && !opts.upsert) return { data: null, error: { message: 'The resource already exists', statusCode: '409' } };
            db.storage.set(path, { contentType: opts.contentType || 'application/octet-stream', size: file?.size ?? 0, file, at: clock.now() });
            return { data: { path }, error: null };
          },
          getPublicUrl(path) {
            return { data: { publicUrl: `https://qa.invalid/storage/v1/object/public/${bucket}/${path}` } };
          },
          async remove(paths) { for (const p of paths || []) db.storage.delete(p); return { data: [], error: null }; },
        };
      },
    };

    const session = {
      access_token: 'qa-token', refresh_token: 'qa-refresh',
      expires_at: Math.floor(Date.now() / 1000) + 3600 * 24 * 365,
      user: null,
    };
    const userObj = () => {
      const p = personById(clientSelf);
      return { id: clientSelf, email: p?.email || null, user_metadata: { full_name: p?.name || null } };
    };
    client.auth = {
      async getUser() { return { data: { user: userObj() }, error: null }; },
      async getSession() { return { data: { session: { ...session, user: userObj() } }, error: null }; },
      async refreshSession() { return { data: { session: { ...session, user: userObj() } }, error: null }; },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      async signOut() { return { error: null }; },
    };
    client.realtime = {
      setAuth() {}, connect() {}, async disconnect() {},
      get channels() { return [...registry.values()]; },
    };
    client.functions = { async invoke() { return { data: null, error: err('not found', 'PGRST202') }; } };

    clients.push(client);
    return client;
  }

  const main = makeClient(selfId);

  // ── QA controls (window.__msgQa) ───────────────────────────────────
  const peers = new Map();
  function needMessage(id) {
    const m = db.messages.find((x) => x.id === id);
    if (!m) throw new Error(`no message ${id}`);
    return m;
  }
  const nudge = (conversationId, changed, id) => deliver(`conv:${conversationId}`, 'chat-message', { changed, id });

  function peer(userId) {
    if (peers.has(userId)) return peers.get(userId);
    const person = personById(userId);
    if (!person) throw new Error(`no person ${userId}`);
    const p = {
      id: userId,
      // Reserved: a peer on an older client that never broadcasts reads.
      legacy: false,
      send(convId, body, { attachments = [], parentId = null, mentions = [], kind = 'user', id } = {}) {
        const conv = db.conversations.find((c) => c.id === convId);
        if (!conv) throw new Error(`no conversation ${convId}`);
        if (!isActive(convId, userId)) throw new Error(`${userId} is not an active participant of ${convId}`);
        const row = insertMessageRow({
          id, workspace_id: conv.workspace_id, conversation_id: convId, sender_id: userId,
          parent_id: parentId, body, attachments, mentions, kind,
        });
        deliver(`conv:${convId}`, 'chat-message', { ...row, sender_name: person.name || person.email });
        return clone(row);
      },
      type(convId) { deliver(`conv:${convId}`, 'chat-typing', { user_id: userId, ts: Date.now() }); },
      react(msgId, emoji) {
        const m = needMessage(msgId);
        m.reactions = m.reactions || {};
        const list = new Set(m.reactions[emoji] || []);
        if (list.has(userId)) list.delete(userId); else list.add(userId);
        if (list.size === 0) delete m.reactions[emoji]; else m.reactions[emoji] = [...list];
        nudge(m.conversation_id, 'react', m.id);
        return clone(m.reactions);
      },
      edit(msgId, body) {
        const m = needMessage(msgId);
        m.body = body; m.edited_at = clock.now();
        nudge(m.conversation_id, 'edit', m.id);
      },
      delete(msgId) {
        const m = needMessage(msgId);
        m.deleted_at = clock.now();
        nudge(m.conversation_id, 'delete', m.id);
      },
      pin(msgId) {
        const m = needMessage(msgId);
        m.is_pinned = !m.is_pinned;
        nudge(m.conversation_id, 'pin', m.id);
        return m.is_pinned;
      },
      read(convId) {
        const row = myPart(convId, userId);
        if (!row) throw new Error(`${userId} is not in ${convId}`);
        const old = clone(row);
        row.last_read_at = clock.now();
        emitChange('conversation_participants', 'UPDATE', row, old);
        // A current client says so on conv:; a legacy one (peer.legacy) doesn't.
        if (!p.legacy) deliver(`conv:${convId}`, 'chat-read', { user_id: userId });
      },
    };
    peers.set(userId, p);
    return p;
  }

  const qa = {
    db,
    calls,
    clock,
    peer,
    setLatency(v) { latencyCfg = typeof v === 'number' ? v : { ...(typeof latencyCfg === 'object' ? latencyCfg : { default: latencyCfg }), ...v }; },
    failNext(target, { times = 1, error } = {}) {
      failures.push({ target, times, error: error ? (typeof error === 'string' ? err(error) : error) : err('forced failure (QA)', 'QA000') });
    },
    // Every open channel re-reports SUBSCRIBED, as realtime does after a drop.
    dropSocket() {
      for (const client of clients) {
        for (const ch of client.registry.values()) {
          if (ch.state === 'joined') setTimeout(() => { if (ch.state === 'joined') ch.statusCb?.('SUBSCRIBED'); }, 0);
        }
      }
    },
    openChannels() { return [...bus.entries()].filter(([, set]) => set.size).map(([t, set]) => [t, set.size]); },
    bindHarness(h) { Object.assign(hooks, h); },
    openConversation(id) { return hooks.openConversation?.(id); },
    openPeer(userId) { return hooks.openPeer?.(userId); },
    permalink(msgId) { return hooks.permalink?.(msgId); },
    close() { return hooks.close?.(); },
  };

  return Object.assign(main, {
    qa,
    // Another browser: same data and wire, signed in as someone else.
    clientFor(userId) { return makeClient(userId); },
  });
}
