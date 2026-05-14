-- 0054_find_orphan_images_rpc.sql
CREATE OR REPLACE FUNCTION find_orphan_images(p_limit integer DEFAULT 500)
RETURNS TABLE (id uuid, storage_path text)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT i.id, i.storage_path
  FROM images i
  LEFT JOIN card_index ci
    ON ci.board_id = i.board_id AND ci.card_id = i.card_id
  WHERE i.created_at < (now() - interval '30 days')
    AND (
      i.card_id IS NULL
      OR ci.card_id IS NULL
    )
  ORDER BY i.created_at ASC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION find_orphan_images(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION find_orphan_images(integer) TO service_role;

CREATE OR REPLACE FUNCTION delete_image_rows(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  DELETE FROM images WHERE id = ANY(p_ids);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_image_rows(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_image_rows(uuid[]) TO service_role;
