// Upload party — generates short-lived presigned R2 PUT/GET URLs.
//
// HTTP-only PartyKit party (no Y state, no WebSocket). Two routes:
//
//   POST /parties/upload/<workspaceId>
//     Body: { fileExt, contentType, boardId? }
//     Auth: caller must `can_write_board(boardId)` (covers workspace
//           members AND editor-shared users). If no boardId, falls
//           back to workspace-membership check.
//     Returns: { uploadUrl, key }
//
//   POST /parties/upload/<workspaceId>/sign-reads
//     Body: { keys: string[] }
//     Auth: caller's Supabase JWT — RLS on the `images` table filters
//           to keys the user can actually read (workspace member OR
//           shared into a board the image belongs to).
//     Returns: { urls: { [key]: signedReadUrl }, ttl }
//
// The room name is the workspaceId — we don't use room state, but
// PartyKit requires a room id in the URL.
//
// Required env vars (set via `npx partykit env add`):
//   R2_ACCOUNT_ID         CF account id (for the R2 endpoint URL)
//   R2_BUCKET             bucket name
//   R2_ACCESS_KEY_ID      R2 API token access key
//   R2_SECRET_ACCESS_KEY  R2 API token secret

import type * as Party from "partykit/server";
import { AwsClient } from "aws4fetch";

const SUPABASE_URL = "https://ehlhlmbpwwalmeisvmdp.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_djb-_42yVCKWTNTfhhVqTQ_9TVpSNAr";

// Read-URL TTL — short enough that a leaked URL goes stale fast,
// long enough that the client cache (4 min) refreshes before expiry.
const READ_URL_TTL_SECONDS = 300;

interface R2Env {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

interface PresignBody {
  fileExt?: string;
  contentType?: string;
  boardId?: string;
}

interface SignReadsBody { keys?: string[] }

// ── Helpers ──────────────────────────────────────────────────────────

function corsHeaders(origin: string | null): HeadersInit {
  const allowed = new Set([
    "https://boards.soleilpictures.com",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]);
  const allow = origin && allowed.has(origin) ? origin : "https://boards.soleilpictures.com";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "3600",
  };
}

function decodeJwt(token: string): { sub?: string; email?: string } | null {
  try {
    const [, payload] = token.split(".");
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch (_) { return null; }
}

async function supabaseRpc(name: string, args: Record<string, unknown>, token: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) return null;
  return res.json();
}

async function supabaseGet(path: string, token: string): Promise<any[] | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) return null;
  return res.json();
}

// ── Party ────────────────────────────────────────────────────────────

export default class UploadParty implements Party.Server {
  constructor(readonly room: Party.Room) {}

