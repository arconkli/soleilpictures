// AdminExploreSubmissions — the moderation queue for self-serve "Publish to
// Explore" requests (migration 0169). Users submit their boards; they sit here
// (invisible publicly) until an admin approves (publishes to /c/ + /explore) or
// rejects. Renders only when there are pending submissions, so it stays out of
// the way otherwise. After approve, the existing SEO editor in the parent tab
// can still polish the page's copy.

import { useCallback, useEffect, useState } from 'react';
import { useFeedback } from '../../components/AppFeedback.jsx';
import { adminListPublicBoardSubmissions, adminReviewPublicBoard, pingIndexNow } from '../../lib/boardsApi.js';

export function AdminExploreSubmissions({ onReviewed }) {
  const feedback = useFeedback();
  const [rows, setRows] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    adminListPublicBoardSubmissions('pending')
      .then((r) => setRows(Array.isArray(r) ? r : []))
      .catch(() => setRows([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const review = async (row, approve) => {
    if (busyId) return;
    let reason = null;
    if (!approve) {
      reason = window.prompt('Reason for rejecting (optional — shown to the submitter):', '') ?? '';
    }
    setBusyId(row.board_id);
    try {
      const res = await adminReviewPublicBoard({ boardId: row.board_id, approve, reason });
      if (approve && res?.slug) { try { await pingIndexNow(res.slug); } catch (_) {} }
      feedback.toast({ type: 'success', message: approve ? `Published /c/${res?.slug}` : 'Submission rejected.' });
      setRows((rs) => rs.filter((r) => r.board_id !== row.board_id));
      try { onReviewed?.(); } catch (_) {}
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Review failed: ' + (e?.message || e) });
    } finally {
      setBusyId(null);
    }
  };

  if (!rows.length) return null;

  return (
    <div style={{ border: '1px solid var(--line-1, rgba(255,255,255,.14))', borderRadius: 12, padding: 14, marginBottom: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>
        Explore submissions — {rows.length} pending review
      </div>
      <div style={{ opacity: 0.7, fontSize: 13, marginBottom: 12 }}>
        User-submitted boards awaiting approval. Approving publishes them to /c/ + /explore.
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {rows.map((r) => (
          <div key={r.board_id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                 border: '1px solid var(--line-1, rgba(255,255,255,.1))', borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ flex: '1 1 260px', minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{r.seo_title || r.board_name || 'Untitled'}</div>
              <div style={{ opacity: 0.7, fontSize: 12 }}>
                /c/{r.slug} · {r.image_count} images · {r.card_count ?? '?'} cards · {r.submitter_email || 'unknown'}
                {r.submitted_at ? ` · ${new Date(r.submitted_at).toLocaleDateString()}` : ''}
              </div>
              {r.seo_description && <div style={{ opacity: 0.85, fontSize: 12, marginTop: 3 }}>{r.seo_description}</div>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" disabled={busyId === r.board_id}
                      onClick={() => review(r, true)}
                      style={{ background: 'var(--soleil, #ffa500)', color: '#111', border: 'none', borderRadius: 8, padding: '7px 14px', fontWeight: 600, cursor: 'pointer' }}>
                Approve
              </button>
              <button type="button" disabled={busyId === r.board_id}
                      onClick={() => review(r, false)}
                      style={{ background: 'transparent', color: 'inherit', border: '1px solid var(--line-1, rgba(255,255,255,.16))', borderRadius: 8, padding: '7px 14px', cursor: 'pointer' }}>
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
