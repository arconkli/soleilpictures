// report.ts — the Party Worker's failures, as client_errors rows
// (src/lib/serverErrors.js builds and bounds them; Admin, Errors lists them
// under Servers, as the live sync server).
//
// The entry and every room bind their env first (bindReports): the helpers
// below them (auth.ts, opLog.ts, anomalyDetector.ts, boardRoomState.js) are
// handed no env, and a row needs the service key to be written. A row says
// which deploy wrote it by the version Cloudflare gave it (the
// CF_VERSION_METADATA binding), a room's board by its id (never its name), and
// never what anyone sent.

import { reportServerError } from "../src/lib/serverErrors.js";
import { DEFAULT_SUPABASE_URL, type Env } from "./env";

type Info = Record<string, unknown>;
type Waiter = { waitUntil?(p: Promise<unknown>): void } | null | undefined;

let bound: { SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY?: string } | null = null;
let release: string | null = null;

export function bindReports(env: Env) {
  if (bound) return;
  bound = { SUPABASE_URL: env.SUPABASE_URL || DEFAULT_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY };
  const id = env.CF_VERSION_METADATA?.id;
  release = typeof id === "string" && id ? `party-${id.slice(0, 8)}` : null;
}

// A report made with no waiter is an access check's (auth.ts), handed no ctx.
// One made while index.ts's door is open waits for the door: a write the
// stateless Worker leaves floating is cancelled once its answer goes out, a
// refusal's 401 included. The next door to close writes it, in its own
// waitUntil (it is only data). A room outlives its requests, so with no door
// open it is written at once.
let doors = 0;
let waiting: Info[] = [];

// Never throws, never rejects; the write gives up after five seconds.
export function reportParty(info: Info, waiter?: Waiter): Promise<void> {
  if (!bound) return Promise.resolve();
  if (!waiter && doors > 0) {
    if (waiting.length < 50) waiting.push(info);
    return Promise.resolve();
  }
  return reportServerError(bound, waiter ?? null, { source: "party", release, ...info });
}

// index.ts's door, around each request.
export function doorOpened() { doors += 1; }
export function doorClosed(ctx: Waiter) {
  doors = Math.max(0, doors - 1);
  const due = waiting;
  waiting = [];
  for (const info of due) void reportParty(info, ctx);
}

// A failed call as the error a row says: "rpc can_write_board: unavailable
// (57014)" from its answer, "rpc can_write_board: timed out" from a throw.
// The body is passed only for the code it names; serverErrors.js keeps nothing
// else of it.
export function callFailed(what: string, res: Response | null, body = "", thrown?: unknown): Error {
  if (res) return new Error(`${what} ${res.status}: ${body}`);
  const e = thrown as { name?: string; message?: string } | null | undefined;
  const why = e?.name === "TimeoutError" || e?.name === "AbortError" ? "timed out" : String(e?.message || e || "failed");
  return new Error(`${what}: ${why}`);
}
