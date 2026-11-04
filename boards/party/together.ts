// Working live together earns cards: the board room's half.
//
// Who counts and what each person hears is src/lib/togetherClock.js (pure,
// tested there); what it pays is live_together_tick (supabase 0862), which
// alone decides who is a real person and holds the month's cap. This file only
// listens, asks and passes the answer on:
//   * an edit or a presence move that reached the room marks its sender's
//     VERIFIED account active (the door stamps it on the socket's state; the
//     name a browser puts in its presence is never read);
//   * on the room's alarm (every minute while anyone is here), two or more
//     active people are sent to live_together_tick with their seconds
//     together, and each eligible person's sockets are told how it's going
//     (liveTogether.js: togetherMessage), or that it ended (TOGETHER_ENDED).
// A failed or missing function pays nothing and tells nobody anything new.

import type { Connection } from "partyserver";
import { activeNow, inputMoved, noteActivity, settleTick, togetherSeconds } from "../src/lib/togetherClock.js";
import { callFailed, reportParty } from "./report";

type Person = { lastAt: number; since: number };
type Told = { at: number; earned: number };
type TickAnswer = {
  people: number; boost: number; cap: number;
  results: Array<{ id: string; eligible: boolean; earned?: number; month?: number; capped?: boolean; progress?: number }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The function isn't there yet (the migration ships first, but a room may run
// before it): ask again after this.
const MISSING_RETRY_MS = 10 * 60_000;
// Presence signatures kept per room, at most (one per open tab, normally).
const MAX_SEEN = 2_000;
// live_together_tick pays nothing for a longer list, so the room doesn't ask.
const MAX_PEOPLE = 100;
// Someone the database called not a real person is left out of "together"
// starting for this long, then judged again.
const TURNED_AWAY_MS = 10 * 60_000;

const userIdOf = (origin: unknown): string => {
  if (!origin || typeof origin !== "object") return "";
  const state = (origin as { state?: { userId?: unknown } }).state;
  return typeof state?.userId === "string" ? state.userId : "";
};

const isAnswer = (b: unknown): b is TickAnswer => {
  const a = b as TickAnswer;
  return !!a && Number.isInteger(a.boost) && Number.isInteger(a.cap) && Array.isArray(a.results)
    && a.results.every((r) => !!r && typeof r.id === "string" && typeof r.eligible === "boolean");
};

export class TogetherWatch {
  private people = new Map<string, Person>();
  private seen = new Map<number, string>();
  private told = new Map<string, Told>();
  private lastTickAt: number | undefined;
  private offUntil = 0;
  // Ids the last answer marked eligible: false, until when (see TURNED_AWAY_MS).
  private turnedAway = new Map<string, number>();
  private opts: {
    boardId: string;
    supabaseUrl: string;
    serviceKey: string | undefined;
    send: (conn: Connection, message: string) => void;
  };

  constructor(opts: TogetherWatch["opts"]) {
    this.opts = opts;
  }

  // An edit that reached the doc (Y.Doc 'update'; the origin is the sender's
  // Connection, or something else for the room's own writes). Both listeners
  // run inside Yjs's own emit, where a throw would cut off the listeners after
  // them (the save, the broadcast): nothing here may escape.
  onDocUpdate(origin: unknown) {
    try {
      const uid = userIdOf(origin);
      if (uid) noteActivity(this.people, uid, Date.now());
    } catch (_) { /* counting is never worth an edit */ }
  }

  // A presence change (awareness 'change': real differences only, never the
  // keepalive's renewals; viewers' presence arrives here too). Only the input
  // fields count, compared per tab with what that tab last showed.
  onAwarenessChange(
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
    states: Map<number, unknown>,
  ) {
    try {
      for (const id of changes.removed) this.seen.delete(id);
      const uid = userIdOf(origin);
      if (!uid) return;
      const now = Date.now();
      for (const id of [...changes.added, ...changes.updated]) {
        const { moved, sig } = inputMoved(this.seen.get(id), states.get(id));
        if (this.seen.size >= MAX_SEEN && !this.seen.has(id)) this.seen.clear();
        this.seen.set(id, sig);
        if (moved) noteActivity(this.people, uid, now);
      }
    } catch (_) { /* nor a cursor */ }
  }

  // The room's alarm. `conns`: the sockets still open after its checks.
  async tick(conns: Connection[]) {
    const now = Date.now();
    const connected = new Set<string>();
    for (const c of conns) { const u = userIdOf(c); if (u) connected.add(u); }
    const active = activeNow(this.people, connected, now);

    for (const [id, until] of this.turnedAway) if (until <= now || !connected.has(id)) this.turnedAway.delete(id);

    let answer: TickAnswer | null = null;
    // More than MAX_PEOPLE is a crowd, not a work session: nobody is paid.
    if (active.length >= 2 && active.length <= MAX_PEOPLE && now >= this.offUntil) {
      const seconds = togetherSeconds(active, now, this.lastTickAt, new Set(this.turnedAway.keys()));
      if (seconds.size) {
        answer = await this.ask(active.map((p) => ({ id: p.id, s: seconds.get(p.id) ?? 0 })), false);
        // Nothing known: leave everyone as they were. This minute is credited by
        // the next tick that gets through (and the database never pays the same
        // second twice).
        if (!answer) return;
        for (const r of answer.results) {
          if (r.eligible) this.turnedAway.delete(r.id);
          else this.turnedAway.set(r.id, now + TURNED_AWAY_MS);
        }
      }
    }
    this.lastTickAt = now;

    const { told, say, ended } = settleTick(this.told, answer, now);
    this.told = told;
    for (const c of conns) {
      const message = say.get(userIdOf(c));
      if (!message) continue;
      try { this.opts.send(c, message); } catch (_) { /* socket already gone */ }
    }
    if (ended.length) await this.ask(ended, true);
  }

  private async ask(people: Array<{ id: string; s: number }>, ended: boolean): Promise<TickAnswer | null> {
    const key = this.opts.serviceKey;
    const list = people.filter((p) => UUID.test(p.id));
    if (!key || list.length === 0 || list.length > MAX_PEOPLE || !UUID.test(this.opts.boardId)) return null;
    const what = "rpc live_together_tick";
    try {
      const res = await fetch(`${this.opts.supabaseUrl}/rest/v1/rpc/live_together_tick`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ p_board: this.opts.boardId, p_people: list, p_ended: ended }),
        signal: AbortSignal.timeout(8_000),
      });
      if (res.status === 404) { this.offUntil = Date.now() + MISSING_RETRY_MS; return null; }
      if (!res.ok) {
        void reportParty({ kind: "together", severity: "warning", boardId: this.opts.boardId,
          error: callFailed(what, res, await res.text().catch(() => "")) });
        return null;
      }
      const body: unknown = await res.json();
      return isAnswer(body) ? body : null;
    } catch (e) {
      void reportParty({ kind: "together", severity: "warning", boardId: this.opts.boardId, error: callFailed(what, null, "", e) });
      return null;
    }
  }
}
