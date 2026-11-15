// TeamPageLive — the Team page on a real team: useTeam(orgId) loads it and
// answers its clicks (hooks/useTeam.js), TeamPage draws it. The sample team
// (Settings › Preview) renders TeamPage directly and never comes through here.
import { useEffect } from 'react';
import './team.css';
import TeamPage from './TeamPage.jsx';
import { useTeam } from '../../hooks/useTeam.js';
import { isComposingKey } from '../../lib/composerKeys.js';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

export default function TeamPageLive({ orgId, onToast, onClose, initialTab }) {
  const { team, loading, error, act, reload } = useTeam(orgId);

  useEffect(() => {
    if (team) return undefined;
    const key = (e) => { if (isComposingKey(e)) return; if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [team, onClose]);

  if (team) {
    return <TeamPage team={team} live={{ act, reload }} initialTab={initialTab} onToast={onToast} onClose={onClose} />;
  }
  return (
    <div className="tp-ground" data-team-page>
      <section className="tp-sheet" aria-label={t`Team`}>
        <div className="tp-body" role="status">
          {loading && !error ? (
            <p className="tp-card-t"><Trans>Loading the team…</Trans></p>
          ) : (
            <>
              <p className="tp-card-t"><Trans>The team couldn’t be loaded. Try again in a moment.</Trans></p>
              <div className="tp-card-acts">
                <button type="button" className="tp-btn tp-btn-sm" onClick={() => onClose?.()}><Trans>Close</Trans></button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
