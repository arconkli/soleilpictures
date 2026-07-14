// Upload party — generates short-lived presigned R2 PUT/GET URLs.
//
// Multipart routes (the "upload any file type" feature, ~1GB+ files):
//   POST /parties/upload/<workspaceId>/mpu/create
//     Body: { boardId, fileExt, contentType, totalBytes }
//     Auth: can_write_board(boardId) AND authorize_upload (owner is paid +
//           within the account's storage quota). 402 = over quota, 403 = not
//           a paid owner / not a writer.
//     Returns: { key, uploadId, partSize, partCount }
//   POST .../mpu/sign-parts  Body {boardId,key,uploadId,partNumbers[]} → {urls:{n:url}}
//   POST .../mpu/complete    Body {boardId,key,uploadId,parts:[{partNumber,etag}]} → {key}
//   POST .../mpu/abort       Body {boardId,key,uploadId} → {ok}
//   The browser PUTs part bytes directly to R2 (CORS allows PUT); the party
//   does the S3 Create/Complete/Abort POSTs server-side (CORS forbids POST).
//
// HTTP-only PartyKit party (no Y state, no WebSocket). Base routes:
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

// Multipart upload (the "upload any file type" feature). The browser only ever
// PUTs part bytes (R2 bucket CORS allows PUT); the party does the S3 POST/DELETE
// calls (Create/Complete/Abort) server-side with its R2 creds, because R2 CORS
// forbids POST. Part PUT URLs are presigned with a generous TTL (a multi-GB
// upload's later parts can be signed an hour after the session opened).
const PART_URL_TTL_SECONDS = 60 * 60;            // 1h — long enough for big files
const MPU_MIN_PART = 8 * 1024 * 1024;            // R2/S3 floor is 5 MiB; 8 keeps part count sane
const MPU_MAX_PARTS_TARGET = 9000;               // < 10000 hard cap, leaves headroom

// part size grows with file size so part count stays under the 10000 cap; floored
// at 8 MiB and rounded up to a whole MiB so client + server agree byte-for-byte.
// MUST stay in sync with src/lib/multipartPlan.js computePartSize().
function computePartSize(totalBytes: number): number {
  const MiB = 1024 * 1024;
  const raw = Math.max(MPU_MIN_PART, Math.ceil((totalBytes || 0) / MPU_MAX_PARTS_TARGET));
  return Math.ceil(raw / MiB) * MiB;
}

// A multipart key the client hands back at sign-parts/complete/abort must be a
// fresh original this workspace owns — `<workspaceId>/<uuid>.<ext>`. Rejects
// other prefixes (thumbs/, previews/) and any path traversal.
function isValidUploadKey(key: string, workspaceId: string): boolean {
  const prefix = `${workspaceId}/`;
  if (typeof key !== "string" || key.length > 256 || !key.startsWith(prefix)) return false;
  return /^[a-z0-9-]+\.[a-z0-9]{1,8}$/i.test(key.slice(prefix.length));
}

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
  // Size of the object about to be PUT. Feeds the owner-pays byte ceiling
  // (authorize_image_upload, 0187). Absent/0 from old clients — that only
  // blocks when the owner is already over quota.
  bytes?: number;
}

interface SignReadsBody { keys?: string[] }
interface ShareBundleBody { token?: string; boardId?: string }
interface PublicBundleBody { slug?: string; boardId?: string }

// ── Helpers ──────────────────────────────────────────────────────────

