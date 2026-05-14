-- 0052_schedule_retention_crons.sql
-- Enable pg_cron and schedule the three daily retention jobs.
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION prune_all_board_versions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total integer := 0;
  r record;
BEGIN
  FOR r IN SELECT id FROM boards LOOP
    v_total := v_total + COALESCE(prune_board_versions(r.id), 0);
  END LOOP;
  RETURN v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION prune_all_board_versions() TO authenticated;

SELECT cron.schedule('purge_deleted_boards',   '0 3 * * *',  $$SELECT purge_old_deleted_boards();$$);
SELECT cron.schedule('purge_deleted_comments', '5 3 * * *',  $$SELECT purge_old_deleted_comments();$$);
SELECT cron.schedule('prune_board_versions',   '10 3 * * *', $$SELECT prune_all_board_versions();$$);
