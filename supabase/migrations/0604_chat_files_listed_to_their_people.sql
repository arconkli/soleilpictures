-- 0604_chat_files_listed_to_their_people.sql
--
-- A chat attachment is visible through the storage API (list, select, signed
-- URLs) only to the person who uploaded it and to the people in a
-- conversation whose message carries it. It used to be visible to every member
-- of the workspace in the path.
--
-- The bucket stays public for now, so the app's existing attachment URLs keep
-- working while the app moves to short-lived signed URLs; the bucket becomes
-- private in the release after that. Uploads are unchanged ("msg-att write"):
-- the path is <workspace_id>/<uploader_id>/<uuid>.<ext>, and folder[2] is the
-- uploader, so an upload can always read itself back.

alter policy "msg-att read" on storage.objects using (
  bucket_id = 'message-attachments'
  and (
    (storage.foldername(name))[2] = (select auth.uid()::text)
    or exists (
      select 1 from public.messages m
       where m.attachments @> jsonb_build_array(jsonb_build_object('storage_path', storage.objects.name))
         and public.is_conversation_participant(m.conversation_id))
  )
);
