-- 0218_storage_write_scoping.sql — scope storage WRITES to the caller's own
-- workspace, cap object size, and stop the storage domain rendering attacker-
-- chosen HTML.
--
-- 0165 hardened the READ side of these two buckets: it replaced blanket PUBLIC
-- SELECT policies with membership-scoped, authenticated-only ones so anon could
-- no longer LIST and enumerate every file across every workspace. It
-- deliberately left the buckets `public = true`, because object GET-by-key
-- bypasses RLS and <img>/PDF rendering depends on that. **That decision still
-- holds and this migration does not touch it.**
--
-- What 0165 never touched is the WRITE side, which was still:
--
--   with check (bucket_id = '<bucket>' and auth.uid() is not null)
--
-- granted to PUBLIC. So any signed-in user could write to ANY path in ANY
-- workspace's folder in either bucket, with no size limit and no type limit.
-- Three separate problems in one policy:
--
--   1. Cross-tenant write. The read policies carefully scope to
--      is_workspace_member(folder[1]) — the write policy ignored folder[1]
--      entirely, so anyone could drop a file into someone else's workspace
--      prefix, where that workspace's members would then see it as their own.
--   2. Unbounded storage. No file_size_limit on either bucket.
--   3. Attacker-chosen content-type. Supabase serves back whatever type was
--      declared at upload, and the client declares it from `file.type`. A
--      declared text/html meant a live page on <project>.supabase.co — the same
--      origin as the auth API — and image/svg+xml carries script the same way.
--
-- The client half of (3) is in lib/messageAttachments.js: anything outside the
-- inline-safe set now uploads as application/octet-stream, so no attachment
-- type stops working — a .html or .svg still uploads, attaches and downloads,
-- it just no longer renders itself in place. allowed_mime_types below is that
-- same set plus application/octet-stream, so by construction every upload the
-- client makes is accepted. Keep the two lists in step.
--
-- Sized against the live data: the largest object in either bucket today is
-- ~4.4 MB, so the 50 MB cap below rejects nothing that exists.

-- ── message-attachments: the live bucket ─────────────────────────────────────
-- Path shape is `<workspaceId>/<userId>/<uuid>.<ext>` (lib/messageAttachments.js),
-- so folder[1] is the workspace and folder[2] is the uploader. Scope writes to
-- both: you may only write inside a workspace you belong to, and only inside
-- your own folder within it. The uuid-regex CASE guard mirrors 0165's read
-- policy — a malformed prefix yields NULL, and is_workspace_member(NULL) is
-- false, so it fails closed.
drop policy if exists "msg-att write" on storage.objects;
create policy "msg-att write" on storage.objects for insert to authenticated
with check (
  bucket_id = 'message-attachments'
  and public.is_workspace_member(
    case when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$'
         then ((storage.foldername(name))[1])::uuid end
  )
  and (storage.foldername(name))[2] = auth.uid()::text
);

-- ── board-images: legacy, no writer ──────────────────────────────────────────
-- Zero references anywhere in the application (grep across boards/src,
-- boards/party and supabase/functions finds only the migrations that created
-- it). Images moved to R2 long ago; the 15 objects here are historical. Nothing
-- writes to it, so it gets no write policy at all — an insert now fails for
-- everyone but service_role.
--
-- The 0165 read policy is intentionally left in place so any surviving old
-- reference keeps resolving.
drop policy if exists "board-images write" on storage.objects;
drop policy if exists "board-images authed write" on storage.objects;

-- ── Size + type limits ───────────────────────────────────────────────────────
-- application/octet-stream is what makes "attach any file" keep working: the
-- client remaps every non-inline-safe type to it, and a browser downloads it
-- rather than rendering it. text/html, application/xhtml+xml and image/svg+xml
-- are absent on purpose — those are the three that turn a public bucket into a
-- hosting surface on the auth origin.
update storage.buckets
   set file_size_limit = 52428800,  -- 50 MB
       allowed_mime_types = array[
         'image/png','image/jpeg','image/gif','image/webp','image/avif',
         'application/pdf',
         'video/mp4','video/webm','video/quicktime',
         'audio/mpeg','audio/mp4','audio/wav','audio/webm','audio/ogg',
         'text/plain',
         'application/octet-stream'
       ]
 where id = 'message-attachments';

-- board-images takes images only. Nothing can write to it now anyway (no
-- policy above), so this is purely belt-and-braces for a future writer.
update storage.buckets
   set file_size_limit = 52428800,  -- 50 MB
       allowed_mime_types = array[
         'image/png','image/jpeg','image/gif','image/webp','image/avif'
       ]
 where id = 'board-images';
