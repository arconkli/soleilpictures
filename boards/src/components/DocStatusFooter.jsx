// Footer below the editor — live word/character count + an HONEST save status
// (hooks/useDocStatus.js, which the doc look's footer reads too).

import { useDocStatus } from '../hooks/useDocStatus.js';

// showSave false: the counts only (a guest in a shared doc has no save of
// their own to report: its cluster saves it).
export function DocStatusFooter({ editor, boardId = null, showSave = true }) {
  const { words, chars, online, saving, saveError, savedLabel } = useDocStatus({ editor, boardId });
  return (
    <div className="doc-foot">
      {showSave && <span className={`doc-foot-status ${saving ? 'is-saving' : ''} ${!online ? 'is-offline' : ''} ${saveError ? 'is-error' : ''}`}>{savedLabel}</span>}
      <span className="doc-foot-spacer" />
      <span className="doc-foot-counts">
        {words} {words === 1 ? 'word' : 'words'} · {chars} {chars === 1 ? 'char' : 'chars'}
      </span>
    </div>
  );
}
