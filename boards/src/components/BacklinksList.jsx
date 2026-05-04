import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Renders "Referenced by" rows from the doc_backlinks table for one
// target entity. Caller specifies the target via props.
//   workspaceId
//   targetBoardId? targetCardId? targetDocCardId? targetUrl?
//   onOpenSource(row) — navigate to the source doc/page
export function BacklinksList({ workspaceId, targetBoardId, targetCardId, targetDocCardId, targetUrl, onOpenSource }) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    if (!supabase || !workspaceId) { setRows([]); return; }
    let cancelled = false;
    (async () => {
      let req = supabase.from('doc_backlinks').select('*').eq('target_workspace_id', workspaceId);
      if (targetBoardId)   req = req.eq('target_board_id', targetBoardId);
      if (targetCardId)    req = req.eq('target_card_id', targetCardId);
      if (targetDocCardId) req = req.eq('target_doc_card_id', targetDocCardId);
      if (targetUrl)       req = req.eq('target_url', targetUrl);
      const { data, error } = await req;
      if (!cancelled) setRows(error ? [] : (data || []));
    })();
    return () => { cancelled = true; };
  }, [workspaceId, targetBoardId, targetCardId, targetDocCardId, targetUrl]);

  if (rows.length === 0) {
    return <div className="backlinks-empty t-meta">No references yet.</div>;
  }
  return (
    <div className="backlinks-list">
      {rows.map(r => (
        <button key={r.id} className="backlinks-row" onClick={() => onOpenSource?.(r)}>
          <div className="backlinks-row-source t-eyebrow">SOURCE DOC</div>
          <div className="backlinks-row-text">{r.source_text || '(no preview)'}</div>
        </button>
      ))}
    </div>
  );
}
