// A viewer's wait, said in words: a neutral spinner and one line ("Opening
// <name>…"); after `slowAfterMs` a second line, "This is taking longer than
// usual", and the buttons given (Retry / Close). Quick look, the PDF viewer
// and the film player's opening state use it on their dark ground. The
// wrapper is a role="status" region before and after, so the change is read.
// `spinnerLabel` keeps a surface's own aria-label on the spinner (the PDF
// viewer's "Loading PDF").

import { Spinner } from './Spinner.jsx';
import { useSlow } from '../hooks/useSlow.js';
import './waitNote.css';

export function WaitNote({ label, slowAfterMs = 15000, onRetry = null, onClose = null, retryLabel = 'Retry', spinnerLabel = null, className = '' }) {
  const slow = useSlow(true, slowAfterMs);
  return (
    <div className={`wait-note ${className}`.trim()} role="status">
      <Spinner size={28} tone="on-dark" label={spinnerLabel || label} />
      <p className="wait-note-line">{label}</p>
      {slow && (
        <>
          <p className="wait-note-line wait-note-slow">This is taking longer than usual</p>
          {(onRetry || onClose) && (
            <div className="wait-note-btns">
              {onRetry && <button type="button" className="wait-note-btn" onClick={(e) => { e.stopPropagation(); onRetry(); }}>{retryLabel}</button>}
              {onClose && <button type="button" className="wait-note-btn" onClick={(e) => { e.stopPropagation(); onClose(); }}>Close</button>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
