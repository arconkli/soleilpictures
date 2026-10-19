// Text pins on the shared doc's room (party/doc.ts), the board's side of its
// bridge (party/bridge.ts) and how the Worker lets people in (party/index.ts):
// guest writes are validated or refused, view sockets never write, names come
// from the server, the bridge is inert without a subscriber and reachable
// only by stub, and the room bills like a board room (silent close, empty
// close answered, nothing held open).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const doc = src('../../party/doc.ts');
const bridge = src('../../party/bridge.ts');
const index = src('../../party/index.ts');
const board = src('../../party/board.ts');
const wrangler = src('../../party/wrangler.jsonc');

test('every guest write is validated before it applies, and a view socket never writes', () => {
  const at = doc.indexOf('if (sub !== SYNC_STEP2 && sub !== SYNC_UPDATE) return;');
  assert.ok(at > 0);
  const path = doc.slice(at, doc.indexOf('if (type === MSG_AWARENESS)', at));
  // The order matters: read-only first, then size and rate, then the validator, then apply.
  const order = ['if (st.readOnly) return;', 'DOC_ROOM_FRAME_MAX_BYTES', 'updates.hit()', 'validateGuestUpdate(this.document, update', 'if (!verdict.ok) { this.refuse(conn, verdict.reason); return; }', 'super.onMessage(conn, message);', 'this.forward(update, st.userId);'];
  let last = -1;
  for (const needle of order) {
    const i = path.indexOf(needle);
    assert.ok(i > last, `${needle} comes in order`);
    last = i;
  }
  assert.match(doc, /isReadOnly\(conn: Connection\) \{\s+return stateOf\(conn\)\.readOnly !== false;/);
  assert.match(doc, /const readOnly = this\.target\.variant !== "edit" \|\| anon \|\| !\(access === "edit" \|\| access === "manage"\);/);
});

test('names and presence are the room’s, not the browser’s', () => {
  assert.match(doc, /const name = \(h\.get\("x-doc-name"\) \|\| ""\)\.slice\(0, 80\)/);
  assert.match(doc, /state = \{ user: \{ id: `p:\$\{id\}`, name: st\.name, color: st\.color, guest: true \} \};/);
  assert.match(doc, /if \(bytes\.length > AWARENESS_FRAME_MAX\) return;/);
  assert.match(doc, /if \(taken\.has\(id\) \|\| st\.awareness\.length >= 4\) continue;/, 'only its own client ids');
  // The Worker stamps them from doc_room_access, run as the caller.
  assert.match(index, /const r = await docRoomAccess\(token \|\| "", lobby\.name, share\);/);
  assert.match(index, /req\.headers\.set\("x-doc-name", String\(r\.name \|\| ""\)\.slice\(0, 80\)\);/);
  assert.match(index, /req\.headers\.set\("x-token-ok", r\.token_ok \? "1" : "0"\);/);
  for (const h of ['x-doc-access', 'x-anon', 'x-token-ok', 'x-doc-name']) {
    assert.ok(index.includes(`"${h}"`), `${h} is stripped from what a client sends`);
  }
});

test('the bridge is inert without a subscriber, and reachable only by stub', () => {
  assert.match(bridge, /onTransaction\(tr: Y\.Transaction\) \{\s+if \(!this\.subs\.size \|\| this\.host\.resetting\(\)\) return;/);
  assert.match(bridge, /if \(req\.method !== "POST" \|\| !\(await isBridgeRequest\(req, this\.host\.env\)\)\) \{/);
  assert.match(doc, /if \(req\.method !== "POST" \|\| !\(await isBridgeRequest\(req, this\.env\)\)\) return new Response\("Not found", \{ status: 404 \}\);/);
  // From outside: the board room answers /reset only, the doc room /recheck only.
  assert.match(index, /if \(!UUID\.test\(lobby\.name\) \|\| !url\.pathname\.endsWith\("\/reset"\)\) return notFound\(\);/);
  assert.match(index, /if \(!DOC_ROOM\.test\(lobby\.name\) \|\| !url\.pathname\.endsWith\("\/recheck"\)\) return notFound\(\);/);
  // Its own writes are not pushed back to the room that made them.
  assert.match(bridge, /if \(isDocRoomOrigin\(tr\.origin\) && tr\.origin\.docRoom === sub\.room\) continue;/);
  // Only the edit room may write, and only while subscribed.
  assert.match(bridge, /if \(!sub \|\| sub\.variant !== "edit"\) return new Response\("Gone", \{ status: 410 \}\);/);
  assert.match(board, /this\.document\.on\("afterTransaction", \(tr: Y\.Transaction\) => this\.bridge\?\.onTransaction\(tr\)\);/);
  assert.match(board, /await this\.bridge\?\.closeAll\(4012, "reset"\);/, 'a restore sends the doc rooms on');
});

test('the room bills like a board room: silent close, an answered empty close, nothing held open', () => {
  assert.match(doc, /static options = \{ hibernate: false \};/);
  assert.match(doc, /if \(now - heard > DOC_ROOM_SILENT_CLOSE_MS\) \{ try \{ c\.close\(CLOSE\.SILENT, "silent"\);/);
  assert.match(doc, /finally \{ answerEmptyClose\(conn, code\); \}/);
  assert.match(doc, /if \(\[\.\.\.this\.getConnections\(\)\]\.length === 0\) this\.leave\(\);/);
  assert.match(doc, /if \(\[\.\.\.this\.getConnections\(\)\]\.length === 0\) return new Response\("Nobody here", \{ status: 410 \}\);/);
  assert.doesNotMatch(doc, /setInterval\(/);
  assert.match(wrangler, /\{ "name": "Doc", "class_name": "DocParty" \}/);
  assert.match(wrangler, /\{ "tag": "v1", "new_sqlite_classes": \["BoardParty", "WorkspaceParty", "UniverseParty"\] \},\s+\/\/[^\n]*\n\s+\{ "tag": "v2", "new_sqlite_classes": \["DocParty"\] \}/, 'v1 untouched, v2 added');
});

test('access is asked again: every minute, at once on /recheck, and losing it closes the socket', () => {
  assert.match(doc, /serviceRpc\(this\.env, "_doc_room_recheck", \{ p_share: this\.target\.shareId, p_subjects: subjects \}\)/);
  assert.match(doc, /if \(!a \|\| a === "none" \|\| a === "gone"\) \{\s+try \{ c\.close\(CLOSE\.LOST, "access ended"\);/);
  assert.match(doc, /if \(uid && banned\.has\(uid\)\) \{ try \{ c\.close\(CLOSE\.SUSPENDED, "account suspended"\);/);
  assert.match(doc, /if \(r && r\.gen && r\.gen !== this\.target\.gen\) \{ this\.sendAway\(CLOSE\.MOVED, "moved"\); return; \}/);
});

// Security review of the room (2026-10-18), each finding pinned.
test('review: an HTTP wake never wakes the board; /recheck is the managers’ and coalesced', () => {
  assert.match(doc, /async onLoad\(\) \{\s+return null;\s+\}/, 'nothing is built until a socket arrives');
  assert.match(doc, /async onConnect\(conn: Connection, ctx: ConnectionContext\) \{\s+await this\.ensureReady\(\);/);
  assert.match(doc, /if \(!this\.subscribed \|\| !this\.target \|\| this\.dead \|\| this\.leaving\) return new Response\("Gone", \{ status: 410 \}\);/);
  assert.match(doc, /this\.recheckRunning \|\| Date\.now\(\) - this\.recheckAt < 5_000\) return;/);
  assert.match(index, /const r = await docRoomAccess\(bearer, lobby\.name, ""\);\s+if \(!r \|\| r\.status !== "ok" \|\| r\.access !== "manage"\) return new Response\("Forbidden", \{ status: 403 \}\);/);
});

test('review: the board takes a doc room’s write only where that doc lives', () => {
  assert.match(bridge, /const placed = validateGuestUpdate\(this\.host\.document, bytes, \{\s+cardKey: sub\.cardId, structureOnly: true,/);
  assert.match(bridge, /if \(env\.DOC_BRIDGE_SECRET && env\.DOC_BRIDGE_SECRET\.length >= 32\) return env\.DOC_BRIDGE_SECRET;/);
  assert.match(doc, /while \(this\.claims\.size > 500\) this\.claims\.delete/);
});

test('review: the /recheck preflight is answered in the Worker', () => {
  assert.match(index, /\/\/ The preflight is answered here: a stranger never wakes the room\.\s+if \(req\.method === "OPTIONS"\) \{\s+return new Response\(null, \{\s+status: 204,/);
});

// 2026-10-19: a view room built in the minute after a deploy closed "gone"
// twice and stayed dead; the same room worked an hour later.
test('only "no such share" or "no such card" is gone; not being able to ask is tried again', () => {
  assert.match(doc, /if \(!res\.ok\) \{\s+console\.warn\(`\[doc\] \$\{name\} answered \$\{res\.status\}`\);\s+return FAILED;/);
  assert.match(doc, /\} catch \(e\) \{\s+console\.warn\(`\[doc\] \$\{name\} failed`, e\);\s+return FAILED;/);
  assert.match(doc, /if \(t === FAILED\) \{ this\.dead = \{ code: CLOSE\.UNAVAILABLE, reason: "unavailable" \}; return; \}/);
  // The bridge's 410 is gone; a 404 (a board room still on older code) is not.
  assert.match(doc, /if \(res\.status === 410\) \{\s+console\.warn\(`\[doc \$\{this\.name\}\] the board has no card/);
  assert.doesNotMatch(doc, /res\.status === 404/);
  assert.match(doc, /if \(!res\.ok\) \{\s+console\.warn\(`\[doc \$\{this\.name\}\] the board answered \$\{res\.status\} to subscribe`\);\s+this\.dead = \{ code: CLOSE\.UNAVAILABLE/);
  // A failed recheck closes no one.
  assert.match(doc, /const r = asked === FAILED \? null : asked;/);
});

test('the room is built before a socket is let in, so the doc is sent once', () => {
  assert.match(doc, /async getConnectionTags\(_conn: Connection, _ctx: ConnectionContext\): Promise<string\[\]> \{\s+await this\.ensureReady\(\);\s+return \[\];/);
  assert.match(doc, /this\.ready = this\.prepare\(\)\.catch\(\(e\) => \{/, 'a throw is a 4503, never a rejected room');
});

test('the last one out lets go of the board and throws the copy away', () => {
  const at = doc.indexOf('private leave() {');
  assert.ok(at > 0);
  const body = doc.slice(at, doc.indexOf('\n  }\n', at));
  const order = ['if (this.leaving) return;', 'this.leaving = true;', 'await this.unsubscribe();', 'deleteAlarm()', 'this.ctx.abort("the room emptied")'];
  let last = -1;
  for (const needle of order) {
    const i = body.indexOf(needle);
    assert.ok(i > last, `${needle} comes in order`);
    last = i;
  }
  // Meanwhile a socket is sent to try again, and a push is refused.
  assert.match(doc, /if \(this\.leaving \|\| this\.dead \|\| !this\.target\) \{/);
  assert.match(doc, /if \(!this\.subscribed \|\| !this\.target \|\| this\.dead \|\| this\.leaving\) return new Response\("Gone", \{ status: 410 \}\);/);
  assert.match(doc, /if \(!conns\.length\) \{ this\.leave\(\); return; \}/);
});

// Presence across the mirror (lib/docRoomPresence.js): the board is the hub.
test('presence crosses only as each side allows, and never echoes back', () => {
  // The board: a room's entries only for its own guests, never over a client
  // id it has from anywhere else, marked before they land.
  assert.match(bridge, /if \(from \? from !== room : aw\.getStates\(\)\.has\(e\.id\)\) continue;/);
  assert.match(bridge, /if \(!state \|\| !state\.user\.guest\) continue;/);
  assert.match(bridge, /for \(const e of keep\) if \(e\.state\) this\.guestsOf\.set\(e\.id, room\);\s+awarenessProtocol\.applyAwarenessUpdate\(aw, encodePresence\(keep\), null\);/);
  assert.match(bridge, /if \(this\.guestsOf\.get\(id\) === sub\.room\) continue;/, 'not back to the room it came from');
  assert.match(bridge, /onAwareness\(changes: \{ added: number\[\]; updated: number\[\]; removed: number\[\] \}\) \{\s+if \(!this\.subs\.size \|\| this\.host\.resetting\(\)\) return;/, 'inert with no mirror');
  assert.match(bridge, /this\.dropPresence\(room\);/, 'a room gone takes its guests with it');
  assert.match(board, /this\.document\.awareness\.on\("update", \(changes: \{ added: number\[\]; updated: number\[\]; removed: number\[\] \}\) =>\s+this\.bridge\?\.onAwareness\(changes\)\);/);
  // The doc room: never over a guest's own id, marked before they land, and a
  // guest cannot take a member's id.
  assert.match(doc, /if \(guests\.has\(e\.id\)\) continue;/);
  assert.match(doc, /for \(const e of keep\) if \(e\.state\) this\.boardClients\.add\(e\.id\);\s+awarenessProtocol\.applyAwarenessUpdate\(this\.document\.awareness, encodePresence\(keep\), null\);/);
  assert.match(doc, /const taken = new Set<number>\(this\.boardClients\);/);
  assert.match(doc, /if \(!this\.boardClients\.has\(id\)\) this\.presenceQueue\.add\(id\);/);
  // The last one out says goodbye first.
  const leave = doc.slice(doc.indexOf('private leave() {'));
  assert.ok(leave.indexOf('await this.flushPresence();') < leave.indexOf('await this.unsubscribe();'));
});
