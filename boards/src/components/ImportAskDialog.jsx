import { useRef } from 'react';
import { Modal } from './Modal.jsx';
import './importAsk.css';

// The question asked before a bulk import moves anything: how much fits, what
// waits, and the choices (the owner's pick A, 2026-10-19). Every word comes
// from lib/importCopy.js askCopy(); this file only draws it and reports the
// choice ('cancel' | 'fit' | 'all'). Gold is on the paid step and on focus only.

export function ImportAskDialog({ model, onChoose }) {
  const primaryRef = useRef(null);
  const focusId = model.actions.some((a) => a.id === 'all') ? 'all' : 'fit';
  return (
    <Modal open onClose={() => onChoose('cancel')} className="impask" backdropClassName="impask-back"
           labelledBy="impask-title" initialFocusRef={primaryRef}>
      <div className="impask-head">
        <div className="impask-kicker">{model.kicker}</div>
        <div className="impask-title" id="impask-title">{model.title}</div>
        <div className="impask-sub">{model.sub}</div>
      </div>
      <div className="impask-body">
        <div className="impask-fit">
          <div className="impask-bar" aria-hidden="true"><span style={{ width: `${model.pct}%`, minWidth: model.pct > 0 ? 3 : 0 }} /></div>
          <div className="impask-legend">
            <span><b>{model.fit.n}</b> {model.fit.text}</span>
            <span><b>{model.wait.n}</b> {model.wait.text}</span>
          </div>
        </div>
        {model.lede && <p className="impask-lede">{model.lede}</p>}
        {model.offer && (
          <div className="impask-offer">
            <span className="impask-offer-name">{model.offer.name}</span>
            <span className="impask-offer-text">{model.offer.text}</span>
          </div>
        )}
        <p className="impask-note">{model.note}</p>
      </div>
      <div className="impask-actions">
        {model.actions.map((a) => (
          <button key={a.id} type="button" ref={a.id === focusId ? primaryRef : undefined}
                  className={'impask-btn' + (a.tone === 'primary' ? ' is-primary' : a.tone === 'default' ? ' is-default' : '')}
                  onClick={() => onChoose(a.id)}>
            {a.label}
          </button>
        ))}
      </div>
    </Modal>
  );
}
