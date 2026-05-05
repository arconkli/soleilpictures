import { Icon } from './Icon.jsx';
import { ChevronLeft, X } from '../lib/icons.js';

// Stub — Phase C builds the full thread + composer.
export function MessageThread({ thread, onBack, onClose }) {
  return (
    <div className="msg-panel">
      <div className="msg-panel-head">
        <button className="modal-close" onClick={onBack}><Icon as={ChevronLeft} size={16} /></button>
        <span className="t-eyebrow">{thread?.name || 'Thread'}</span>
        <button className="modal-close" onClick={onClose}><Icon as={X} size={16} /></button>
      </div>
      <div className="msg-panel-body">
        <div className="msg-empty t-meta">Thread coming in Phase C…</div>
      </div>
    </div>
  );
}
