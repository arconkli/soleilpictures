-- 0095_feedback_image.sql
-- Optional screenshot attached via the in-app feedback widget. Stored as a
-- client-downscaled base64 data URL (JPEG, capped ~1200px) directly on the
-- feedback row. send-feedback inserts with the service role, so no RLS/grant
-- changes are needed.

alter table public.feedback
  add column if not exists image_data_url text;

comment on column public.feedback.image_data_url is
  'Optional base64 data URL (downscaled JPEG screenshot) attached via the in-app feedback widget.';
