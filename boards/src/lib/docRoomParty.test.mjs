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
  assert.match(doc, /state = \{ user: \{ name: st\.name, color: st\.color, guest: true \} \};/);
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
  assert.match(doc, /if \(\[\.\.\.this\.getConnections\(\)\]\.length === 0\) void this\.unsubscribe\(\);/);
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