function corsHeaders(origin: string | null): HeadersInit {
  const allowed = new Set([
    "https://clusters.soleilpictures.com",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]);
  // Staging/preview builds run on the workers.dev subdomain (the stable
  // main-soleil-boards.<sub>.workers.dev alias + per-version URLs). Reflect any
  // *.arconkli.workers.dev origin so presign/sign-reads work on the preview too.
  const isPreview = !!origin && /^https:\/\/[a-z0-9-]+\.arconkli\.workers\.dev$/i.test(origin);
  const allow = origin && (allowed.has(origin) || isPreview) ? origin : "https://clusters.soleilpictures.com";
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
    // /public-bundle is also anon-callable (slug-keyed marketing boards).
    if (url.pathname.endsWith("/public-bundle")) {
      return this.handlePublicBundle(req, env, origin);
    }

    const accessToken = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
    if (!accessToken) {
      return new Response("Missing Authorization", { status: 401, headers: corsHeaders(origin) });
    }
    const claims = decodeJwt(accessToken);
    if (!claims?.sub) {
      return new Response("Invalid token", { status: 401, headers: corsHeaders(origin) });
    }

    // Multipart routes (large/arbitrary file uploads). All require the same
    // JWT auth above; each re-checks can_write_board for the specific board.
    if (url.pathname.endsWith("/mpu/create"))     return this.handleMpuCreate(req, accessToken, env, origin);
    if (url.pathname.endsWith("/mpu/sign-parts")) return this.handleMpuSignParts(req, accessToken, env, origin);
    if (url.pathname.endsWith("/mpu/complete"))   return this.handleMpuComplete(req, accessToken, env, origin);
    if (url.pathname.endsWith("/mpu/abort"))      return this.handleMpuAbort(req, accessToken, env, origin);

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
    return this.respondWithBundle(bundle, env, origin);
  }

  // POST /public-bundle — anon-callable. Body: { slug, boardId? }. Identical to
  // /share-bundle but keyed by a published public-board slug
  // (get_public_board_bundle) instead of a share token. The RPC validates the
  // slug (published + not-deleted) and re-checks any boardId stays in the
  // published subtree. LOCKSTEP with handleShareBundle / get_share_bundle.
  async handlePublicBundle(
    req: Party.Request, env: R2Env, origin: string | null,
  ): Promise<Response> {
    let body: PublicBundleBody = {};
    try { body = (await req.json()) as PublicBundleBody; } catch (_) {}
    const slug = (body.slug || "").trim();
    const boardId = (body.boardId || "").trim();
    if (!slug) {
      return new Response("Missing slug", { status: 400, headers: corsHeaders(origin) });
    }

    const rpcBody: Record<string, string> = { p_slug: slug };
    if (boardId) rpcBody.p_board_id = boardId;
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_public_board_bundle`, {
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
      return new Response(`No such public board${msg ? `: ${msg}` : ""}`, {
        status: 404, headers: corsHeaders(origin),
      });
    }
    const bundle: any = await rpcRes.json();
    if (!bundle?.board?.id) {
      return new Response("No such public board", {
        status: 404, headers: corsHeaders(origin),
      });
    }
    return this.respondWithBundle(bundle, env, origin);
  }

  // Presign every image key in a bundle (get_share_bundle / get_public_board_bundle
  // return an identical shape) and format the client-facing JSON. Shared so the
  // share + public paths stay byte-for-byte consistent.
  async respondWithBundle(
    bundle: any, env: R2Env, origin: string | null,
  ): Promise<Response> {
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
        // preview keys are already in image_keys so their presigned URLs are in
        // image_urls above.
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

    // Owner-pays byte ceiling (0187): this single-PUT path was unmetered —
    // only multipart ran authorize_upload. Gate MAIN-CONTENT uploads against
    // the board owner's aggregate quota; derived assets (board thumbs,
    // progressive previews) are tiny, deterministic-keyed, and stay ungated.
    // A null verdict (RPC error) fails OPEN — the prior behavior was no check
    // at all, and blocking core image drops on a transient RPC failure is the
    // worse trade.
    const isDerivedKey = key === canonicalThumbKey || key.startsWith(previewPrefix);
    if (body.boardId && !isDerivedKey) {
      const authRows = await supabaseRpc("authorize_image_upload", {
        p_board_id: body.boardId,
        p_bytes: Math.max(0, Math.floor(Number(body.bytes) || 0)),
      }, accessToken);
      const auth = Array.isArray(authRows) ? authRows[0] : authRows;
      if (auth && auth.allow !== true && auth.reason === "over_quota") {
        return Response.json(
          { error: "over_quota", reason: "over_quota", used: auth.used ?? null, quota: auth.quota ?? null },
          { status: 403, headers: corsHeaders(origin) },
        );
      }
    }

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

  // ── Multipart upload (browser PUTs parts; party does the S3 POSTs) ──────

  mkR2Client(env: R2Env): AwsClient {
    return new AwsClient({
      accessKeyId: env.accessKeyId,
      secretAccessKey: env.secretAccessKey,
      service: "s3",
      region: "auto",
    });
  }

  r2ObjectUrl(env: R2Env, key: string): string {
    return `https://${env.accountId}.r2.cloudflarestorage.com/${env.bucket}/${key}`;
  }

  // S3 CreateMultipartUpload (server-side POST). The object's final Content-Type
  // is fixed here. Returns the uploadId or null on failure.
  async createMultipart(r2: AwsClient, env: R2Env, key: string, contentType: string): Promise<string | null> {
    const res = await r2.fetch(`${this.r2ObjectUrl(env, key)}?uploads`, {
      method: "POST",
      headers: { "Content-Type": contentType },
    });
    if (!res.ok) return null;
    const xml = await res.text().catch(() => "");
    const m = xml.match(/<UploadId>([^<]+)<\/UploadId>/);
    return m ? m[1] : null;
  }

  // Presign a single part PUT (signQuery → only `host` is signed, so the browser
  // can send the raw byte slice with any/no Content-Type; R2 ignores unsigned
  // headers). partNumber + uploadId are signed query params.
  async signPartUrl(r2: AwsClient, env: R2Env, key: string, uploadId: string, partNumber: number): Promise<string> {
    const url = `${this.r2ObjectUrl(env, key)}?partNumber=${partNumber}`
      + `&uploadId=${encodeURIComponent(uploadId)}&X-Amz-Expires=${PART_URL_TTL_SECONDS}`;
    const signed = await r2.sign(new Request(url, { method: "PUT" }), { aws: { signQuery: true } });
    return signed.url;
  }

  // S3 CompleteMultipartUpload (server-side POST). Parts must be sorted ascending
  // with their exact (re-quoted) ETags. Guards against S3's "200 with <Error> in
  // body" pattern.
  async completeMultipart(
    r2: AwsClient, env: R2Env, key: string, uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>,
  ): Promise<{ ok: boolean; error?: string }> {
    const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const body = `<CompleteMultipartUpload>${sorted.map((p) => {
      const et = String(p.etag || "").replace(/^"+|"+$/g, "");
      return `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>"${et}"</ETag></Part>`;
    }).join("")}</CompleteMultipartUpload>`;
    const url = `${this.r2ObjectUrl(env, key)}?uploadId=${encodeURIComponent(uploadId)}`;
    const res = await r2.fetch(url, { method: "POST", body, headers: { "Content-Type": "application/xml" } });
    const text = await res.text().catch(() => "");
    if (!res.ok || /<Error>/.test(text)) return { ok: false, error: text.slice(0, 500) };
    return { ok: true };
  }

  // S3 AbortMultipartUpload (server-side DELETE). Best-effort.
  async abortMultipart(r2: AwsClient, env: R2Env, key: string, uploadId: string): Promise<void> {
    try {
      await r2.fetch(`${this.r2ObjectUrl(env, key)}?uploadId=${encodeURIComponent(uploadId)}`, { method: "DELETE" });
    } catch (_) { /* already gone / network — caller doesn't care */ }
  }

  // POST /mpu/create — gate (can_write_board + authorize_upload) then open an
  // S3 multipart session. Body: { boardId, fileExt, contentType, totalBytes }.
  // 402 over quota, 403 not-paid-owner / not-writer.
  async handleMpuCreate(
    req: Party.Request, accessToken: string, env: R2Env, origin: string | null,
  ): Promise<Response> {
    const workspaceId = this.room.id;
    let body: any = {};
    try { body = await req.json(); } catch (_) {}
    const boardId = (body.boardId || "").trim();
    const totalBytes = Number(body.totalBytes) || 0;
    if (!boardId) return new Response("Missing boardId", { status: 400, headers: corsHeaders(origin) });
    if (!(totalBytes > 0)) return new Response("Missing totalBytes", { status: 400, headers: corsHeaders(origin) });

    const canWrite = await supabaseRpc("can_write_board", { p_board_id: boardId }, accessToken);
    if (canWrite !== true) {
      return Response.json({ error: "Not allowed to upload to this board", reason: "not_writer" },
        { status: 403, headers: corsHeaders(origin) });
    }
    const authRows = await supabaseRpc("authorize_upload", { p_workspace_id: workspaceId, p_bytes: totalBytes }, accessToken);
    const auth = Array.isArray(authRows) ? authRows[0] : authRows;
    if (!auth || auth.allow !== true) {
      const reason = auth?.reason || "denied";
      const status = reason === "over_quota" ? 402 : 403;
      return Response.json(
        { error: reason, reason, used: auth?.used ?? null, quota: auth?.quota ?? null, remaining: auth?.remaining ?? null },
        { status, headers: corsHeaders(origin) },
      );
    }

    const ext = (body.fileExt || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
    const contentType = body.contentType || "application/octet-stream";
    const key = `${workspaceId}/${crypto.randomUUID()}.${ext}`;
    const r2 = this.mkR2Client(env);
    const uploadId = await this.createMultipart(r2, env, key, contentType);
    if (!uploadId) return new Response("Failed to start upload", { status: 502, headers: corsHeaders(origin) });
    const partSize = computePartSize(totalBytes);
    const partCount = Math.max(1, Math.ceil(totalBytes / partSize));
    return Response.json({ key, uploadId, partSize, partCount }, { headers: corsHeaders(origin) });
  }

  // POST /mpu/sign-parts — re-gate writer + key shape, then presign a batch of
  // part PUT URLs. Body: { boardId, key, uploadId, partNumbers:number[] }.
  async handleMpuSignParts(
    req: Party.Request, accessToken: string, env: R2Env, origin: string | null,
  ): Promise<Response> {
    const workspaceId = this.room.id;
    let body: any = {};
    try { body = await req.json(); } catch (_) {}
    const boardId = (body.boardId || "").trim();
    const key = (body.key || "").trim();
    const uploadId = (body.uploadId || "").trim();
    const partNumbers: number[] = Array.isArray(body.partNumbers)
      ? body.partNumbers.filter((n: any) => Number.isInteger(n) && n >= 1 && n <= 10000).slice(0, 1000)
      : [];
    if (!boardId || !key || !uploadId || partNumbers.length === 0)
      return new Response("Bad request", { status: 400, headers: corsHeaders(origin) });
    if (!isValidUploadKey(key, workspaceId))
      return new Response("Bad key", { status: 400, headers: corsHeaders(origin) });
    const canWrite = await supabaseRpc("can_write_board", { p_board_id: boardId }, accessToken);
    if (canWrite !== true) return new Response("Not allowed", { status: 403, headers: corsHeaders(origin) });

    const r2 = this.mkR2Client(env);
    const urls: Record<number, string> = {};
    await Promise.all(partNumbers.map(async (n) => { urls[n] = await this.signPartUrl(r2, env, key, uploadId, n); }));
    return Response.json({ urls }, { headers: corsHeaders(origin) });
  }

  // POST /mpu/complete — finalize the object. Body: { boardId, key, uploadId,
  // parts:[{partNumber,etag}] }. The client inserts the images row after this.
  async handleMpuComplete(
    req: Party.Request, accessToken: string, env: R2Env, origin: string | null,
  ): Promise<Response> {
    const workspaceId = this.room.id;
    let body: any = {};
    try { body = await req.json(); } catch (_) {}
    const boardId = (body.boardId || "").trim();
    const key = (body.key || "").trim();
    const uploadId = (body.uploadId || "").trim();
    const parts = Array.isArray(body.parts) ? body.parts : [];
    if (!boardId || !key || !uploadId || parts.length === 0)
      return new Response("Bad request", { status: 400, headers: corsHeaders(origin) });
    if (!isValidUploadKey(key, workspaceId))
      return new Response("Bad key", { status: 400, headers: corsHeaders(origin) });
    const canWrite = await supabaseRpc("can_write_board", { p_board_id: boardId }, accessToken);
    if (canWrite !== true) return new Response("Not allowed", { status: 403, headers: corsHeaders(origin) });

    const r2 = this.mkR2Client(env);
    const result = await this.completeMultipart(r2, env, key, uploadId, parts);
    if (!result.ok)
      return new Response(`Complete failed: ${result.error || ""}`, { status: 502, headers: corsHeaders(origin) });
    return Response.json({ key }, { headers: corsHeaders(origin) });
  }

  // POST /mpu/abort — discard an in-flight session (user cancel / error).
  async handleMpuAbort(
    req: Party.Request, accessToken: string, env: R2Env, origin: string | null,
  ): Promise<Response> {
    const workspaceId = this.room.id;
    let body: any = {};
    try { body = await req.json(); } catch (_) {}
    const boardId = (body.boardId || "").trim();
    const key = (body.key || "").trim();
    const uploadId = (body.uploadId || "").trim();
    if (!boardId || !key || !uploadId) return new Response("Bad request", { status: 400, headers: corsHeaders(origin) });
    if (!isValidUploadKey(key, workspaceId)) return new Response("Bad key", { status: 400, headers: corsHeaders(origin) });
    const canWrite = await supabaseRpc("can_write_board", { p_board_id: boardId }, accessToken);
    if (canWrite !== true) return new Response("Not allowed", { status: 403, headers: corsHeaders(origin) });

    const r2 = this.mkR2Client(env);
    await this.abortMultipart(r2, env, key, uploadId);
    return Response.json({ ok: true }, { headers: corsHeaders(origin) });
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
