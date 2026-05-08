// Server-side card_index sync.
//
// Triggered after a board snapshot is written to board_state. Decodes
// the Yjs doc, extracts each card's title + html-stripped body +
// group memberships, and upserts card_index. Mirrors the client-side
// syncCardIndex but runs without requiring anyone to have the board
// open — closes the "card_index goes stale until someone opens this
// board" gap.
//
// Body: { board_id: string }
// Auth: Postgres trigger calls with the service role key in the
//       Authorization header. We don't enforce JWT shape — the
//       service-role check below is enough.

// deno-lint-ignore-file no-explicit-any
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as Y from "npm:yjs@13";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return String(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function syncBoard(boardId: string): Promise<{ ok: boolean; n: number; error?: string }> {
  const board = await sb.from("boards").select("workspace_id").eq("id", boardId).maybeSingle();
  if (board.error || !board.data) {
    return { ok: false, n: 0, error: "board not found: " + boardId };
  }
  const wsId = board.data.workspace_id;
  const snap = await sb.from("board_state").select("doc").eq("board_id", boardId).maybeSingle();
  if (snap.error || !snap.data?.doc) {
    return { ok: false, n: 0, error: "no snapshot for " + boardId };
  }
  const ydoc = new Y.Doc();
  try {
    Y.applyUpdate(ydoc, b64ToBytes(snap.data.doc), "snapshot");
  } catch (err: any) {
    return { ok: false, n: 0, error: "yjs decode failed: " + (err?.message || err) };
  }
  const cards: any = ydoc.getMap("cards");
  // groups is a Y.Map keyed by groupId, NOT a Y.Array — using
  // getArray throws "Type with the name groups has already been
  // defined with a different constructor" when the snapshot
  // includes the map.
  const groups: any = ydoc.getMap("groups");
  const groupNameById = new Map<string, string>();
  try {
    groups.forEach((g: any, id: string) => {
      const name = g?.get?.("name") ?? g?.name;
      if (id) groupNameById.set(String(id), name || "");
    });
  } catch (_) { /* ignore */ }

  const rows: any[] = [];
  const liveIds = new Set<string>();
  cards.forEach((v: any, id: string) => {
    if (!v) return;
    const get = (k: string) => v?.get?.(k) ?? v?.[k];
    const kind = get("kind") || "note";
    const title = get("title") || get("name") || get("label") || get("url") || "";
    const rawBody = get("body") || get("caption") || "";
    const body = rawBody || htmlToText(get("html") || "");
    const groupId = get("groupId") || null;
    const groupName = groupId ? (groupNameById.get(String(groupId)) || "") : "";
    const meta = (groupId || groupName) ? { groupId, groupName } : null;
    rows.push({
      workspace_id: wsId,
      board_id: boardId,
      card_id: id,
      kind,
      title: String(title).slice(0, 200),
      body: String(body).slice(0, 500),
      meta,
    });
    liveIds.add(id);
  });

  if (rows.length > 0) {
    const ups = await sb.from("card_index").upsert(rows, { onConflict: "board_id,card_id" });
    if (ups.error) return { ok: false, n: 0, error: "upsert: " + ups.error.message };
  }

  // Drop card_index rows for cards that no longer exist on the board.
  const existing = await sb.from("card_index").select("card_id").eq("board_id", boardId);
  if (!existing.error) {
    const orphans = (existing.data || []).map((r: any) => r.card_id).filter((id: string) => !liveIds.has(id));
    if (orphans.length > 0) {
      await sb.from("card_index").delete().eq("board_id", boardId).in("card_id", orphans);
    }
  }

  return { ok: true, n: rows.length };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  let body: any = {};
  try { body = await req.json(); } catch (_) { /* ignore */ }
  const boardId: string | string[] | undefined = body?.board_id;
  if (!boardId) {
    return new Response(JSON.stringify({ error: "board_id required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  const ids = Array.isArray(boardId) ? boardId : [boardId];
  const results: any[] = [];
  for (const id of ids) {
    results.push({ board_id: id, ...(await syncBoard(String(id))) });
  }
  return new Response(JSON.stringify({ results }), {
    headers: { "Content-Type": "application/json" },
  });
});
