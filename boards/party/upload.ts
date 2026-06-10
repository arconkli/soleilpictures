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

// Read-URL TTL — long-lived (7 days = SigV4 max) so the client can persist
// signed URLs across reloads and reuse the SAME url string, turning repeat
// board views into instant browser-disk-cache hits instead of a re-sign +
// re-download every cold open. Paired with the response-cache-control override
// below so R2 actually returns cacheable bytes. Tradeoff: a leaked read URL
// stays valid up to 7 days (was 5 min).
const READ_URL_TTL_SECONDS = 7 * 24 * 60 * 60;  // 604800 (SigV4 max)

// Applied to every signed GET via the SigV4 `response-cache-control` query
// override, so even already-uploaded objects (no re-PUT needed) come back with
// durable, immutable browser caching. Object keys are content-stable (per-UUID
// originals/previews; per-board thumbs overwritten in place), so `immutable`
// is safe — a new image is a new key, never a mutated one.
const READ_RESPONSE_CACHE_CONTROL = "public, max-age=604800, immutable";

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
  // Deterministic per-board thumbnail key. Only honored if it exactly
  // equals `<workspaceId>/thumbs/<boardId>.webp` (prefix-locked, so a client
  // can't overwrite arbitrary objects). Used by uploadBoardThumbnail so a
  // board's preview overwrites in place instead of orphaning UUID objects.
  thumbKey?: string;
  // Deterministic per-image preview key (progressive loading). Only honored
  // if it matches `<workspaceId>/previews/<uuid>.webp` — prefix-locked to the
  // caller's workspace and shape-validated so it can't traverse/overwrite
  // arbitrary objects. Gated by the same can_write_board check below.
  previewKey?: string;
}

interface SignReadsBody { keys?: string[] }
interface ShareBundleBody { token?: string; boardId?: string }

// ── Helpers ──────────────────────────────────────────────────────────

