// ExplorePublishSection — self-serve "Publish to Explore" control inside the
// ShareModal. A board owner submits their board to the public /c/ + /explore SEO
// surface; it sits in an admin approve-queue (invisible publicly) until reviewed.
// The user just adds an optional title/description; the admin polishes SEO copy
// during review. Shows live status (pending / live / not approved) on return,
// and lets the owner take a live cluster down or withdraw a pending one.

import { useEffect, useState } from 'react';
import { submitBoardToExplore, getMyExploreSubmission } from '../lib/boardsApi.js';
import { supabase } from '../lib/supabase.js';
import { useFeedback } from './AppFeedback.jsx';
import { t, ph } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { shownError } from '../lib/errorWords.js';

export function ExplorePublishSection({ board, canManage, collapsible = false }) {
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
        feedback.toast({ type: 'info', message: t`This cluster is already live on Explore.` });
      } else {
        feedback.toast({ type: 'success', message: t`Submitted to Explore — we’ll review it shortly.` });
      }
      setOpen(false);
      try { setSub(await getMyExploreSubmission(board.id)); } catch (_) {}
    } catch (e) {
      const msg = e?.message || String(e);
      feedback.toast({ type: 'error', code: 'explore_submit_failed', message: /3 images/.test(msg) ? t`Add at least 3 images before publishing to Explore.` : t`Could not submit: ${ph({ reason: msg })}` });
    } finally {
      setBusy(false);
    }
  };

  // Take a live cluster off Explore, or withdraw a submission still waiting
  // for review (unpublish_my_board, 0406 — same gate as submitting). The row
  // goes back to "never submitted", so the Publish flow below works again.
  const takeDown = async () => {
    if (busy) return;
    const live = isLive;
    const ok = await feedback.confirm({
      title: live ? t`Remove from Explore?` : t`Withdraw submission?`,
      message: live
        ? t`The public page comes down and the cluster leaves the Explore directory right away. You can submit it again later; it goes back through review.`
        : t`The submission is cancelled before review. You can submit it again later.`,
      confirmLabel: live ? t`Remove from Explore` : t`Withdraw`,
      danger: live,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('unpublish_my_board', { p_board_id: board.id });
      if (error) throw error;
      const s = data?.status;
      feedback.toast({
        type: s === 'not_listed' ? 'info' : 'success',
        message: s === 'unpublished' ? t`Removed from Explore.`
          : s === 'withdrawn' ? t`Submission withdrawn.`
          : t`This cluster isn’t on Explore.`,
      });
    } catch (e) {
      feedback.toast({ type: 'error', code: 'explore_update_failed', message: t`Could not update Explore: ${ph({ reason: shownError(e) })}` });
    } finally {
      // Re-read either way: on failure the state may have moved under us.
      try { setSub((await getMyExploreSubmission(board.id)) || null); } catch (_) {}
      setBusy(false);
    }
  };

  const ghostBtn = { background: 'transparent', border: '1px solid var(--line-1, rgba(255,255,255,.16))', color: 'inherit', borderRadius: 8, padding: '7px 12px', cursor: 'pointer' };

  // Publishing is a rare, reviewed step, so inside the share
  // panel it collapses — but the STATUS travels into the summary, because the
  // reason to reopen this section is almost always to check on a submission,
  // and a disclosure that hides its own status just gets opened every time.
  const statusChip = isLive ? t`✓ Live`
    : status === 'pending' ? t`Pending review`
    : status === 'rejected' ? t`Not approved`
    : null;

  const body = (
    <>
      {isLive ? (
        <>
          <p className="share-hint">
            <Trans>✓ This cluster is live on Explore.</Trans>{' '}
            {slug && <a href={`/c/${slug}`} target="_blank" rel="noopener noreferrer"><Trans>View public page →</Trans></a>}
          </p>
          <button type="button" style={ghostBtn} disabled={busy} onClick={takeDown}>
            {busy ? t`Removing…` : t`Remove from Explore`}
          </button>
        </>
      ) : status === 'pending' ? (
        <>
          <p className="share-hint"><Trans>Submitted — pending review. We’ll publish it to Explore once approved.</Trans></p>
          <button type="button" style={ghostBtn} disabled={busy} onClick={takeDown}>
            {busy ? t`Withdrawing…` : t`Withdraw submission`}
          </button>
        </>
      ) : status === 'rejected' ? (
        <>
          <p className="share-hint"><Trans>This cluster wasn’t approved for Explore{ph({ value: sub?.review_reason ? `: ${sub.review_reason}` : '.' })}</Trans></p>
          {!open && <button type="button" style={ghostBtn} onClick={() => setOpen(true)}><Trans>Resubmit</Trans></button>}
        </>
      ) : !open ? (
        <>
          <p className="share-hint" style={{ marginBottom: 8 }}>
            <Trans>Make this board public &amp; discoverable on Google. It’s reviewed before going live.</Trans>
          </p>
          <button type="button" className="share-invite-btn" onClick={() => setOpen(true)}>
            <Trans>Publish to Explore…</Trans>
          </button>
        </>
      ) : null}

      {open && !isLive && status !== 'pending' && (
        <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
          <input
            className="share-input"
            dir="auto"
            placeholder={board?.name || t`Public title`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={80}
          />
          <textarea
            className="share-input"
            dir="auto"
            placeholder={t`One-line description (optional)`}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            rows={2}
            maxLength={300}
            style={{ resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="share-invite-btn" disabled={busy} onClick={submit}>
              {busy ? t`Submitting…` : t`Submit for review`}
            </button>
            <button type="button" style={ghostBtn} disabled={busy} onClick={() => setOpen(false)}><Trans>Cancel</Trans></button>
          </div>
          <p className="share-hint" style={{ marginTop: 0 }}><Trans>Needs at least 3 images. An admin reviews before it goes live.</Trans></p>
        </div>
      )}
    </>
  );

  if (!collapsible) {
    return (
      <div className="share-section">
        <h3 className="share-section-title"><Trans>Publish to Explore</Trans></h3>
        {body}
      </div>
    );
  }

  return (
    <details className="share-section share-advanced">
      <summary>
        <span className="share-section-title"><Trans>Publish to Explore</Trans></span>
        {statusChip && <span className="share-advanced-status">{statusChip}</span>}
      </summary>
      {body}
    </details>
  );
}
