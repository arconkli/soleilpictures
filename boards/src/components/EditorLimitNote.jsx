// EditorLimitNote — the note at the top of the share panel's invite area (the
// owner's pick B, 2026-10-21). lib/editorLimit.js editorLimitNote says what it
// reads; this draws it. Ink on the panel's raised ground: the limit is news,
// not an action, so nothing here is gold.
import { Users as UsersIcon, Check as CheckIcon } from '../lib/icons.js';
import { Icon as Glyph } from './Icon.jsx';

export function EditorLimitNote({ note, onSeeWho = null, onAsk = null, asking = false }) {
  if (!note) return null;
  const seeWhoButton = note.seeWho === 'button' && onSeeWho;
  const askButton = note.ask && onAsk;
  return (
    <div className="lim-note" role="status">
      <span className="lim-note-icon" aria-hidden="true"><Glyph as={UsersIcon} size={15} weight="regular" /></span>
      <div className="lim-note-text">
        <span className="lim-note-lead">{note.lead}</span> {note.body}
        {note.seeWho === 'link' && onSeeWho && (
          <> <button type="button" className="share-linkish" onClick={onSeeWho}>See who</button></>
        )}
        {(seeWhoButton || askButton) && (
          <div className="lim-note-acts">
            {seeWhoButton && (
              <button type="button" className="lim-btn" onClick={onSeeWho}>See who can edit</button>
            )}
            {askButton && (
              <button type="button" className="lim-btn" onClick={onAsk} disabled={asking}>
                {asking ? 'Asking…' : note.ask}
              </button>
            )}
          </div>
        )}
        {note.done && (
          <div className="lim-line lim-done">
            <Glyph as={CheckIcon} size={13} weight="regular" />{note.done}
          </div>
        )}
      </div>
    </div>
  );
}
