// A board room's own copy of its Y.Doc, in the Durable Object's SQLite.
//
// Every update the room applies is appended the moment it lands, the same
// durability y-partykit gave with `persist` (it wrote each update to DO storage
// as it arrived). /api/v1's bulk append pushes cards into the room and hangs up
// without writing board_state itself (lib/scoutBoard.js appendViaRoom), so the
// room is the only holder of those cards until its next flush; a Worker deploy
// inside that window must not lose them.
//
// The log is folded into one snapshot on every flush, so it never holds more
// than a few seconds of updates. A SQLite row in a Durable Object holds at most
// 2 MB, so the snapshot is stored in 1 MB chunks and an update too big for one
// row is never appended: the caller compacts instead, which writes it as part
// of the whole document.

const CHUNK_BYTES = 1_000_000;
// Fold the log into a fresh snapshot once it holds this many updates, even
// between flushes (a fast typist produces one update per keystroke).
export const MAX_PENDING_UPDATES = 500;

type Sql = {
  exec(query: string, ...bindings: unknown[]): Iterable<Record<string, unknown>>;
};
type Storage = {
  sql: Sql;
  transactionSync<T>(fn: () => T): T;
};

const toBuffer = (u: Uint8Array): ArrayBuffer =>
  u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

export class RoomLog {
  pending = 0;

  constructor(private storage: Storage) {
    const { sql } = storage;
    sql.exec("CREATE TABLE IF NOT EXISTS ydoc_snapshot (seq INTEGER PRIMARY KEY, data BLOB NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS ydoc_updates (id INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL)");
    for (const r of sql.exec("SELECT count(*) AS n FROM ydoc_updates")) this.pending = Number(r.n) || 0;
  }

  // The snapshot (reassembled) followed by every update since, in order.
  load(): Uint8Array[] {
    const { sql } = this.storage;
    const chunks: Uint8Array[] = [];
    for (const r of sql.exec("SELECT data FROM ydoc_snapshot ORDER BY seq")) {
      chunks.push(new Uint8Array(r.data as ArrayBuffer));
    }
    const out: Uint8Array[] = [];
    if (chunks.length) {
      const total = chunks.reduce((n, c) => n + c.byteLength, 0);
      const joined = new Uint8Array(total);
      let at = 0;
      for (const c of chunks) { joined.set(c, at); at += c.byteLength; }
      out.push(joined);
    }
    for (const r of sql.exec("SELECT data FROM ydoc_updates ORDER BY id")) {
      out.push(new Uint8Array(r.data as ArrayBuffer));
    }
    return out;
  }

  // false = too big for a row; the caller must compact() instead.
  append(update: Uint8Array): boolean {
    if (update.byteLength > CHUNK_BYTES) return false;
    this.storage.sql.exec("INSERT INTO ydoc_updates (data) VALUES (?)", toBuffer(update));
    this.pending++;
    return true;
  }

  // Replace the log with one snapshot of the whole document, atomically.
  compact(state: Uint8Array): void {
    const { sql } = this.storage;
    this.storage.transactionSync(() => {
      sql.exec("DELETE FROM ydoc_updates");
      sql.exec("DELETE FROM ydoc_snapshot");
      for (let i = 0, seq = 0; i < state.byteLength; i += CHUNK_BYTES, seq++) {
        sql.exec("INSERT INTO ydoc_snapshot (seq, data) VALUES (?, ?)", seq, toBuffer(state.subarray(i, i + CHUNK_BYTES)));
      }
    });
    this.pending = 0;
  }

  // Used by /reset, ahead of deleteAll: nothing of the old board survives.
  wipe(): void {
    const { sql } = this.storage;
    sql.exec("DROP TABLE IF EXISTS ydoc_updates");
    sql.exec("DROP TABLE IF EXISTS ydoc_snapshot");
    this.pending = 0;
  }
}
