import { useLayoutEffect, useState } from 'react';
import { useEditorState } from '@tiptap/react';
import { Icon } from '../Icon.jsx';
import { useFeedback } from '../AppFeedback.jsx';
import { getDocMode, setTitlePage, switchDocMode, writeScriptIntoPage } from '../../lib/docState.js';
import { isEmptyScript, parseScriptText, scriptBody } from '../../lib/scriptImport.js';
import { Clapperboard, DownloadSimple } from '../../lib/icons.js';

// An empty doc's other ways in (the owner's pick of 2026-10-21, mockup
// S-open): under its "Start writing…", "Or start from" A screenplay and
// Import a script, until a word is written. It sits in the paper, under the
// first line where the editor draws it, and follows that line as the page
// reflows; a press takes no focus from the title or the text.
//
// Import a script reads the file as the bar's Import does (lib/scriptImport.js)
// and makes the doc that script: a screenplay, its one page the script's text
// (docState.writeScriptIntoPage), its title page on, and the doc named for it
// while it still has none (onRename, which the window offers only then).

const keep = (e) => e.preventDefault();

export function DocStarters({ editor, paperRef, ydoc, scope, pageId, onScreenplay, onRename }) {
  const feedback = useFeedback();
  const importScript = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.fountain,.txt,.fdx,application/xml,text/plain';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f || !ydoc || !scope) return;
      let parsed;
      try { parsed = parseScriptText(await f.text(), f.name); } catch (err) {
        console.error('[import] screenplay parse failed', err);
        feedback.toast({ type: 'error', message: 'Couldn’t read that file — it doesn’t look like Fountain or Final Draft.' });
        return;
      }
      if (isEmptyScript(parsed)) {
        feedback.toast({ type: 'error', message: 'Nothing importable found in that file.' });
        return;
      }
      if (getDocMode(ydoc, scope) !== 'screenplay') switchDocMode(ydoc, scope, 'screenplay');
      const body = scriptBody(parsed);
      if (body && pageId) writeScriptIntoPage(ydoc, scope, pageId, body);
      if (parsed.titlePage) setTitlePage(ydoc, scope, { enabled: true, ...parsed.titlePage });
      if (parsed.title) onRename?.(parsed.title);
    };
    input.click();
  };
  const empty = useEditorState({
    editor,
    selector: ({ editor: ed }) => !!ed && !ed.isDestroyed && ed.isEmpty,
  }) ?? false;
  const [at, setAt] = useState(null);
  useLayoutEffect(() => {
    const paper = paperRef?.current;
    if (!empty || !paper || !editor || editor.isDestroyed) { setAt(null); return undefined; }
    const place = () => {
      const line = editor.isDestroyed ? null : editor.view.dom.firstElementChild;
      if (!line) return;
      const a = paper.getBoundingClientRect();
      const b = line.getBoundingClientRect();
      const next = { top: Math.round(b.bottom - a.top + paper.scrollTop + 14), left: Math.round(b.left - a.left + paper.scrollLeft) };
      setAt((was) => (was && was.top === next.top && was.left === next.left ? was : next));
    };
    place();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    ro?.observe(paper);
    ro?.observe(editor.view.dom);
    return () => ro?.disconnect();
  }, [empty, editor, paperRef]);
  if (!empty || !at) return null;
  return (
    <div className="dl-starters" role="group" aria-label="Or start from" style={{ top: at.top, left: at.left }}>
      <span aria-hidden="true">Or start from</span>
      <button type="button" className="dl-starter" onMouseDown={keep} onClick={onScreenplay}>
        <Icon as={Clapperboard} size={16} />A screenplay
      </button>
      <button type="button" className="dl-starter" onMouseDown={keep} onClick={importScript}>
        <Icon as={DownloadSimple} size={16} />Import a script
      </button>
    </div>
  );
}
