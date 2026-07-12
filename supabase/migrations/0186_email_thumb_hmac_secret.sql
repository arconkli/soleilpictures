-- 0186 — dedicated HMAC secret for /api/email-thumb, stored in app_config.
--
-- The original design derived the signing key from SUPABASE_SERVICE_ROLE_KEY
-- because both the soleil-boards Worker and the edge functions "hold it" — but
-- they hold DIFFERENT strings (the Worker was provisioned a different-format
-- Supabase key than the JWT the edge runtime injects; both authenticate fine,
-- so REST worked while every HMAC mismatched: x-miss=sig on all email thumbs).
--
-- Fix: a random dedicated secret in app_config. Both sides read this row with
-- their own service credentials, so the key material is identical by
-- construction and future credential rotations can't silently break the
-- images in already-sent email. app_config is admin-only RLS; the service
-- role bypasses it, anon cannot read it.
insert into public.app_config (key, value)
values ('email_thumb_hmac', jsonb_build_object('secret', encode(gen_random_bytes(32), 'hex')))
on conflict (key) do nothing;