  async onRequest(req: Party.Request) {
    const origin = req.headers.get("Origin");
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders(origin) });
    }

    const env = this.r2Env();
    if (typeof env === "string") {
      return new Response(env, { status: 500, headers: corsHeaders(origin) });
    }

    const accessToken = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
    if (!accessToken) {
      return new Response("Missing Authorization", { status: 401, headers: corsHeaders(origin) });
    }
    const claims = decodeJwt(accessToken);
    if (!claims?.sub) {
      return new Response("Invalid token", { status: 401, headers: corsHeaders(origin) });
    }

    const url = new URL(req.url);
    const isSignReads = url.pathname.endsWith("/sign-reads");

    return isSignReads
      ? this.handleSignReads(req, accessToken, env, origin)
      : this.handlePresignPut(req, accessToken, claims.sub, env, origin);
  }

  // POST / — presign R2 PUT URL for a fresh UUID-keyed object.
  async handlePresignPut(
    req: Party.Request, accessToken: string, userId: string,
    env: R2Env, origin: string | null,
  ): Promise<Response> {
    const workspaceId = this.room.id;
    let body: PresignBody = {};
    try { body = (await req.json()) as PresignBody; } catch (_) {}

    let allowed = false;
    if (body.boardId) {
      const data = await supabaseRpc("can_write_board", { p_board_id: body.boardId }, accessToken);
      allowed = data === true;
    } else {
      const rows = await supabaseGet(
        `workspace_members?workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(userId)}&select=user_id`,
        accessToken,
      );
      allowed = !!rows && rows.length > 0;
    }
    if (!allowed) {
      return new Response("Not allowed to upload to this board", { status: 403, headers: corsHeaders(origin) });
    }

    const ext = (body.fileExt || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
    const contentType = body.contentType || "application/octet-stream";
    const key = `${workspaceId}/${crypto.randomUUID()}.${ext}`;

    const r2 = new AwsClient({
      accessKeyId: env.accessKeyId,
      secretAccessKey: env.secretAccessKey,
      service: "s3",
      region: "auto",
    });
    const r2Url = `https://${env.accountId}.r2.cloudflarestorage.com/${env.bucket}/${key}`;
    const signed = await r2.sign(
      new Request(r2Url, { method: "PUT", headers: { "Content-Type": contentType } }),
      { aws: { signQuery: true }, expiresIn: 300 } as any,
    );

    return Response.json({ uploadUrl: signed.url, key }, {
      headers: corsHeaders(origin),
    });
  }

  // POST /sign-reads — batch presign read URLs. RLS does the filter.
  async handleSignReads(
    req: Party.Request, accessToken: string,
    env: R2Env, origin: string | null,
  ): Promise<Response> {
    let body: SignReadsBody = {};
    try { body = (await req.json()) as SignReadsBody; } catch (_) {}
    const requested = (body.keys || [])
      .filter(k => typeof k === "string" && k.length > 0 && k.length < 1024)
      .slice(0, 200);
    if (requested.length === 0) {
      return Response.json({ urls: {}, ttl: READ_URL_TTL_SECONDS }, { headers: corsHeaders(origin) });
    }

    // PostgREST IN-list: ?storage_path=in.("k1","k2",...). Each key is
    // double-quoted; commas separate. Then URL-encode the whole value.
    const inClause = `in.(${requested.map(k => `"${k.replace(/"/g, '\\"')}"`).join(",")})`;
    const rows = await supabaseGet(
      `images?storage_path=${encodeURIComponent(inClause)}&select=storage_path`,
      accessToken,
    );
    const allowedKeys = new Set<string>(
      Array.isArray(rows) ? rows.map((r: any) => r.storage_path) : []
    );

    const r2 = new AwsClient({
      accessKeyId: env.accessKeyId,
      secretAccessKey: env.secretAccessKey,
      service: "s3",
      region: "auto",
    });
    const out: Record<string, string> = {};
    await Promise.all(requested.map(async (key) => {
      if (!allowedKeys.has(key)) return;
      const r2Url = `https://${env.accountId}.r2.cloudflarestorage.com/${env.bucket}/${key}`;
      const signed = await r2.sign(
        new Request(r2Url, { method: "GET" }),
        { aws: { signQuery: true }, expiresIn: READ_URL_TTL_SECONDS } as any,
      );
      out[key] = signed.url;
    }));

    return Response.json(
      { urls: out, ttl: READ_URL_TTL_SECONDS },
      { headers: corsHeaders(origin) },
    );
  }

  r2Env(): R2Env | string {
    const env = {
      accountId:       (this.room.env.R2_ACCOUNT_ID as string)        || "",
      bucket:          (this.room.env.R2_BUCKET as string)            || "",
      accessKeyId:     (this.room.env.R2_ACCESS_KEY_ID as string)     || "",
      secretAccessKey: (this.room.env.R2_SECRET_ACCESS_KEY as string) || "",
    };
    const missing: string[] = [];
    if (!env.accountId)       missing.push("R2_ACCOUNT_ID");
    if (!env.bucket)          missing.push("R2_BUCKET");
    if (!env.accessKeyId)     missing.push("R2_ACCESS_KEY_ID");
    if (!env.secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY");
    if (missing.length) return `R2 not configured. Missing env: ${missing.join(", ")}`;
    return env;
  }
}
