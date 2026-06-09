-- 0131b — restore least-privilege on set_image_variant.
--
-- The DROP+CREATE in 0131 re-acquired an anon EXECUTE grant via Supabase's
-- ALTER DEFAULT PRIVILEGES auto-grant. set_image_variant is a workspace-writer
-- mutation (it self-guards with can_write_*, but anon should not hold it), so we
-- revoke anon to match the pre-0131 posture.
--
-- NOTE: applied to prod via the Supabase MCP; this file is the committed record.

REVOKE EXECUTE ON FUNCTION public.set_image_variant(text,text,text,integer,integer,text,integer,integer) FROM anon;
