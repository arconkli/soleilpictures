import { ArrowClockwise } from '../lib/icons.js';
import './loadFailed.css';
import { Trans } from '@lingui/react/macro';

// "Couldn’t load <what>" + Retry: what a list says when its read failed, so a
// failure never reads as an empty answer (the Messages precedent, COMMS-15).
export function LoadFailed({ what, onRetry, compact = false, className = '' }) {
  return (
    <div className={`load-failed${compact ? ' is-compact' : ''}${className ? ` ${className}` : ''}`} role="alert">
      <span className="load-failed-say"><Trans>Couldn’t load {what}</Trans></span>
      {onRetry && (
        <button type="button" className="load-failed-btn" onClick={onRetry}>
          <ArrowClockwise size={13} aria-hidden="true" />
          <Trans>Retry</Trans>
        </button>
      )}
    </div>
  );
}

export default LoadFailed;
