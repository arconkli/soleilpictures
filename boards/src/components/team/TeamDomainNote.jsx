// TeamDomainNote — the company-domain ask (Team S4 Task 7; the owner's pick B,
// a corner note, 2026-10-26). When a verified company domain's team asks
// before it admits someone (my_team_offers mode 'ask'), the first such offer
// comes up once per tab session until it's answered: Join, or No thanks.
// The team link card's corner card (.share-prompt), with the team's mark.
// Lazy: teamBoot.js mounts it in a root of its own, so App holds nothing for it.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './teamDomainNote.css';

export function TeamDomainNote({ offer, onAnswer }) {
  const [busy, setBusy] = useState(null);   // 'join' | 'no'
  const name = offer?.name || 'Your company’s team';
  const mark = (offer?.letter || name[0] || '?').toUpperCase();
  const answer = (join) => {
    if (busy) return;
    setBusy(join ? 'join' : 'no');
    onAnswer(join);
  };
  return (
    <div className="share-prompt tdn" role="dialog" aria-label={`Join ${name}?`}>
      <div className="share-prompt-eyebrow">Your company’s team</div>
      <div className="tdn-row">
        <span className="tdn-mark" style={offer?.color ? { background: offer.color, color: '#0a0a0c' } : undefined} aria-hidden="true">{mark}</span>
        <div className="share-prompt-title">{name} uses your company’s email</div>
      </div>
      <div className="share-prompt-sub">Join the team to see its workspaces. Your own workspaces stay yours, and private.</div>
      <button type="button" className="public-cta share-prompt-cta" disabled={!!busy} onClick={() => answer(true)}>
        {busy === 'join' ? 'Joining…' : `Join ${name}`}
      </button>
      <button type="button" className="share-prompt-later" disabled={!!busy} onClick={() => answer(false)}>No thanks</button>
    </div>
  );
}

// Shows the note for one offer. answer(join) sends the answer and returns the
// RPC's data; done(join, data) runs once the note is gone. A failed answer
// closes the note quietly, and the offer comes back next session.
export function showTeamDomainNote(offer, { answer, done }) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const close = () => { try { root.unmount(); } catch (_) {} host.remove(); };
  root.render(
    <TeamDomainNote
      offer={offer}
      onAnswer={async (join) => {
        let data = null;
        try { data = await answer(join); } catch (_) { data = null; }
        close();
        try { done?.(join, data); } catch (_) {}
      }}
    />,
  );
  return close;
}
