// Universe PartyKit server — powers the admin "Universe" home page.
//
// Singleton room (room id = 'main'). Every admin connection runs its
// own poll loop against Supabase using the admin's own access token,
// so the SECURITY DEFINER RPCs see auth.uid() and _require_admin()
// accepts. No service-role token is ever held server-side.
//
// Three HTTP endpoints, all under /parties/universe/main:
//   GET /stats             SSE  — platform_counters snapshots @ 1Hz
//   GET /snapshot          JSON — one page of nodes + edges
//   GET /deltas            SSE  — new nodes + edges since a cursor
//
// SSE is plain HTTP, so EventSource works from the browser. The
// access token is passed as a query param because EventSource can't
// send custom headers.

import type * as Party from "partykit/server";
import { authAdmin } from "./auth";

const SUPABASE_URL = "https://ehlhlmbpwwalmeisvmdp.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_djb-_42yVCKWTNTfhhVqTQ_9TVpSNAr";

// Adaptive realtime threshold: under this many node+edge events per
// minute, deltas stream one-per-event; above it, the poller buffers
// and emits a single 'batch' frame each tick. Keeps the wire calm
// at high write rates without sacrificing liveness at low ones.
const BATCH_THRESHOLD_PER_MIN = 1000;
const STATS_POLL_MS  = 1000;
const DELTA_POLL_MS  = 2000;
const HEARTBEAT_MS   = 25000;
const MAX_PAGE_NODES = 50000;
const MAX_PAGE_EDGES = 100000;

function corsHeaders(req: Party.Request): Record<string, string> {
  const origin = req.headers.get("origin") || "*";
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };
}

function sseHeaders(req: Party.Request): Record<string, string> {
  return {
    ...corsHeaders(req),
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    "connection": "keep-alive",
    "x-accel-buffering": "no",
  };
}

async function supaRpc<T = unknown>(
  rpc: string,
  body: unknown,
  accessToken: string,
): Promise<{ ok: true; data: T } | { ok: false; status: number; reason: string }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpc}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) {
      const reason = await res.text().catch(() => res.statusText);
      return { ok: false, status: res.status, reason };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (e: any) {
    return { ok: false, status: 0, reason: e?.message || String(e) };
  }
}

type Node = { node_id: string; kind: string; workspace_id: string; created_at: string };
type Edge = { source_id: string; target_id: string; edge_kind: string; created_at: string };

function makeSseStream(
  req: Party.Request,
  onStart: (write: (event: string, data: unknown) => void, close: (reason?: string) => void) => () => void,
): Response {
  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const write = (event: string, data: unknown) => {
        if (closed) return;
        try {
          const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(frame));
        } catch (_) { /* controller closed */ }
      };
      const close = (_reason?: string) => {
        if (closed) return;
        closed = true;
        try { cleanup?.(); } catch (_) {}
        try { heartbeat && clearInterval(heartbeat); } catch (_) {}
        try { controller.close(); } catch (_) {}
      };
      // Comment frame every 25s prevents intermediate proxies from
      // closing the idle connection.
      heartbeat = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(": ping\n\n")); } catch (_) { close(); }
      }, HEARTBEAT_MS);
      cleanup = onStart(write, close);
    },
    cancel() {
      closed = true;
      try { cleanup?.(); } catch (_) {}
      try { heartbeat && clearInterval(heartbeat); } catch (_) {}
    },
  });

  return new Response(stream, { status: 200, headers: sseHeaders(req) });
}

export default class UniverseParty implements Party.Server {
  constructor(readonly room: Party.Room) {}

