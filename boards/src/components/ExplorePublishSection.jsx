// ExplorePublishSection — self-serve "Publish to Explore" control inside the
// ShareModal. A board owner submits their board to the public /c/ + /explore SEO
// surface; it sits in an admin approve-queue (invisible publicly) until reviewed.
// The user just adds an optional title/description; the admin polishes SEO copy
// during review. Shows live status (pending / live / not approved) on return.

import { useEffect, useState } from 'react';
import { submitBoardToExplore, getMyExploreSubmission } from '../lib/boardsApi.js';
import { useFeedback } from './AppFeedback.jsx';

export function ExplorePublishSection({ board, canManage }) {
  const feedback = useFeedback();
  const [sub, setSub] = useState(undefined);   // undefined=loading, null=never, obj=status
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!canManage || !board?.id) { setSub(null); return; }
    let cancelled = false;
    getMyExploreSubmission(board.id)
      .then((s) => { if (!cancelled) setSub(s || null); })
      .catch(() => { if (!cancelled) setSub(null); });
    return () => { cancelled = true; };
  }, [board?.id, canManage]);

  if (!canManage) return null;

  const status = sub?.review_status;
  const isLive = !!sub?.published_at;
  const slug = sub?.slug;

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await submitBoardToExplore({
        boardId: board.id,
        title: title.trim() || board?.name || null,
        description: desc.trim() || null,
      });
      if (res?.status === 'already_published') {
        feedback.toast({ type: 'info', message: 'This board is already live on Explore.' });
      } else {
        feedback.toast({ type: 'success', message: 'Submitted to Explore — we’ll review it shortly.' });
      }
      setOpen(false);
      try { setSub(await getMyExploreSubmission(board.id)); } catch (_) {}
    } catch (e) {
      const msg = e?.message || String(e);
      feedback.toast({ type: 'error', message: /3 images/.test(msg) ? 'Add at least 3 images before publishing to Explore.' : ('Could not submit: ' + msg) });
    } finally {
      setBusy(false);
    }
  };

  const ghostBtn = { background: 'transparent', border: '1px solid var(--line-1, rgba(255,255,255,.16))', color: 'inherit', borderRadius: 8, padding: '7px 12px', cursor: 'pointer' };

  return (
    <div className="share-section">
      <div className="share-eyebrow">PUBLISH TO EXPLORE</div>

      {isLive ? (
        <p className="share-hint">
          ✓ This board is live on Explore.{' '}
          {slug && <a href={`/c/${slug}`} target="_blank" rel="noopener noreferrer">View public page →</a>}
        </p>
      ) : status === 'pending' ? (
        <p className="share-hint">⏳ Submitted — pending review. We’ll publish it to Explore once approved.</p>
      ) : status === 'rejected' ? (
        <>
          <p className="share-hint">This board wasn’t approved for Explore{sub?.review_reason ? `: ${sub.review_reason}` : '.'}</p>
          {!open && <button type="button" style={ghostBtn} onClick={() => setOpen(true)}>Resubmit</button>}
        </>
      ) : !open ? (
        <>
          <p className="share-hint" style={{ marginBottom: 8 }}>
            Make this board public &amp; discoverable on Google. It’s reviewed before going live.
          </p>
          <button type="button" className="share-invite-btn" onClick={() => setOpen(true)}>
            Publish to Explore…
          </button>
        </>
      ) : null}

      {open && !isLive && status !== 'pending' && (
        <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
          <input
            className="share-input"
            placeholder={board?.name || 'Public title'}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={80}
          />
          <textarea
            className="share-input"
            placeholder="One-line description (optional)"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            rows={2}
            maxLength={300}
            style={{ resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="share-invite-btn" disabled={busy} onClick={submit}>
              {busy ? 'Submitting…' : 'Submit for review'}
            </button>
            <button type="button" style={ghostBtn} disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
          </div>
          <p className="share-hint" style={{ marginTop: 0 }}>Needs at least 3 images. An admin reviews before it goes live.</p>
        </div>
      )}
    </div>
  );
}
