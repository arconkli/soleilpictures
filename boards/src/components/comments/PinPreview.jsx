import { useSyncExternalStore } from 'react';
import { threadSummaryLine } from '../../lib/commentTime.js';
import { commentTimeWords } from '../../lib/commentTime.js';
import { subscribeMinute, minuteNow } from '../../lib/minuteTick.js';
import { CommentFace } from './CommentFace.jsx';
import './commentsLook.css';
import './canvasComments.css';
import { shownAuthor } from '../../lib/commentAuthor.js';
import { t as tr } from '@lingui/core/macro';

// The look-ahead: who started it, when, how it begins, and how it has gone.
export function PinPreview({ thread, style }) {
  const now = useSyncExternalStore(subscribeMinute, minuteNow, minuteNow);
  const root = thread.root;
  const live = (thread.replies || []).filter((r) => !r.deleted);
  const faces = [];
  for (const r of live) {
    if (faces.length >= 3) break;
    if (!faces.some((f) => (f.authorId || f.authorName) === (r.authorId || r.authorName))) faces.push(r);
  }
  return (
    <div className="cmt-pv" style={style} role="presentation">
      <div className="cmt-pv-top">
        <CommentFace name={shownAuthor(root.authorName)} userId={root.authorId} color={root.authorColor} size={20} />
        <span className="cmt-pv-who">{shownAuthor(root.authorName)}</span>
        {root.createdAt != null && <span className="cmt-pv-when">{commentTimeWords(root.createdAt, now)}</span>}
      </div>
      <div className="cmt-pv-text">{root.deleted ? tr`This comment was deleted.` : root.body}</div>
      <div className="cmt-pv-foot">
        {faces.length > 0 && (
          <span className="cmt-pv-faces">
            {faces.map((r) => <CommentFace key={r.id} name={shownAuthor(r.authorName)} userId={r.authorId} color={r.authorColor} size={18} />)}
          </span>
        )}
        <span>{threadSummaryLine(thread, now)}</span>
      </div>
    </div>
  );
}