  async onRequest(req: Party.Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(req) });
    }
    if (req.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders(req) });
    }

    const url = new URL(req.url);
    const token = url.searchParams.get("token") || extractBearer(req);
    if (!token) {
      return new Response("Missing token", { status: 401, headers: corsHeaders(req) });
    }
    const auth = await authAdmin(token);
    if (!auth.ok) {
      const status = auth.reason === "admin only" ? 403 : 401;
      return new Response(auth.reason ?? "Unauthorized", { status, headers: corsHeaders(req) });
    }

    // Route by trailing path segment.
    const tail = url.pathname.split("/").filter(Boolean).pop() || "";

    if (tail === "stats")    return this.handleStats(req, token);
    if (tail === "snapshot") return this.handleSnapshot(req, token, url);
    if (tail === "deltas")   return this.handleDeltas(req, token, url);

    return new Response("Not found", { status: 404, headers: corsHeaders(req) });
  }

  // GET /stats — SSE of platform_counters snapshots @ 1Hz.
  // Only emits when the payload changes (cheap diff via JSON string).
  private handleStats(req: Party.Request, token: string): Response {
    return makeSseStream(req, (write, close) => {
      let last = "";
      let stopped = false;

      const tick = async () => {
        if (stopped) return;
        const res = await supaRpc<Record<string, number>>("admin_universe_stats", {}, token);
        if (stopped) return;
        if (!res.ok) {
          // 401/403 → token expired or revoked → close cleanly so client reconnects.
          if (res.status === 401 || res.status === 403) {
            write("error", { code: res.status, reason: res.reason || "auth" });
            close("auth");
            return;
          }
          // Transient error — log and keep ticking.
          write("warn", { reason: res.reason });
          return;
        }
        const next = JSON.stringify(res.data || {});
        if (next !== last) {
          last = next;
          write("stats", res.data);
        }
      };

      // Fire immediately so the client has data before the first poll tick.
      tick();
      const id = setInterval(tick, STATS_POLL_MS);
      return () => { stopped = true; clearInterval(id); };
    });
  }

  // GET /snapshot?cursor=<iso>&node_limit=<n>&edge_limit=<n>
  // One page. Client calls repeatedly with the returned next_cursor
  // until done=true.
  private async handleSnapshot(req: Party.Request, token: string, url: URL): Promise<Response> {
    const cursor = url.searchParams.get("cursor");
    const nodeLimit = clampInt(url.searchParams.get("node_limit"), 1, MAX_PAGE_NODES, MAX_PAGE_NODES);
    const edgeLimit = clampInt(url.searchParams.get("edge_limit"), 1, MAX_PAGE_EDGES, MAX_PAGE_EDGES);

    const [nodesRes, edgesRes] = await Promise.all([
      supaRpc<Node[]>("admin_universe_snapshot", { p_cursor: cursor, p_limit: nodeLimit }, token),
      supaRpc<Edge[]>("admin_universe_edges",    { p_cursor: cursor, p_limit: edgeLimit }, token),
    ]);

    if (!nodesRes.ok) {
      return new Response(nodesRes.reason || "snapshot failed", {
        status: nodesRes.status || 500,
        headers: corsHeaders(req),
      });
    }
    if (!edgesRes.ok) {
      return new Response(edgesRes.reason || "edges failed", {
        status: edgesRes.status || 500,
        headers: corsHeaders(req),
      });
    }

    const nodes = nodesRes.data || [];
    const edges = edgesRes.data || [];
    // next_cursor is the max created_at across both pages; done when
    // both came back under their limits.
    const allTs = [
      ...nodes.map((n) => n.created_at),
      ...edges.map((e) => e.created_at),
    ];
    const nextCursor = allTs.length ? allTs.reduce((a, b) => (a > b ? a : b)) : null;
    const done = nodes.length < nodeLimit && edges.length < edgeLimit;

    return new Response(JSON.stringify({ nodes, edges, next_cursor: nextCursor, done }), {
      status: 200,
      headers: {
        ...corsHeaders(req),
        "content-type": "application/json",
      },
    });
  }

  // GET /deltas?since=<iso>
  // SSE of new nodes + edges as they appear. Adaptive: under a
  // rolling-minute threshold, frames are per-event ('node', 'edge');
  // above it, frames are batches ('batch') flushed each poll tick.
  private handleDeltas(req: Party.Request, token: string, url: URL): Response {
    const initialSince = url.searchParams.get("since") || new Date().toISOString();

    return makeSseStream(req, (write, close) => {
      let cursor = initialSince;
      let stopped = false;
      const rateWindow: number[] = []; // ms timestamps of recent events

      const recordRate = (n: number) => {
        const now = Date.now();
        for (let i = 0; i < n; i++) rateWindow.push(now);
        const cutoff = now - 60_000;
        while (rateWindow.length > 0 && rateWindow[0] < cutoff) rateWindow.shift();
      };

      const tick = async () => {
        if (stopped) return;
        const [nodesRes, edgesRes] = await Promise.all([
          supaRpc<Node[]>("admin_universe_snapshot", { p_cursor: cursor, p_limit: MAX_PAGE_NODES }, token),
          supaRpc<Edge[]>("admin_universe_edges",    { p_cursor: cursor, p_limit: MAX_PAGE_EDGES }, token),
        ]);
        if (stopped) return;
        if (!nodesRes.ok || !edgesRes.ok) {
          const r = !nodesRes.ok ? nodesRes : edgesRes;
          if (r.status === 401 || r.status === 403) {
            write("error", { code: r.status, reason: r.reason || "auth" });
            close("auth");
            return;
          }
          write("warn", { reason: r.reason });
          return;
        }
        const nodes = nodesRes.data || [];
        const edges = edgesRes.data || [];
        const total = nodes.length + edges.length;
        if (total === 0) return;

        recordRate(total);
        // Advance cursor to the max timestamp returned this tick.
        const allTs = [
          ...nodes.map((n) => n.created_at),
          ...edges.map((e) => e.created_at),
        ];
        cursor = allTs.reduce((a, b) => (a > b ? a : b), cursor);

        const heavy = rateWindow.length > BATCH_THRESHOLD_PER_MIN;
        if (heavy) {
          write("batch", { nodes, edges });
        } else {
          for (const n of nodes) write("node", n);
          for (const e of edges) write("edge", e);
        }
      };

      // Don't fire immediately — the initial 'since' is the moment of
      // connection, so the first tick is what catches the first delta.
      const id = setInterval(tick, DELTA_POLL_MS);
      return () => { stopped = true; clearInterval(id); };
    });
  }
}

function extractBearer(req: Party.Request): string | null {
  const h = req.headers.get("authorization") || "";
  if (!h.toLowerCase().startsWith("bearer ")) return null;
  return h.slice("bearer ".length).trim() || null;
}

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  const n = raw == null ? NaN : parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
