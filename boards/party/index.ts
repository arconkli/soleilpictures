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
import { UploadParty } from "./upload";
import { authBoard, authWorkspace, bannedAmong, canWriteBoard } from "./auth";
import type { Env } from "./env";

export { BoardParty, WorkspaceParty, UniverseParty };

const TRUSTED_HEADERS = ["x-user-id", "x-user-email", "x-workspace-id", "x-can-write"];
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
