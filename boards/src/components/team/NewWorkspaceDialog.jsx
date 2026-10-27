// NewWorkspaceDialog — "New workspace" for someone who holds a team seat: the
// name, then who it is for (the team, or just them) and, for a team's owner or
// admins, whether it is private. Wears the app's feedback dialog frame.
// App.addNewWorkspace opens it only when teamsAllowed() and a seat is held;
// everyone else keeps the plain name prompt.
import { useEffect, useRef, useState } from 'react';
import { X } from '@phosphor-icons/react';
import { Icon } from '../Icon.jsx';
import { registerModalOpen } from '../../lib/modalGuard.js';
import './newWorkspaceDialog.css';

export default function NewWorkspaceDialog({ team, userName, defaultFor = 'team', onCancel, onCreate }) {
  const [name, setName] = useState('');
  const [forTeam, setForTeam] = useState(defaultFor !== 'me');
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  useEffect(() => registerModalOpen(), []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onCancel]);

  const teamLetter = (team.letter || team.name || '?').trim().charAt(0).toUpperCase() || '?';
  const myLetter = (userName || 'Y').trim().charAt(0).toUpperCase() || 'Y';
  const canPrivate = forTeam && (team.role === 'owner' || team.role === 'admin');
  const trimmed = name.trim();

  const pick = (toTeam) => {
    setForTeam(toTeam);
    if (!toTeam) setIsPrivate(false);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!trimmed || busy) return;
    setBusy(true);
    setError('');
    let res = null;
    try { res = await onCreate({ name: trimmed, forTeam, isPrivate: canPrivate && isPrivate }); } catch (_) { res = null; }
    if (!aliveRef.current) return;
    if (res && res.ok) return;
    setBusy(false);
    setError((res && res.line) || 'That didn’t work. Try again.');
  };

  const radio = (on, toTeam, avatar, title, sub) => (
    <button type="button" role="radio" aria-checked={on} className="nwd-radio"
            onClick={() => pick(toTeam)}>
      {avatar}
      <span className="nwd-text"><b>{title}</b><span className="nwd-sub">{sub}</span></span>
    </button>
  );

  return (
    <div className="feedback-bg" onPointerDown={() => onCancel?.()}>
      <form className="feedback-dialog nwd" role="dialog" aria-modal="true" aria-label="New workspace"
            onSubmit={submit} onPointerDown={(e) => e.stopPropagation()}>
        <div className="feedback-hd">
          <div className="feedback-title">New workspace</div>
          <button type="button" className="modal-x" aria-label="Close" onClick={() => onCancel?.()}><Icon as={X} size={16} /></button>
        </div>
        <label className="feedback-field">
          <span>Name</span>
          <input autoFocus value={name} maxLength={60} placeholder="e.g. Trailers"
                 onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="nwd-label" id="nwd-for">Who is it for?</div>
        <div className="nwd-radios" role="radiogroup" aria-label="Who is it for">
          {radio(forTeam, true,
            <span className="nwd-av" style={team.color ? { background: team.color } : undefined} aria-hidden="true">{teamLetter}</span>,
            team.name, 'Everyone on the team can open it. It uses the team’s seats and storage.')}
          {radio(!forTeam, false,
            <span className="nwd-av nwd-av-me" aria-hidden="true">{myLetter}</span>,
            'Just me', 'Personal. The team never sees it, and it’s on your own plan.')}
        </div>
        {canPrivate && (
          <div className="nwd-private">
            <span className="nwd-text"><b>Private</b><span className="nwd-sub">Only the people you add, plus the team’s owner and admins.</span></span>
            <button type="button" role="switch" aria-checked={isPrivate} aria-label="Private"
                    className="nwd-switch" onClick={() => setIsPrivate((v) => !v)} />
          </div>
        )}
        {error && <div className="nwd-error" role="alert">{error}</div>}
        <div className="feedback-actions">
          <button type="button" className="btn-secondary" onClick={() => onCancel?.()}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={!trimmed || busy}>{busy ? 'Creating…' : 'Create workspace'}</button>
        </div>
      </form>
    </div>
  );
}
