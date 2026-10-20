import { useRef } from 'react';
import { Modal } from './Modal.jsx';
import { Icon } from './Icon.jsx';
import { FileZip } from '../lib/icons.js';
import './importAsk.css';

// The question asked when zips are added: unpack them into clusters, or keep
// each whole in Files (the owner's pick, 2026-10-19). Every word comes from
// lib/importCopy.js zipAskCopy(); this file only draws it and reports the
// choice ('cancel' | 'keep' | 'unpack'). Gold is on focus rings only.

export function ImportZipDialog({ model, onChoose }) {
  const primaryRef = useRef(null);
  return (
    <Modal open onClose={() => onChoose('cancel')} className="impask impzip" backdropClassName="impask-back"
           labelledBy="impzip-title" initialFocusRef={primaryRef}>
      <div className="impask-head">
        <div className="impask-kicker">{model.kicker}</div>
        <div className="impask-title" id="impzip-title">{model.title}</div>
        <div className="impask-sub">{model.sub}</div>
      </div>
      <div className="impask-body">
        <div className="impzip-list">
          {model.rows.map((r, i) => (
            <div className="impzip-row" key={i}>
              <Icon as={FileZip} size={16} weight="regular" />
              <span className="impzip-name">{r.name}</span>
              <span className="impzip-size">{r.size}</span>
            </div>
          ))}
          {model.more && <div className="impzip-more">{model.more}</div>}
        </div>
        <p className="impask-lede">{model.lede}</p>
        <p className="impask-note">{model.note}</p>
      </div>
      <div className="impask-actions">
        {model.actions.map((a) => (
          <button key={a.id} type="button" ref={a.id === 'unpack' ? primaryRef : undefined}
                  className={'impask-btn' + (a.tone === 'default' ? ' is-default' : '')}
                  onClick={() => onChoose(a.id)}>
            {a.label}
          </button>
        ))}
      </div>
    </Modal>
  );
}
