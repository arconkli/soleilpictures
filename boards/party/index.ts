// The party Worker (`soleil-boards-party`): live board sync, workspace presence,
// uploads and signed image reads, share and public bundles, and the admin
// universe stream.
//
// It replaced the PartyKit project of the same name in October 2026, when
// PartyKit's hosted platform shut down. URLs are PartyKit's, so clients change
// only their host: /parties/<party>/<room>[/...], where <party> is the kebab
// case of a Durable Object binding in wrangler.jsonc (Main → main, Workspace →
// workspace, Universe → universe). Upload has no binding: it is stateless and
// runs here in the Worker (see upload.ts).
//
// Every WebSocket is authorised in beforeConnect BEFORE it reaches a Durable
// Object, as PartyKit's static onBeforeConnect did: the room trusts the
// x-user-id / x-can-write headers stamped here, and nothing else. Both hooks
// first delete those headers from whatever the client sent, so no request can
// arrive carrying its own.

import { routePartykitRequest } from "partyserver";
import { BoardParty } from "./board";
import { WorkspaceParty } from "./workspace";
import { UniverseParty } from "./universe";
import { DocParty } from "./doc";
import { UploadParty } from "./upload";
import { authBoard, authWorkspace, bannedAmong, canWriteBoard, docRoomAccess } from "./auth";
import type { Env } from "./env";

export { BoardParty, WorkspaceParty, UniverseParty, DocParty };

const TRUSTED_HEADERS = [
  "x-user-id", "x-user-email", "x-workspace-id", "x-can-write",
  "x-doc-access", "x-anon", "x-token-ok", "x-doc-name",
];
// A shared doc's room: <share id>.<edit|view>.<generation> (0426).
const DOC_ROOM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(edit|view)\.[0-9a-f]{12}$/;
// Boards and workspaces are UUIDs. Anything else is turned away before a
// Durable Object is created for it.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Lobby = { className: string; name: string };

const notFound = () => new Response("Not found", { status: 404 });

function stripTrusted(req: Request) {
  for (const h of TRUSTED_HEADERS) req.headers.delete(h);
}

async function beforeConnect(req: Request, lobby: Lobby, env: Env): Promise<Request | Response> {
  stripTrusted(req);
  const token = new URL(req.url).searchParams.get("access_token");

  if (lobby.className === "Main") {
    if (!UUID.test(lobby.name)) return notFound();
    if (!token) return new Response("Missing access_token", { status: 401 });
    // Independent checks, run together so the upgrade waits on one Supabase
    // round trip, not two.
    const [auth, canWrite] = await Promise.all([
      authBoard(token, lobby.name),
      canWriteBoard(token, lobby.name),
    ]);
    if (!auth.ok) return new Response(auth.reason ?? "Unauthorized", { status: 401 });
    const banned = await bannedAmong(env.SUPABASE_SERVICE_ROLE_KEY, [auth.userId ?? ""]);
    if (auth.userId && banned.has(auth.userId)) return new Response("Account suspended", { status: 403 });
    req.headers.set("x-user-id", auth.userId ?? "");
    req.headers.set("x-user-email", auth.email ?? "");
    req.headers.set("x-workspace-id", auth.workspaceId ?? "");
    req.headers.set("x-can-write", canWrite ? "1" : "0");
    return req;
  }

  // A shared doc's room: the caller's own answer from doc_room_access decides
  // (signed out is fine on a view link; the edit room needs an account that
  // may edit). The room trusts these headers and nothing else.
  if (lobby.className === "Doc") {
    if (!DOC_ROOM.test(lobby.name)) return notFound();
    const share = new URL(req.url).searchParams.get("share") || "";
    const r = await docRoomAccess(token || "", lobby.name, share);
    if (!r || r.status !== "ok") {
      const s = r?.status || "unavailable";
      const code = s === "sign_in" || s === "auth_expired" ? 401 : s === "moved" ? 409 : s === "gone" ? 410
        : s === "unavailable" ? 503 : 403;
      return new Response(s, { status: code });
    }
    if (r.user_id) {
      const banned = await bannedAmong(env.SUPABASE_SERVICE_ROLE_KEY, [String(r.user_id)]);
      if (banned.has(String(r.user_id))) return new Response("Account suspended", { status: 403 });
    }
    req.headers.set("x-user-id", r.user_id ? String(r.user_id) : "");
    req.headers.set("x-doc-access", String(r.access || "view"));
    req.headers.set("x-anon", r.user_id ? "0" : "1");
    req.headers.set("x-token-ok", r.token_ok ? "1" : "0");
    req.headers.set("x-doc-name", String(r.name || "").slice(0, 80));
    return req;
  }

  if (lobby.className === "Workspace") {
    if (!UUID.test(lobby.name)) return notFound();
    if (!token) return new Response("Missing access_token", { status: 401 });
    const auth = await authWorkspace(token, lobby.name);
    if (!auth.ok) return new Response(auth.reason ?? "Unauthorized", { status: 401 });
    // The roster trusts what a client says its identity is; the JWT's subject
    // lets the room refuse a `here` that claims to be someone else.
    req.headers.set("x-user-id", auth.userId ?? "");
    return req;
  }

  return notFound();
}

// Plain HTTP into a room. The board room answers only POST /reset (and its
// preflight); the universe room only its singleton, `main`. Presence has no
// HTTP surface. Each room checks the caller's token itself.
async function beforeRequest(req: Request, lobby: Lobby): Promise<Request | Response> {
  stripTrusted(req);
  if (lobby.className === "Main") {
    const url = new URL(req.url);
    if (!UUID.test(lobby.name) || !url.pathname.endsWith("/reset")) return notFound();
    if (req.method !== "POST" && req.method !== "OPTIONS") return new Response("Method not allowed", { status: 405 });
    return req;
  }
  if (lobby.className === "Universe") return lobby.name === "main" ? req : notFound();
  // A shared doc's room answers only POST /recheck from outside: the owner
  // changed who may be there. Only someone who manages the doc may ask
  // (security review: an open /recheck could keep two rooms awake). Its other
  // routes are its board's, by stub.
  if (lobby.className === "Doc") {
    const url = new URL(req.url);
    if (!DOC_ROOM.test(lobby.name) || !url.pathname.endsWith("/recheck")) return notFound();
    if (req.method === "OPTIONS") return req;
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!bearer) return new Response("Missing token", { status: 401 });
    const r = await docRoomAccess(bearer, lobby.name, "");
    if (!r || r.status !== "ok" || r.access !== "manage") return new Response("Forbidden", { status: 403 });
    return req;
  }
  return notFound();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("ok\n", { headers: { "content-type": "text/plain", "cache-control": "no-store" } });
    }

    const upload = url.pathname.match(/^\/parties\/upload\/([^/]+)/);
    if (upload) {
      return new UploadParty({ id: upload[1], env: env as unknown as Record<string, unknown> }).onRequest(request);
    }

    try {
      const res = await routePartykitRequest(request, env as unknown as Record<string, unknown>, {
        onBeforeConnect: (req: Request, lobby: Lobby) => beforeConnect(req, lobby, env),
        onBeforeRequest: (req: Request, lobby: Lobby) => beforeRequest(req, lobby),
      });
      return res ?? notFound();
    } catch (e) {
      console.error("[party] routing failed", e);
      return new Response("Party unavailable", { status: 503 });
    }
  },
};
