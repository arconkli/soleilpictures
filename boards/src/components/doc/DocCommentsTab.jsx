import { useEffect, useMemo, useState } from 'react';
import { useEditorState } from '@tiptap/react';
import { Caps } from '../toolbar/Toolbar.jsx';
import { pageContentMap, sheetContentMap, pagesArray } from '../../lib/docState.js';
import { commentAnchors } from '../../lib/docCommentAnchors.js';
import { CommentPartHost, DocThreadsPanelPart } from '../comments/commentPartHost.jsx';

// The side panel's Comments: every thread of the doc in the doc's order. The
// threads themselves are the shared comment parts (comments/DocThreadsPanel.jsx:
// short rows, the open one the whole conversation with its one gold bar,
// resolved ones folded away at the bottom), which arrive the first time the
// tab is shown; this file is what the doc knows that they don't: where each
// thread's words are, and which thread the caret is in.
//
// A card takes you to its words (DocSurface's onJump: the page opened, the
// words shown and lit); the caret in commented words picks their thread.
//
// A guest in a doc shared on its own (`guest`) replies, resolves and reopens
// in their own name, as anyone who can edit it does, but deletes only a
// thread they started: the doc's room refuses the rest (lib/docRoomBridge.js).
export function DocCommentsTab({
  ydoc, scope, threads = [], editor = null, currentUser = null, canEdit = true, guest = false,
  workspaceId = null, boardId = null, cardId = null,
  selectedId = null, onSelect, onJump, flashRowId = null, focusId = null, sheet = false,
}) {
  const anchors = useCommentAnchors(ydoc, scope);
  // The caret in an open thread's words picks it (a resolved one's words
  // read as plain text).
  const resolvedIds = useMemo(() => new Set(threads.filter((t) => t.resolved).map((t) => t.id)), [threads]);
  const atCaret = useEditorState({
    editor,
    selector: () => commentAtCaret(editor, resolvedIds),
  });
  useEffect(() => { if (atCaret) onSelect?.(atCaret); }, [atCaret]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="dl-cmts">
      <CommentPartHost
        part={DocThreadsPanelPart}
        ydoc={ydoc} scope={scope} entries={threads} anchors={anchors}
        currentUser={currentUser} canEdit={canEdit} guest={guest}
        workspaceId={workspaceId} boardId={boardId} cardId={cardId}
        selectedId={selectedId} onSelect={onSelect} onJump={onJump}
        flashRowId={flashRowId} focusId={focusId} sheet={sheet}
        shortcut={<Caps keys="Mod+Alt+M" />}
      />
    </div>
  );
}

// The open thread whose words the caret is in (or just before), or null.
function commentAtCaret(editor, resolved) {
  if (!editor || editor.isDestroyed) return null;
  try {
    const $p = editor.state.doc.resolve(editor.state.selection.from);
    const marks = [...$p.marks(), ...($p.nodeAfter?.marks || [])];
    return marks.find((m) => m.type.name === 'comment' && m.attrs.id && !resolved.has(m.attrs.id))?.attrs.id || null;
  } catch (_) { return null; }
}

// Where each thread sits (lib/docCommentAnchors.js), kept up to date as the
// doc changes, a few times a second at most while someone types.
function useCommentAnchors(ydoc, scope) {
  const [anchors, setAnchors] = useState(() => (ydoc ? commentAnchors(ydoc, scope) : new Map()));
  useEffect(() => {
    if (!ydoc) return undefined;
    const types = [pageContentMap(ydoc, scope), sheetContentMap(ydoc, scope), pagesArray(ydoc, scope)].filter(Boolean);
    let t = 0;
    const read = () => { t = 0; setAnchors(commentAnchors(ydoc, scope)); };
    const soon = () => { if (!t) t = setTimeout(read, 250); };
    read();
    types.forEach((y) => y.observeDeep(soon));
    return () => {
      clearTimeout(t);
      types.forEach((y) => y.unobserveDeep(soon));
    };
  }, [ydoc, scope]);
  return anchors;
}
