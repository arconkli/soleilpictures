// reportError.ts — an edge function's failures, in Admin, Errors beside the
// Worker's and the live sync server's (errorRowCore.mjs builds and bounds the
// rows, and says what they never hold).
//
//   Deno.serve(reported("stripe-webhook", async (req) => { … }));
//
// reported() is the function's door: every 5xx it answers is recorded once,
// with the cause its answer carries (failedWith), and anything thrown past the
// handler is recorded before it goes on to the runtime's own 500, as it did
// before. Once: a failure that answers a 5xx is never also reported where it
// happened, or 0581's payments rule, at two failures an hour, would read one
// as two. A failure the function catches so that it can carry on (a
// bookkeeping write, a mirror) is recorded where it is caught, with
// reportEdgeError.
import { edgeErrorRow, makeEdgeErrorState } from "./errorRowCore.mjs";

type Info = Record<string, unknown>;
type Handler = (req: Request, info: Deno.ServeHandlerInfo) => Response | Promise<Response>;

const STATE = makeEdgeErrorState();
const CAUSES = new WeakMap<Response, Info>();

// A 5xx answer with what caused it, for the door to record: it is built where
// the failure is known, which need not be where the request is.
//   return failedWith(json({ error: "server_error" }, 500), e, { what: "rpc get_team_billing" });
export function failedWith(res: Response, error: unknown, extra: Info = {}): Response {
  CAUSES.set(res, { error, ...extra });
  return res;
}

// Never throws, never rejects, and gives up on the write after five seconds:
// recording a failure must not be what fails a request. The write is also
// handed to the runtime's waitUntil, so a caller that does not wait for it
// does not lose it when its answer goes out.
export function reportEdgeError(fn: string, info: Info): Promise<void> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return Promise.resolve();
    const row = edgeErrorRow(fn, info, STATE);
    if (!row) return Promise.resolve();
    const p = fetch(`${url}/rest/v1/client_errors`, {
      method: "POST",
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        prefer: "return=minimal",
      },
      body: JSON.stringify([row]),
      signal: AbortSignal.timeout(5_000),
    }).then(() => {}, () => {});
    const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    try { er?.waitUntil?.(p); } catch (_) { /* the caller's await keeps it */ }
    return p;
  } catch (_) {
    return Promise.resolve();
  }
}

export function reported(fn: string, handler: Handler): Handler {
  return async (req, info) => {
    const t0 = Date.now();
    let res: Response;
    try {
      res = await handler(req, info);
    } catch (e) {
      await reportEdgeError(fn, { error: e, request: req, status: 500, phase: "tail", ms: Date.now() - t0 });
      throw e;
    }
    if (res.status >= 500) {
      void reportEdgeError(fn, { request: req, status: res.status, ms: Date.now() - t0, ...CAUSES.get(res) });
    }
    return res;
  };
}
