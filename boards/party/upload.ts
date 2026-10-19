// Upload party — generates short-lived presigned R2 PUT/GET URLs.
//
// Since the move off PartyKit (October 2026) this is NOT a Durable Object: it
// holds no state, so the party Worker (index.ts) runs it in-line for every
// /parties/upload/<room>/... request, at the edge nearest the caller. On
// PartyKit every room was a Durable Object, which sent every sign-reads call
// from every user through ONE object named "default" and every share bundle
// through one named "share". URLs, bodies, responses and status codes are
// unchanged.
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
//           back to `can_write_workspace(<workspaceId>)` — since 0318 a
//           membership row alone is not a write right.
//     Quota: main content is checked against the owner's storage quota —
//           authorize_image_upload(boardId), or authorize_upload(room) with
//           no boardId — and refused 403 { reason: 'over_quota' }.
//     Returns: { uploadUrl, key }
//
//   POST /parties/upload/<workspaceId>/sign-reads
//     Body: { keys: string[], download?: { [key]: filename } }
//     Auth: caller's Supabase JWT — RLS on the `images` table filters
//           to keys the user can actually read (workspace member OR
//           shared into a board the image belongs to).
//     Returns: { urls: { [key]: signedReadUrl }, ttl }, plus
//              downloads: { [key]: attachmentUrl } when `download` was sent
//
// The room name is the workspaceId — there is no room state; the URL segment
// names whose prefix an upload goes under.
//
// Required secrets (`wrangler secret put … -c party/wrangler.jsonc`):
//   R2_ACCOUNT_ID         CF account id (for the R2 endpoint URL)
//   R2_BUCKET             bucket name
//   R2_ACCESS_KEY_ID      R2 API token access key
//   R2_SECRET_ACCESS_KEY  R2 API token secret

import { AwsClient } from "aws4fetch";
import { attachmentDisposition } from "../src/lib/attachmentDisposition.js";
import { bundleRefusalStatus } from "../src/lib/bundleRefusal.js";
import {
  FILE_SHARE_CACHE_CONTROL, FILE_SHARE_URL_TTL_SECONDS, FILE_TOKEN_RE, fileShareResponse,
} from "../src/lib/fileShareBundle.js";
import {
  SAVE_REFUSAL_STATUS, copyKey, copyPlan, saveRefusal, savedCard, savedCardId, savedImageRow,
} from "../src/lib/fileShareSave.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Thumbnails on the Shared page's rows: short-lived and private, like the /f/
// page's own URLs.
const SHARED_THUMB_TTL_SECONDS = 60 * 60;
const SHARED_THUMB_CACHE_CONTROL = "private, max-age=3600";

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

// Board thumbnails and progressive previews are WebP the client renders itself:
// tens to hundreds of KB. They are not counted against the storage quota, so
// their declared size is capped instead (0387).
const DERIVED_MAX_BYTES = 8 * 1024 * 1024;

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

// `download` (optional): key → filename. Those keys are ALSO signed with a
// Content-Disposition: attachment override and returned under `downloads`, so
// the browser's own download manager can stream a big file with progress
// instead of the app buffering it into a Blob (MEDIA-09). Clients that do not
// send it get exactly the old response.
interface SignReadsBody { keys?: string[]; download?: Record<string, string> }
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
// `opts` lets a caller shorten the URL's life and swap the cache header; the
// defaults are the long-lived immutable pair every existing caller wants.
async function signReadUrl(
  r2: AwsClient, env: R2Env, key: string, disposition: string | null = null,
  opts: { ttl?: number; cacheControl?: string } = {},
): Promise<string> {
  const base = `https://${env.accountId}.r2.cloudflarestorage.com/${env.bucket}/${key}`;
  // X-Amz-Expires MUST be a signed query param ON THE URL before signing.
  // aws4fetch has no `expiresIn` option — if X-Amz-Expires is absent it forces
  // its own 86400 (24h) default, so a URL we believe is good for 7 days actually
  // dies in a day (the client then serves a dead URL → 403 → the "locked" image).
  // Setting it here makes aws4fetch sign + keep our 7-day value.
  const r2Url = `${base}?response-cache-control=${encodeURIComponent(opts.cacheControl ?? READ_RESPONSE_CACHE_CONTROL)}`
    + (disposition ? `&response-content-disposition=${encodeURIComponent(disposition)}` : "")
    + `&X-Amz-Expires=${opts.ttl ?? READ_URL_TTL_SECONDS}`;
  const signed = await r2.sign(
    new Request(r2Url, { method: "GET" }),
    { aws: { signQuery: true } },
  );
  return signed.url;
}