function corsHeaders(origin: string | null): HeadersInit {
  const allowed = new Set([
    "https://clusters.soleilpictures.com",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]);
  const allow = origin && allowed.has(origin) ? origin : "https://clusters.soleilpictures.com";
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

// Presign a long-lived GET URL for an R2 object, with a SigV4
// `response-cache-control` override so R2 returns immutable browser-cache
// headers on the response (no re-PUT of existing objects needed). The override
// is a SIGNED query param — it must be on the URL before signing, or R2 rejects
// the signature. Shared by /sign-reads and /share-bundle so both paths produce
// identical, cacheable, persistable URLs.
async function signReadUrl(r2: AwsClient, env: R2Env, key: string): Promise<string> {
  const base = `https://${env.accountId}.r2.cloudflarestorage.com/${env.bucket}/${key}`;
  // X-Amz-Expires MUST be a signed query param ON THE URL before signing.
  // aws4fetch has no `expiresIn` option — if X-Amz-Expires is absent it forces
  // its own 86400 (24h) default, so a URL we believe is good for 7 days actually
  // dies in a day (the client then serves a dead URL → 403 → the "locked" image).
  // Setting it here makes aws4fetch sign + keep our 7-day value.
  const r2Url = `${base}?response-cache-control=${encodeURIComponent(READ_RESPONSE_CACHE_CONTROL)}`
    + `&X-Amz-Expires=${READ_URL_TTL_SECONDS}`;
  const signed = await r2.sign(
    new Request(r2Url, { method: "GET" }),
    { aws: { signQuery: true } },
  );
  return signed.url;
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

    // The /share-bundle route is anon-callable (public-link viewers
    // don't have a Supabase JWT). Dispatch it before the auth check.
    const url = new URL(req.url);
    if (url.pathname.endsWith("/share-bundle")) {
      return this.handleShareBundle(req, env, origin);
    }

    const accessToken = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
    if (!accessToken) {
      return new Response("Missing Authorization", { status: 401, headers: corsHeaders(origin) });
    }
    const claims = decodeJwt(accessToken);
    if (!claims?.sub) {
      return new Response("Invalid token", { status: 401, headers: corsHeaders(origin) });
    }

    const isSignReads = url.pathname.endsWith("/sign-reads");
    return isSignReads
      ? this.handleSignReads(req, accessToken, env, origin)
      : this.handlePresignPut(req, accessToken, claims.sub, env, origin);
  }

  // POST /share-bundle — anon-callable. Body: { token }. Calls the
  // get_share_bundle RPC (which validates the token + returns board
  // metadata + snapshot bytes + image keys), then presigns the image
  // keys before returning the combined bundle. Anonymous viewers
  // never need any other roundtrip.
  async handleShareBundle(
    req: Party.Request, env: R2Env, origin: string | null,
  ): Promise<Response> {
    let body: ShareBundleBody = {};
    try { body = (await req.json()) as ShareBundleBody; } catch (_) {}
    const token = (body.token || "").trim();
    const boardId = (body.boardId || "").trim();
    if (!token) {
      return new Response("Missing token", { status: 400, headers: corsHeaders(origin) });
    }

    // Anon-key-only call. The RPC is granted to `anon` and validates the
    // token internally (raises if expired/revoked/invalid). An optional
    // boardId asks for a specific board within the link's shared subtree;
    // the RPC re-checks that it's the root or a descendant (and that the
    // link shares sub-boards), so this can't escape the subtree.
    const rpcBody: Record<string, string> = { p_token: token };
    if (boardId) rpcBody.p_board_id = boardId;
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_share_bundle`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(rpcBody),
    });
    if (!rpcRes.ok) {
      const msg = await rpcRes.text().catch(() => "");
      return new Response(`Invalid or expired share link${msg ? `: ${msg}` : ""}`, {
        status: 404, headers: corsHeaders(origin),
      });
    }
    const bundle: any = await rpcRes.json();
    if (!bundle?.board?.id) {
      return new Response("Invalid or expired share link", {
        status: 404, headers: corsHeaders(origin),
      });
    }

    // Presign every image key referenced on the board (5-minute URLs,
    // matching the normal sign-reads TTL).
    const r2 = new AwsClient({
      accessKeyId: env.accessKeyId,
      secretAccessKey: env.secretAccessKey,
      service: "s3",
      region: "auto",
    });
    const imageKeys: string[] = Array.isArray(bundle.image_keys) ? bundle.image_keys : [];
    const imageUrls: Record<string, string> = {};
    await Promise.all(imageKeys.map(async (key) => {
      try {
        imageUrls[key] = await signReadUrl(r2, env, key);
      } catch (_) { /* skip unreachable keys */ }
    }));

    return Response.json(
      {
        board: bundle.board,
        snapshot: bundle.snapshot || null,
        image_urls: imageUrls,
        // Per-original progressive-loading metadata (blur + preview key). The
        // preview keys are already in image_keys (same board_id) so their
        // presigned URLs are in image_urls above.
        image_meta: bundle.image_meta || {},
        role: 'viewer',
        root_id: bundle.root_id || null,
        include_subboards: !!bundle.include_subboards,
        nav_boards: Array.isArray(bundle.nav_boards) ? bundle.nav_boards : [],
      },
      { headers: corsHeaders(origin) },
    );
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
    // Deterministic keys (thumbnail overwrite-in-place, or a per-image preview)
    // only when they match a prefix-locked, shape-validated shape — otherwise
    // mint a random UUID key. The can_write_board(boardId) / membership check
    // above already gated this request.
    const canonicalThumbKey = body.boardId ? `${workspaceId}/thumbs/${body.boardId}.webp` : null;
    const previewPrefix = `${workspaceId}/previews/`;
    const isValidPreviewKey = (k?: string) =>
      typeof k === "string"
      && k.startsWith(previewPrefix)
      && /^[a-z0-9-]+\.webp$/i.test(k.slice(previewPrefix.length))  // uuid.webp — no slashes/traversal
      && k.length < 256;
    const key =
      (body.thumbKey && canonicalThumbKey && body.thumbKey === canonicalThumbKey) ? canonicalThumbKey
      : (body.previewKey && isValidPreviewKey(body.previewKey)) ? body.previewKey
      : `${workspaceId}/${crypto.randomUUID()}.${ext}`;

    const r2 = new AwsClient({
      accessKeyId: env.accessKeyId,
      secretAccessKey: env.secretAccessKey,
      service: "s3",
      region: "auto",
    });
    // X-Amz-Expires must be a signed query param on the URL before signing —
    // aws4fetch has no `expiresIn` option (see signReadUrl above), so the old
    // `{ expiresIn: 300 }` was silently ignored and PUT URLs got the 86400s
    // (24h) SigV4 default instead of the intended 5 minutes.
    const r2Url = `https://${env.accountId}.r2.cloudflarestorage.com/${env.bucket}/${key}?X-Amz-Expires=300`;
    const signed = await r2.sign(
      new Request(r2Url, { method: "PUT", headers: { "Content-Type": contentType } }),
      { aws: { signQuery: true } },
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
      out[key] = await signReadUrl(r2, env, key);
    }));

    return Response.json(
      { urls: out, ttl: READ_URL_TTL_SECONDS },
      { headers: corsHeaders(origin) },
    );
  }

  r2Env(): R2Env | string {
    // .trim() defensively — a trailing newline (e.g. from `echo "..." |
    // npx partykit env add`) gets baked into the SigV4 credential and
    // R2 returns 400. Cheap insurance against fat-finger env values.
    const get = (k: string) => ((this.room.env[k] as string) || "").trim();
    const env = {
      accountId:       get("R2_ACCOUNT_ID"),
      bucket:          get("R2_BUCKET"),
      accessKeyId:     get("R2_ACCESS_KEY_ID"),
      secretAccessKey: get("R2_SECRET_ACCESS_KEY"),
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
