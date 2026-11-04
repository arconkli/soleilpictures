// WorkspaceLimitDialog — "You have 10 workspaces": what New workspace opens at
// the limit (workspaceLimit.js) instead of the name box. Wears the app's
// feedback dialog frame, like NewWorkspaceDialog. Lazy; App.addNewWorkspace
// opens it from the count (via 'precheck') or from the server's refusal ('server').
import { useEffect } from 'react';
import { registerModalOpen } from '../lib/modalGuard.js';
import { logEvent, logEventNow } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { teamsAllowed } from '../lib/appHost.js';
import { limitBoxCopy } from '../lib/workspaceLimitCopy.js';

export default function WorkspaceLimitDialog({ n, surface = 'menu', via = 'precheck', onTeam = false, onClose }) {
  const c = limitBoxCopy(n, { teams: teamsAllowed(), onTeam });

  useEffect(() => registerModalOpen(), []);
  useEffect(() => {
    try { logEventNow(EV.WORKSPACE_LIMIT_SEEN, { surface, n, via }); } catch (_) {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const startTeam = () => {
    try { logEvent(EV.WORKSPACE_LIMIT_TEAM, { surface }); } catch (_) {}
    window.location.assign('/team/new');
  };

  return (
    <div className="feedback-bg" onPointerDown={() => onClose?.()}>
      <div className="feedback-dialog" role="dialog" aria-modal="true" aria-label={c.title}
           onPointerDown={(e) => e.stopPropagation()}>
        <div className="feedback-hd"><div className="feedback-title">{c.title}</div></div>
        <div className="feedback-message">{c.body}</div>
        <div className="feedback-actions">
          <button type="button" className={c.primary ? 'btn-secondary' : 'btn-primary'} autoFocus={!c.primary} onClick={() => onClose?.()}>{c.secondary}</button>
          {c.primary && <button type="button" className="btn-primary" autoFocus onClick={startTeam}>{c.primary}</button>}
        </div>
      </div>
    </div>
  );
}