// ── Party ────────────────────────────────────────────────────────────

// `room` is what PartyKit handed a party: the URL's room segment and the env.
// index.ts builds one per request.
export class UploadParty {
  constructor(readonly room: { id: string; env: Record<string, unknown> }) {}

  async onRequest(req: Request) {
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

    // /file-share is anon-callable too: get_file_share decides access as the
    // caller (their bearer, else the anon key), so signed-out link viewers work.
    if (url.pathname.endsWith("/file-share")) {
      return this.handleFileShare(req, env, origin);
    }

    const accessToken = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
    if (!accessToken) {
      return new Response("Missing Authorization", { status: 401, headers: corsHeaders(origin) });
    }
    const claims = decodeJwt(accessToken);
    if (!claims?.sub) {
      return new Response("Invalid token", { status: 401, headers: corsHeaders(origin) });
    }

    // The Shared page (signed in only): its rows' thumbnails, and "Save a
    // copy" of a file shared with you into a cluster of this workspace.
    if (url.pathname.endsWith("/file-thumbs")) return this.handleFileThumbs(req, accessToken, env, origin);
    if (url.pathname.endsWith("/file-save"))   return this.handleFileSave(req, accessToken, claims.sub, env, origin);

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
    req: Request, env: R2Env, origin: string | null,
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
      // A Supabase outage says nothing about the link: pass it through so the
      // viewer offers a Retry instead of "expired or revoked" (MEDIA-03). But
      // the RPC's own refusal ALSO arrives as a 500 (P0002), so the body
      // decides — see lib/bundleRefusal.js. Clients that predate this treat
      // any non-ok the same way, so it is backward compatible.
      const status = bundleRefusalStatus(rpcRes.status, msg);
      return new Response(`${status === 404 ? "Invalid or expired share link" : "Share link temporarily unavailable"}${msg ? `: ${msg}` : ""}`, {
        status, headers: corsHeaders(origin),
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

  // POST /file-share — anon-callable. Body: { token }. Runs get_file_share AS
  // THE CALLER (their bearer when sent, else the anon key), which decides
  // access (link, person, team) and returns the storage keys; only then are
  // the one file's keys presigned (6h, private cache). See lib/fileShareBundle.js.
  async handleFileShare(
    req: Request, env: R2Env, origin: string | null,
  ): Promise<Response> {
    const cors = corsHeaders(origin);
    let body: { token?: string } = {};
    try { body = (await req.json()) as { token?: string }; } catch (_) {}
    const token = (body.token || "").trim();
    if (!FILE_TOKEN_RE.test(token)) {
      return Response.json({ status: "gone" }, { headers: cors });
    }
    const userBearer = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_file_share`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${userBearer || SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ p_token: token }),
    });
    if (!rpcRes.ok) {
      if (rpcRes.status === 401 && userBearer) {
        return Response.json({ status: "auth_expired" }, { headers: cors });
      }
      const msg = await rpcRes.text().catch(() => "");
      const status = bundleRefusalStatus(rpcRes.status, msg);
      if (status === 404) return Response.json({ status: "gone" }, { headers: cors });
      return new Response("File link temporarily unavailable", { status, headers: cors });
    }
    const result: any = await rpcRes.json();
    const r2 = new AwsClient({
      accessKeyId: env.accessKeyId,
      secretAccessKey: env.secretAccessKey,
      service: "s3",
      region: "auto",
    });
    const out = await fileShareResponse(
      result,
      (key: string, disp: string | null) => signReadUrl(r2, env, key, disp, {
        ttl: FILE_SHARE_URL_TTL_SECONDS, cacheControl: FILE_SHARE_CACHE_CONTROL,
      }),
      attachmentDisposition,
    );
    return Response.json(out, { headers: { ...(cors as Record<string, string>), "Cache-Control": "no-store" } });
  }

  // POST /file-thumbs — signed in. Body: { tokens: uuid[] (≤ 50) }. Presigns
  // the poster of each shared file the caller can open, for the Shared page's
  // rows. get_file_share_posters (SQL, as the caller) decides which; the keys
  // never leave the Worker.
  async handleFileThumbs(
    req: Request, accessToken: string, env: R2Env, origin: string | null,
  ): Promise<Response> {
    const cors = corsHeaders(origin);
    let body: { tokens?: unknown } = {};
    try { body = (await req.json()) as { tokens?: unknown }; } catch (_) {}
    const tokens = Array.isArray(body.tokens)
      ? [...new Set(body.tokens.map((t) => String(t || "").trim()).filter((t) => FILE_TOKEN_RE.test(t)))].slice(0, 50)
      : [];
    if (!tokens.length) return Response.json({ urls: {} }, { headers: cors });
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_file_share_posters`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ p_tokens: tokens }),
    });
    if (!rpcRes.ok) {
      if (rpcRes.status === 401) return Response.json({ status: "auth_expired" }, { headers: cors });
      return new Response("Thumbnails temporarily unavailable", { status: 503, headers: cors });
    }
    const keys: Record<string, unknown> = (await rpcRes.json().catch(() => ({}))) || {};
    const r2 = this.mkR2Client(env);
    const urls: Record<string, string> = {};
    await Promise.all(Object.entries(keys).map(async ([t, k]) => {
      if (!FILE_TOKEN_RE.test(t) || typeof k !== "string" || !k) return;
      try {
        urls[t] = await signReadUrl(r2, env, k, null, {
          ttl: SHARED_THUMB_TTL_SECONDS, cacheControl: SHARED_THUMB_CACHE_CONTROL,
        });
      } catch (_) { /* that row keeps its kind icon */ }
    }));
    return Response.json({ urls, ttl: SHARED_THUMB_TTL_SECONDS },
      { headers: { ...(cors as Record<string, string>), "Cache-Control": "no-store" } });
  }

  // POST /<workspaceId>/file-save — signed in. Body: { token, boardId }.
  // "Save a copy" of a file shared with you into a cluster of THIS workspace:
  //   1. the cluster is in this workspace and the caller can edit it;
  //   2. get_file_share AS THE CALLER says they may open and download it
  //      (lib/fileShareSave.js saveRefusal);
  //   3. authorize_upload charges the bytes to this workspace's owner (402 is
  //      the storage wall, as for an upload) and the intents hold them;
  //   4. R2 copies the object server-side (CopyObject, or UploadPartCopy in
  //      parts above the single-copy ceiling), the poster too;
  //   5. the images rows are inserted as the caller, like an upload's.
  // Returns { ok, card }: the client lands it through /api/clusters/append.
  // The source keys never leave the Worker.
  async handleFileSave(
    req: Request, accessToken: string, userId: string, env: R2Env, origin: string | null,
  ): Promise<Response> {
    const workspaceId = this.room.id;
    const cors = corsHeaders(origin);
    const refuse = (reason: string, extra: Record<string, unknown> = {}) => Response.json(
      { error: reason, reason, ...extra },
      { status: (SAVE_REFUSAL_STATUS as Record<string, number>)[reason] || 400, headers: cors },
    );
    let body: { token?: string; boardId?: string } = {};
    try { body = (await req.json()) as { token?: string; boardId?: string }; } catch (_) {}
    const token = String(body.token || "").trim();
    const boardId = String(body.boardId || "").trim();
    if (!FILE_TOKEN_RE.test(token)) return refuse("gone");
    if (!UUID_RE.test(boardId) || !UUID_RE.test(workspaceId)) return refuse("wrong_workspace");

    // 1. Where it goes.
    const rows = await supabaseGet(
      `boards?id=eq.${encodeURIComponent(boardId)}&deleted_at=is.null&select=id,workspace_id`, accessToken);
    if (!rows?.[0] || rows[0].workspace_id !== workspaceId) return refuse("wrong_workspace");
    const canWrite = await supabaseRpc("can_write_board", { p_board_id: boardId }, accessToken);
    if (canWrite !== true) return refuse("not_writer");

    // 2. What it is, as the caller sees it.
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_file_share`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ p_token: token }),
    });
    if (!rpcRes.ok) {
      if (rpcRes.status === 401) return Response.json({ status: "auth_expired" }, { status: 401, headers: cors });
      return new Response("Saving is temporarily unavailable", { status: 503, headers: cors });
    }
    const result: any = await rpcRes.json().catch(() => null);
    const why = saveRefusal(result);
    if (why) return refuse(why);
    const srcKey: string = result.keys.src;
    // An image's poster is its preview, which the copy makes for itself; a
    // video's poster and a PDF's page-one picture are part of the card.
    const posterSrc: string | null = result.file.kind === "video" || result.file.kind === "pdf"
      ? (typeof result.keys.poster === "string" && result.keys.poster ? result.keys.poster : null)
      : null;

    // 3. Room for it: the exact sizes from R2, charged to this workspace.
    const r2 = this.mkR2Client(env);
    const head = await r2.fetch(this.r2ObjectUrl(env, srcKey), { method: "HEAD" }).catch(() => null);
    if (!head || !head.ok) return refuse("gone");
    const bytes = Number(head.headers.get("content-length")) || 0;
    const contentType = head.headers.get("content-type") || "application/octet-stream";
    let posterBytes = 0;
    if (posterSrc) {
      const ph = await r2.fetch(this.r2ObjectUrl(env, posterSrc), { method: "HEAD" }).catch(() => null);
      posterBytes = ph && ph.ok ? Number(ph.headers.get("content-length")) || 0 : 0;
    }
    const plan = copyPlan(bytes);
    if (!plan) return refuse("gone");
    const authRows = await supabaseRpc("authorize_upload",
      { p_workspace_id: workspaceId, p_bytes: bytes + posterBytes }, accessToken);
    const auth = Array.isArray(authRows) ? authRows[0] : authRows;
    if (!auth || auth.allow !== true) {
      const reason = auth?.reason === "over_quota" ? "over_quota" : "not_writer";
      return refuse(reason, { used: auth?.used ?? null, quota: auth?.quota ?? null, remaining: auth?.remaining ?? null });
    }
    const dstKey = copyKey(workspaceId, srcKey, crypto.randomUUID());
    const dstPoster = posterSrc && posterBytes > 0 ? copyKey(workspaceId, posterSrc, crypto.randomUUID()) : null;
    const held = await supabaseRpc("record_upload_intent", {
      p_key: dstKey, p_bytes: bytes, p_kind: plan.mode === "single" ? "put" : "multipart", p_board_id: boardId,
    }, accessToken);
    if (held !== true) return new Response("Could not reserve this copy", { status: 503, headers: cors });
    // The poster is copied only once its bytes are held too; without it the
    // card still works and makes its own.
    const posterHeld = dstPoster
      ? (await supabaseRpc("record_upload_intent",
          { p_key: dstPoster, p_bytes: posterBytes, p_kind: "put", p_board_id: boardId }, accessToken)) === true
      : false;

    // 4. The bytes.
    if (!(await this.copyObject(r2, env, srcKey, dstKey, plan, contentType))) {
      return new Response("Could not copy the file", { status: 502, headers: cors });
    }
    let posterKey: string | null = null;
    if (dstPoster && posterSrc && posterHeld) {
      const pplan = copyPlan(posterBytes);
      if (pplan && await this.copyObject(r2, env, posterSrc, dstPoster, pplan, "image/jpeg")) posterKey = dstPoster;
    }

    // 5. The rows that make them this workspace's files.
    const cardId = savedCardId(result.file.kind);
    const name = typeof result.file.name === "string" ? result.file.name : null;
    const imageRows = [savedImageRow({ workspaceId, boardId, cardId, key: dstKey, bytes, userId, originalName: name })];
    if (posterKey) imageRows.push(savedImageRow({ workspaceId, boardId, cardId, key: posterKey, bytes: posterBytes, userId, originalName: null }));
    const ins = await fetch(`${SUPABASE_URL}/rest/v1/images`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(imageRows),
    });
    if (!ins.ok) {
      // No images row: the object is an orphan the R2 sweep reclaims.
      return new Response("Could not finish saving the file", { status: 503, headers: cors });
    }
    const card = savedCard(result, { cardId, srcKey: dstKey, posterKey });
    return Response.json({ ok: true, card, bytes }, { headers: { ...(cors as Record<string, string>), "Cache-Control": "no-store" } });
  }

  // A server-side copy inside the bucket: one CopyObject, or a multipart
  // upload whose parts are UploadPartCopy ranges. True when the object exists
  // whole at dstKey.
  async copyObject(
    r2: AwsClient, env: R2Env, srcKey: string, dstKey: string,
    plan: { mode: string; parts?: Array<{ partNumber: number; start: number; end: number }> },
    contentType: string,
  ): Promise<boolean> {
    const source = `/${env.bucket}/${srcKey.split("/").map(encodeURIComponent).join("/")}`;
    if (plan.mode === "single") {
      const res = await r2.fetch(this.r2ObjectUrl(env, dstKey), {
        method: "PUT", headers: { "x-amz-copy-source": source },
      }).catch(() => null);
      if (!res) return false;
      const text = await res.text().catch(() => "");
      return res.ok && !/<Error>/.test(text);
    }
    const uploadId = await this.createMultipart(r2, env, dstKey, contentType);
    if (!uploadId) return false;
    const parts: Array<{ partNumber: number; etag: string }> = [];
    for (const p of plan.parts || []) {
      const url = `${this.r2ObjectUrl(env, dstKey)}?partNumber=${p.partNumber}&uploadId=${encodeURIComponent(uploadId)}`;
      const res = await r2.fetch(url, {
        method: "PUT",
        headers: { "x-amz-copy-source": source, "x-amz-copy-source-range": `bytes=${p.start}-${p.end}` },
      }).catch(() => null);
      const text = res ? await res.text().catch(() => "") : "";
      const m = text.match(/<ETag>([^<]+)<\/ETag>/);
      if (!res || !res.ok || !m) {
        await this.abortMultipart(r2, env, dstKey, uploadId);
        return false;
      }
      parts.push({ partNumber: p.partNumber, etag: m[1].replace(/&quot;/g, "") });
    }
    const done = await this.completeMultipart(r2, env, dstKey, uploadId, parts);
    if (!done.ok) {
      await this.abortMultipart(r2, env, dstKey, uploadId);
      return false;
    }
    return true;
  }

  // POST /public-bundle — anon-callable. Body: { slug, boardId? }. Identical to
  // /share-bundle but keyed by a published public-board slug
  // (get_public_board_bundle) instead of a share token. The RPC validates the
  // slug (published + not-deleted) and re-checks any boardId stays in the
  // published subtree. LOCKSTEP with handleShareBundle / get_share_bundle.
  async handlePublicBundle(
    req: Request, env: R2Env, origin: string | null,
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
      // Same as /share-bundle: an outage is not "no such board" (MEDIA-03),
      // and the RPC's own refusal is (lib/bundleRefusal.js).
      const status = bundleRefusalStatus(rpcRes.status, msg);
      return new Response(`${status === 404 ? "No such public board" : "Public board temporarily unavailable"}${msg ? `: ${msg}` : ""}`, {
        status, headers: corsHeaders(origin),
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
        // Invite links (0189): { role, kind } — the /share viewer renders the
        // "Join as editor/viewer" confirm card off this. Null for view links
        // and for get_public_board_bundle (which never sets it).
        join: bundle.join || null,
      },
      { headers: corsHeaders(origin) },
    );
  }

  // POST / — presign R2 PUT URL for a fresh UUID-keyed object.
  async handlePresignPut(
    req: Request, accessToken: string, userId: string,
    env: R2Env, origin: string | null,
  ): Promise<Response> {
    const workspaceId = this.room.id;
    let body: PresignBody = {};
    try { body = (await req.json()) as PresignBody; } catch (_) {}

    // Two-stage auth by design (do NOT collapse into a single
    // authorize_image_upload call): this writer check fails CLOSED — an RPC
    // error yields allowed=false → 403 — while the quota check below fails
    // OPEN. Merging them would force one of the two to adopt the other's
    // failure mode: either a transient error bypasses writer authz (security
    // hole) or it blocks a core image drop (the availability regression the
    // quota comment below deliberately avoids).
    let allowed = false;
    if (body.boardId) {
      const data = await supabaseRpc("can_write_board", { p_board_id: body.boardId }, accessToken);
      allowed = data === true;
      // 0313: the key prefix below is this.room.id — a URL segment the CLIENT
      // chose — while the check above only proves the caller can write the
      // board. Nothing related the two, so an editor on a board in workspace A
      // could mint keys under workspace B's prefix and file the images row
      // against B (billing B's owner, visible to B's members). Require that
      // the room is either the board's own workspace or one the caller
      // belongs to; share editors filing under their own workspace keep
      // working, a foreign prefix does not. mpu/* is already covered because
      // authorize_upload(p_workspace_id = room.id) checks membership itself.
      if (allowed) {
        const rows = await supabaseGet(
          `boards?id=eq.${encodeURIComponent(body.boardId)}&select=workspace_id`,
          accessToken,
        );
        const boardWorkspace = rows?.[0]?.workspace_id;
        if (boardWorkspace !== workspaceId) {
          const member = await supabaseGet(
            `workspace_members?workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(userId)}&select=user_id`,
            accessToken,
          );
          allowed = !!member && member.length > 0;
        }
      }
    } else {
      // No boardId: the caller is minting a key under this workspace's prefix
      // with nothing tying it to a board. Since 0318 a membership row is not a
      // write right (a viewer reads; a banned member has nothing), so ask the
      // same predicate the database uses. An RPC error is null → not allowed,
      // the same fail-closed shape as the boardId branch above.
      const data = await supabaseRpc("can_write_workspace", { ws: workspaceId }, accessToken);
      allowed = data === true;
    }
    if (!allowed) {
      return new Response("Not allowed to upload to this board", { status: 403, headers: corsHeaders(origin) });
    }

    const ext = (body.fileExt || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
    const contentType = body.contentType || "application/octet-stream";
    // Deterministic keys (thumbnail overwrite-in-place, or a per-image preview)
    // only when they match a prefix-locked, shape-validated shape — otherwise
    // mint a random UUID key. The can_write_board(boardId) /
    // can_write_workspace(room) check above already gated this request.
    const canonicalThumbKey = body.boardId ? `${workspaceId}/thumbs/${body.boardId}.webp` : null;
    const thumbKeyPrefix = body.boardId ? `${workspaceId}/thumbs/${body.boardId}` : null;
    // Two accepted thumb shapes: the canonical overwrite-in-place key (auto
    // thumbnails), and a VERSIONED custom key `<boardId>-c<ts>.webp` — custom
    // thumbnails stopped overwriting the canonical key so "set custom" and
    // "reset to auto" are revertible (the previous bytes survive at their own
    // key). Still prefix-locked to this workspace + board.
    const isValidThumbKey = (k?: string) =>
      typeof k === "string" && !!thumbKeyPrefix
      && k.startsWith(thumbKeyPrefix)
      && (k === canonicalThumbKey || /^-c\d{1,16}\.webp$/.test(k.slice(thumbKeyPrefix.length)))
      && k.length < 256;
    const previewPrefix = `${workspaceId}/previews/`;
    const isValidPreviewKey = (k?: string) =>
      typeof k === "string"
      && k.startsWith(previewPrefix)
      && /^[a-z0-9-]+\.webp$/i.test(k.slice(previewPrefix.length))  // uuid.webp — no slashes/traversal
      && k.length < 256;
    const key =
      (body.thumbKey && isValidThumbKey(body.thumbKey)) ? body.thumbKey
      : (body.previewKey && isValidPreviewKey(body.previewKey)) ? body.previewKey
      : `${workspaceId}/${crypto.randomUUID()}.${ext}`;

    // Owner-pays byte ceiling (0187): this single-PUT path was unmetered —
    // only multipart ran authorize_upload. Gate MAIN-CONTENT uploads against
    // the board owner's aggregate quota; derived assets (board thumbs,
    // progressive previews) are tiny, deterministic-keyed, and stay ungated.
    // A null verdict (RPC error) fails OPEN — the prior behavior was no check
    // at all, and blocking core image drops on a transient RPC failure is the
    // worse trade.
    const isDerivedKey = isValidThumbKey(key) || key.startsWith(previewPrefix);

    // THE BYTE COUNT IS BINDING (migration 0387, audit AC-5). It is signed into
    // the PUT URL as Content-Length below, so R2 refuses a body of any other
    // size, and a main upload's count becomes its upload intent before the key
    // leaves this function — the images row then takes its size from that, not
    // from the client. Before this the URL took any number of bytes and the
    // row carried whatever size the client wrote, so the quota never filled.
    const declared = Number(body.bytes);
    if (!Number.isSafeInteger(declared) || declared < 0) {
      return new Response("bytes required", { status: 400, headers: corsHeaders(origin) });
    }
    if (isDerivedKey && declared > DERIVED_MAX_BYTES) {
      return new Response("Too large for a thumbnail or preview", { status: 413, headers: corsHeaders(origin) });
    }

    if (!isDerivedKey) {
      // No boardId (images pasted into a doc page, avatars): the quota is the
      // workspace owner's, via authorize_upload(room). This branch used to
      // skip the check entirely, so a free owner over quota was refused on
      // the canvas and accepted in a doc (DB-10). Same fail-open shape and
      // same 403 over_quota answer as the board branch — only over_quota
      // refuses here (owner_not_paid is the multipart file-size gate, not an
      // image one). Current clients already handle this response.
      // Deliberate consequence: a profile picture or workspace icon is
      // uploaded into the ACTIVE workspace (ProfileTab, WorkspaceTab), so an
      // editor working inside someone else's over-quota workspace is refused
      // an avatar change there, with the cluster-owner wording. The bytes
      // would be billed to that owner, so the refusal is right; uploading
      // avatars to the user's own workspace is the fix if it ever bites.
      const authRows = body.boardId
        ? await supabaseRpc("authorize_image_upload", { p_board_id: body.boardId, p_bytes: declared }, accessToken)
        : await supabaseRpc("authorize_upload", { p_workspace_id: workspaceId, p_bytes: declared }, accessToken);
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
    if (!isDerivedKey) {
      const recorded = await supabaseRpc("record_upload_intent", {
        p_key: key, p_bytes: declared, p_kind: "put", p_board_id: body.boardId || null,
      }, accessToken);
      if (recorded !== true) {
        return new Response("Could not reserve this upload", { status: 503, headers: corsHeaders(origin) });
      }
    }

    const r2Url = `https://${env.accountId}.r2.cloudflarestorage.com/${env.bucket}/${key}?X-Amz-Expires=300`;
    // allHeaders: aws4fetch leaves Content-Length out of the signature by
    // default. Only the length (and host) is signed — the browser's
    // Content-Type stays free, as it always was. A URL whose signature does not
    // cover the length is never handed out.
    const signed = await r2.sign(
      new Request(r2Url, { method: "PUT", headers: { "Content-Length": String(declared) } }),
      { aws: { signQuery: true, allHeaders: true } },
    );
    if (!/X-Amz-SignedHeaders=[^&]*content-length/i.test(signed.url)) {
      return new Response("Could not sign this upload", { status: 500, headers: corsHeaders(origin) });
    }

    return Response.json({ uploadUrl: signed.url, key }, {
      headers: corsHeaders(origin),
    });
  }

  // POST /sign-reads — batch presign read URLs. RLS does the filter.
  async handleSignReads(
    req: Request, accessToken: string,
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
    const downloads: Record<string, string> = {};
    const wanted = (body.download && typeof body.download === "object") ? body.download : null;
    await Promise.all(requested.map(async (key) => {
      if (!allowedKeys.has(key)) return;
      out[key] = await signReadUrl(r2, env, key);
      const disposition = wanted && typeof wanted[key] === "string" ? attachmentDisposition(wanted[key]) : null;
      if (disposition) downloads[key] = await signReadUrl(r2, env, key, disposition);
    }));

    return Response.json(
      wanted ? { urls: out, downloads, ttl: READ_URL_TTL_SECONDS } : { urls: out, ttl: READ_URL_TTL_SECONDS },
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
  // body" pattern. Returns { ok, bytes } where bytes is what R2 reports for the
  // finished object — the number the quota should believe, rather than whatever
  // the client said before uploading.
  async completeMultipart(
    r2: AwsClient, env: R2Env, key: string, uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>,
  ): Promise<{ ok: boolean; bytes?: number | null; error?: string }> {
    const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const body = `<CompleteMultipartUpload>${sorted.map((p) => {
      const et = String(p.etag || "").replace(/^"+|"+$/g, "");
      return `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>"${et}"</ETag></Part>`;
    }).join("")}</CompleteMultipartUpload>`;
    const url = `${this.r2ObjectUrl(env, key)}?uploadId=${encodeURIComponent(uploadId)}`;
    const res = await r2.fetch(url, { method: "POST", body, headers: { "Content-Type": "application/xml" } });
    const text = await res.text().catch(() => "");
    if (!res.ok || /<Error>/.test(text)) return { ok: false, error: text.slice(0, 500) };
    let bytes: number | null = null;
    try {
      const head = await r2.fetch(this.r2ObjectUrl(env, key), { method: "HEAD" });
      const lenHeader = head.headers.get("content-length");
      const len = lenHeader == null ? NaN : Number(lenHeader);
      if (head.ok && Number.isFinite(len) && len >= 0) bytes = len;
    } catch (_) { /* size stays unknown; the admin-triggered size backfill fills NULLs */ }
    return { ok: true, bytes };
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
    req: Request, accessToken: string, env: R2Env, origin: string | null,
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
    // The declared total is the upload intent (0387); /mpu/complete holds R2's
    // count of the finished object to it.
    const recorded = await supabaseRpc("record_upload_intent", {
      p_key: key, p_bytes: Math.floor(totalBytes), p_kind: "multipart", p_board_id: boardId,
    }, accessToken);
    if (recorded !== true) {
      await this.abortMultipart(r2, env, key, uploadId);
      return new Response("Could not reserve this upload", { status: 503, headers: corsHeaders(origin) });
    }
    const partSize = computePartSize(totalBytes);
    const partCount = Math.max(1, Math.ceil(totalBytes / partSize));
    return Response.json({ key, uploadId, partSize, partCount }, { headers: corsHeaders(origin) });
  }

  // POST /mpu/sign-parts — re-gate writer + key shape, then presign a batch of
  // part PUT URLs. Body: { boardId, key, uploadId, partNumbers:number[] }.
  async handleMpuSignParts(
    req: Request, accessToken: string, env: R2Env, origin: string | null,
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
    req: Request, accessToken: string, env: R2Env, origin: string | null,
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
    // Part URLs cannot carry a length, so the finished object is held to what
    // was declared at /mpu/create (0387): R2's own count must fit the upload
    // intent, or the object is deleted. An object whose size R2 would not
    // report is deleted too — it cannot be checked.
    const finalized = result.bytes == null
      ? null
      : await supabaseRpc("finalize_upload_intent", { p_key: key, p_bytes: result.bytes }, accessToken);
    if (finalized !== true) {
      try { await r2.fetch(this.r2ObjectUrl(env, key), { method: "DELETE" }); } catch (_) { /* swept later */ }
      const verified = result.bytes != null;
      return Response.json(
        { error: verified ? "size_mismatch" : "unverified", reason: verified ? "size_mismatch" : "unverified" },
        { status: verified ? 413 : 503, headers: corsHeaders(origin) },
      );
    }
    return Response.json({ key, bytes: result.bytes }, { headers: corsHeaders(origin) });
  }

  // POST /mpu/abort — discard an in-flight session (user cancel / error).
  async handleMpuAbort(
    req: Request, accessToken: string, env: R2Env, origin: string | null,
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
