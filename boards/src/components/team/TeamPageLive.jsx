// TeamPageLive — the Team page on a real team: useTeam(orgId) loads it and
// answers its clicks (hooks/useTeam.js), TeamPage draws it. The sample team
// (Settings › Preview) renders TeamPage directly and never comes through here.
import { useEffect } from 'react';
import './team.css';
import TeamPage from './TeamPage.jsx';
import { useTeam } from '../../hooks/useTeam.js';

export default function TeamPageLive({ orgId, onToast, onClose, initialTab }) {
  const { team, loading, error, act, reload } = useTeam(orgId);

  useEffect(() => {
    if (team) return undefined;
    const key = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [team, onClose]);

  if (team) {
    return <TeamPage team={team} live={{ act, reload }} initialTab={initialTab} onToast={onToast} onClose={onClose} />;
  }
  return (
    <div className="tp-ground" data-team-page>
      <section className="tp-sheet" aria-label="Team">
        <div className="tp-body" role="status">
          {loading && !error ? (
            <p className="tp-card-t">Loading the team…</p>
          ) : (
            <>
              <p className="tp-card-t">The team couldn’t be loaded. Try again in a moment.</p>
              <div className="tp-card-acts">
                <button type="button" className="tp-btn tp-btn-sm" onClick={() => onClose?.()}>Close</button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
