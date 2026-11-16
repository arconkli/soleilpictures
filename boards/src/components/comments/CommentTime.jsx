import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { subscribeMinute, minuteNow } from '../../lib/minuteTick.js';
import { commentTimeWords, commentFullDate } from '../../lib/commentTime.js';
import { CommentPop } from './CommentPop.jsx';
import './commentsLook.css';

const HOLD_MS = 450;

// When a comment was written: "now", "5m", "2h", "Yesterday", "12 Nov". Point
// at it, hold a finger on it, or Tab to it, for the whole date ("Sat 15 Nov,
// 07:58"); Esc puts the date away. Every time on screen shares one clock
// (lib/minuteTick.js), so the words keep up without a timer each.
//   at         epoch ms, a Date or an ISO string
//   midLine    the words follow others on a line ("· yesterday")
//   className  added to the <time>
export function CommentTime({ at, midLine = false, className = '' }) {
  const now = useSyncExternalStore(subscribeMinute, minuteNow, minuteNow);
  const ref = useRef(null);
  const hold = useRef(null);
  const tipId = useId();
  const [tip, setTip] = useState(false);
  useEffect(() => () => clearTimeout(hold.current), []);

  const ms = at == null || at === '' ? NaN : (typeof at === 'string' ? Date.parse(at) : +at);
  if (!Number.isFinite(ms)) return null;
  const endHold = () => { clearTimeout(hold.current); setTip(false); };
  return (
    <>
      <time
        ref={ref}
        className={`cmt-when${className ? ' ' + className : ''}`}
        dateTime={new Date(ms).toISOString()}
        tabIndex={0}
        aria-describedby={tip ? tipId : undefined}
        onMouseEnter={() => setTip(true)}
        onMouseLeave={() => setTip(false)}
        onFocus={() => setTip(true)}
        onBlur={() => setTip(false)}
        onKeyDown={(e) => {
          // Esc puts the date away first; the card only hears the next one
          if (e.key === 'Escape' && tip) { e.preventDefault(); e.stopPropagation(); setTip(false); }
        }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse') return;
          clearTimeout(hold.current);
          hold.current = setTimeout(() => setTip(true), HOLD_MS);
        }}
        onPointerUp={(e) => { if (e.pointerType !== 'mouse') { clearTimeout(hold.current); hold.current = setTimeout(() => setTip(false), 1600); } }}
        onPointerCancel={endHold}
        onContextMenu={(e) => { if (tip) e.preventDefault(); }}
      >
        {commentTimeWords(ms, Math.max(now, Date.now() - 60000), { midLine })}
      </time>
      {tip && (
        <CommentPop anchor={ref.current} place="above-start" gap={6} className="cmt-tip" role="tooltip" id={tipId}>{commentFullDate(ms)}</CommentPop>
      )}
    </>
  );
}
