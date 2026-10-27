import { useId } from 'react';
import { useEditorState } from '@tiptap/react';
import { Icon } from '../Icon.jsx';
import { ELEMENTS, ELEMENT_LABELS } from '../docExtensions/screenplay/screenplayFlow.js';
import { safeRun } from '../../lib/safeEditorCmd.js';
import { Check, Columns2 } from '../../lib/icons.js';

// The side panel's Elements, for a screenplay (the owner's pick of 2026-10-21,
// mockup dx AC-script): the eight elements, the one the caret's line is
// checked, a click (or ↑ ↓ and Enter) making the line that, as the bar's
// element menu does; Tab and Enter in the text still step them
// (ScreenplayKeymap). Then the script's own: its title page, its scene
// numbers, and dual dialogue for the speech at the caret.

const SPEECH = new Set(['character', 'parenthetical', 'dialogue']);
const NONE = { el: '', dual: false };

export function DocElementsTab({
  editor = null, titlePage = false, onToggleTitlePage, sceneNumbers = false, onSetSceneNumbers,
}) {
  const headId = useId();
  const lit = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      if (!ed || ed.isDestroyed || !ed.isActive('screenplayBlock')) return NONE;
      const a = ed.getAttributes('screenplayBlock') || {};
      return { el: a.element || 'action', dual: !!a.dual };
    },
    equalityFn: (a, b) => a?.el === b?.el && a?.dual === b?.dual,
  }) || NONE;

  // The caret stays in the text: the element is set there and the text keeps
  // the focus, as the bar's menu leaves it.
  const set = (el) => {
    if (!editor || editor.isDestroyed) return;
    safeRun(editor.chain().focus().setScreenplayElement(el), 'doc:screenplay-element');
  };
  const pair = () => {
    if (!editor || editor.isDestroyed) return;
    safeRun(editor.chain().focus().toggleDualDialogue(), 'doc:dual-dialogue');
  };

  // ↑ ↓ Home End between the elements, Enter or Space sets the one there
  // (the list's choice stays the caret's until then).
  const onKeyDown = (e) => {
    const at = ELEMENTS.indexOf(e.target.closest?.('[data-el]')?.dataset.el);
    if (at < 0) return;
    const to = e.key === 'ArrowDown' ? Math.min(at + 1, ELEMENTS.length - 1)
      : e.key === 'ArrowUp' ? Math.max(at - 1, 0)
        : e.key === 'Home' ? 0 : e.key === 'End' ? ELEMENTS.length - 1 : null;
    if (to != null) {
      e.preventDefault();
      e.currentTarget.querySelector(`[data-el="${ELEMENTS[to]}"]`)?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      set(ELEMENTS[at]);
    }
  };
  const tabStop = lit.el || ELEMENTS[0];

  return (
    <div className="dl-els">
      <h3 className="dl-ish" id={headId}>Element</h3>
      <div className="dl-els-list" role="listbox" aria-labelledby={headId} onKeyDown={onKeyDown}>
        {ELEMENTS.map((el) => (
          <div key={el} role="option" data-el={el} className={`dl-el${lit.el === el ? ' is-on' : ''}`}
               aria-selected={lit.el === el} aria-disabled={!lit.el || undefined}
               tabIndex={el === tabStop ? 0 : -1}
               onMouseDown={(e) => e.preventDefault()}
               onClick={() => set(el)}>
            <span className="dl-el-t">{ELEMENT_LABELS[el] || el}</span>
            {lit.el === el && <Icon as={Check} size={14} className="dl-el-chk" />}
          </div>
        ))}
      </div>
      <p className="dl-note">Tab steps through these. Enter picks the one that usually comes next.</p>
      <h3 className="dl-ish">Script</h3>
      <button type="button" role="switch" className="dl-drow dl-sw" aria-checked={!!titlePage}
              onMouseDown={(e) => e.preventDefault()} onClick={() => onToggleTitlePage?.()}>
        <span>Title page</span><span className="dl-tog" aria-hidden="true" />
      </button>
      <button type="button" role="switch" className="dl-drow dl-sw" aria-checked={!!sceneNumbers}
              onMouseDown={(e) => e.preventDefault()} onClick={() => onSetSceneNumbers?.(!sceneNumbers)}>
        <span>Scene numbers</span><span className="dl-tog" aria-hidden="true" />
      </button>
      <div className="dl-drow dl-drow-pair">
        <span>Dual dialogue</span>
        <button type="button" className="dl-mini" aria-pressed={lit.dual} disabled={!SPEECH.has(lit.el)}
                onMouseDown={(e) => e.preventDefault()} onClick={pair}>
          <Icon as={Columns2} size={13} />Pair with the speech above
        </button>
      </div>
    </div>
  );
}
