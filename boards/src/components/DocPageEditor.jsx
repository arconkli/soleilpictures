// Tiptap editor for a single doc page. Binds to the Y.XmlFragment for that
// page via the Collaboration extension, so every keystroke flows through the
// per-board Y.Doc (and saves on the existing 250ms snapshot debounce).
//
// Single editor instance per (ydoc, pageId). When pageId changes the editor
// is rebuilt — Tiptap's Collaboration extension cannot re-bind to a different
// fragment on the same instance.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import Typography from '@tiptap/extension-typography';
import Placeholder from '@tiptap/extension-placeholder';
import Collaboration from '@tiptap/extension-collaboration';
import { v4 as uuid } from 'uuid';
import { getOrCreatePageContent, addBookmark, readPagesWithText } from '../lib/docState.js';
import { useAddCommentFlow } from './AddCommentFlow.jsx';
import { uploadImage } from '../lib/uploads.js';
import { migrateBookmarksToLinks, getLink, addLink, updateLinkTargets, listLinks } from '../lib/links.js';
import { updateBacklinks, syncDocPageIndex } from '../lib/boardsApi.js';
import { makeLinkRendererPlugin } from './docExtensions/LinkRenderer.js';
import { makeAutoDetectPlugin } from './docExtensions/AutoDetectPlugin.js';
import { baseDocExtensions } from './docExtensions/baseExtensions.js';
import { MentionExtension } from './docExtensions/MentionExtension.js';
import { makeSlashExtension } from './DocSlashMenu.jsx';
import { FindHighlightExtension } from './DocFindReplace.jsx';
// Block-handle extension removed — the docs feel less Notion-y / more
// flowing-document without the per-block drag-dots in the gutter.
// Keep the import sentinel so the file isn't accidentally re-added
// unless someone explicitly wants it back.
// import { BlockHandleExtension } from './DocBlockHandle.jsx';
import { useFeedback } from './AppFeedback.jsx';
import { LinkPopover } from './LinkPopover.jsx';
import { LinkHoverCard } from './LinkHoverCard.jsx';
import { EntityHoverPopover } from './EntityHoverPopover.jsx';
import { EntityBacklinksPanel } from './EntityBacklinksPanel.jsx';
import { useEntityNavigate } from '../hooks/useEntityNavigate.js';
import { recordToRef } from '../lib/scanForAutoLinks.js';
import { coerceRef } from '../lib/entityRef.js';
import { ENTITY_REF_MIME } from '../lib/dragMimes.js';
import { supabase } from '../lib/supabase.js';

function labelForRefKind(ref) {
  if (!ref) return 'link';
  switch (ref.kind) {
    case 'board':   return 'board';
    case 'card':    return 'card';
    case 'doc':     return 'doc';
    case 'docPos':  return 'doc anchor';
    case 'message': return 'message';
    case 'user':    return 'person';
    case 'url':     return ref.href || 'link';
    default:        return ref.kind;
  }
}
import { EntityPicker } from './EntityPicker.jsx';
import { createNameIndex } from '../lib/entityNameTrie.js';
import { useEntityNameTrie } from '../hooks/useEntityNameTrie.js';
import { CommentGutter } from './CommentGutter.jsx';
import { CommentInlinePopover } from './CommentInlinePopover.jsx';

// Comprehensive keyboard shortcuts beyond the StarterKit defaults. Mirrors
// what users expect from Google Docs / Notion.
const ExtraShortcuts = Extension.create({
  name: 'soleilDocShortcuts',
  addKeyboardShortcuts() {
    const headings = (level) => () => this.editor.chain().focus().toggleHeading({ level }).run();
    return {
      // Headings: ⌘⌥1..6
      'Mod-Alt-1': headings(1),
      'Mod-Alt-2': headings(2),
      'Mod-Alt-3': headings(3),
      'Mod-Alt-4': headings(4),
      'Mod-Alt-5': headings(5),
      'Mod-Alt-6': headings(6),
      'Mod-Alt-0': () => this.editor.chain().focus().setParagraph().run(),
      // Lists: ⌘⇧7 / ⌘⇧8 / ⌘⇧9 (Google Docs convention)
      'Mod-Shift-7': () => this.editor.chain().focus().toggleOrderedList().run(),
      'Mod-Shift-8': () => this.editor.chain().focus().toggleBulletList().run(),
      'Mod-Shift-9': () => this.editor.chain().focus().toggleTaskList().run(),
      // Strikethrough: ⌘⇧X
      'Mod-Shift-x': () => this.editor.chain().focus().toggleStrike().run(),
      // Blockquote: ⌘⇧.
      'Mod-Shift-.': () => this.editor.chain().focus().toggleBlockquote().run(),
      // Code: ⌘E (inline) — matches Notion
      'Mod-e': () => this.editor.chain().focus().toggleCode().run(),
      // Highlight: ⌘⇧H
      'Mod-Shift-h': () => this.editor.chain().focus().toggleHighlight({ color: '#fff7a8' }).run(),
      // Alignment: ⌘⇧L / E / R / J (Google Docs)
      'Mod-Shift-l': () => this.editor.chain().focus().setTextAlign('left').run(),
      'Mod-Shift-e': () => this.editor.chain().focus().setTextAlign('center').run(),
      'Mod-Shift-r': () => this.editor.chain().focus().setTextAlign('right').run(),
      'Mod-Shift-j': () => this.editor.chain().focus().setTextAlign('justify').run(),
      // Subscript/superscript: ⌘. / ⌘,
      'Mod-.': () => this.editor.chain().focus().toggleSuperscript().run(),
      'Mod-,': () => this.editor.chain().focus().toggleSubscript().run(),
      // Tab in lists: indent / outdent. Outside a list, fall back to a
      // 2-space tab so Tab still does something instead of yanking focus.
      Tab: () => {
        const ed = this.editor;
        if (ed.can().sinkListItem('listItem')) {
          return ed.chain().focus().sinkListItem('listItem').run();
        }
        if (ed.can().sinkListItem('taskItem')) {
          return ed.chain().focus().sinkListItem('taskItem').run();
        }
        return ed.chain().focus().insertContent('  ').run();
      },
      'Shift-Tab': () => {
        const ed = this.editor;
        if (ed.can().liftListItem('listItem')) {
          return ed.chain().focus().liftListItem('listItem').run();
        }
        if (ed.can().liftListItem('taskItem')) {
          return ed.chain().focus().liftListItem('taskItem').run();
        }
        return true;
      },
    };
  },
});

export function DocPageEditor({ ydoc, scope, pageId, onEditorReady, workspaceId, userId, activePageId, onRequestBoardEmbed, onRequestLink, onStartComment, awareness, onNavigateTarget, registerOpenLinkPicker, registerOpenAddComment, currentUser, boards, editable = true }) {
  const fragment = pageId ? getOrCreatePageContent(ydoc, pageId, scope) : null;
  // Held so editorProps drop/paste handlers (constructed at editor-init time,
  // before `editor` exists) can reach the live instance.
  const editorRef = useRef(null);
  const feedback = useFeedback();
  const [linkPicker, setLinkPicker] = useState(null);
  // linkPicker = { anchor, multi, initialSelected, existingLinkId? } | null
  const [mention, setMention] = useState(null);
  // mention = { range, query, clientRect } | null
  const [openThread, setOpenThread] = useState(null);
  // openThread = { id, anchor } | null

  const mentionExt = useMemo(() => MentionExtension({
    onStart: (props) => {
      setMention({ range: props.range, query: props.query, clientRect: props.clientRect?.() || null });
      return () => setMention(null);
    },
    onUpdate: (props) => {
      setMention({ range: props.range, query: props.query, clientRect: props.clientRect?.() || null });
    },
    onKeyDown: ({ event }) => {
      // Let arrows / enter pass through to the picker (which has its own
      // selection handling). Escape is handled by the picker too.
      return false;
    },
  }), []);

  // Workspace-wide entity name index for auto-detect decorations.
  // Pulled from entity_search + entity_aliases via the universal hook;
  // patches itself on entity create / rename / alias change in realtime.
  const { trie: workspaceTrie } = useEntityNameTrie(workspaceId);
  const nameIndexRef = useRef(createNameIndex());
  useEffect(() => { nameIndexRef.current = workspaceTrie; }, [workspaceTrie]);

  // Per-doc ignore set: terms the user has marked "don't auto-link
  // here" for this specific doc card. Populated from
  // entity_ignore_terms (scope='doc'), live-updated via realtime.
  // Workspace-wide ignores are baked into the trie itself.
  const docIgnoreRef = useRef(new Set());
  const docCardIdForIgnore = (scope && scope.docCardId) || null;
  useEffect(() => {
    if (!supabase || !workspaceId || !docCardIdForIgnore) {
      docIgnoreRef.current = new Set();
      return;
    }
    let cancelled = false;
    const reload = async () => {
      try {
        const { data } = await supabase.from('entity_ignore_terms')
          .select('term')
          .eq('workspace_id', workspaceId)
          .eq('scope', 'doc')
          .eq('scope_id', docCardIdForIgnore);
        if (cancelled) return;
        docIgnoreRef.current = new Set((data || []).map(r => (r.term || '').toLowerCase()));
      } catch (_) {}
    };
    reload();
    // Per-mount unique suffix — Supabase de-dupes channels by name,
    // so re-mounting reuses the already-subscribed channel and
    // `.on(...)` throws "after subscribe".
    const sfx = Math.random().toString(36).slice(2, 9);
    const ch = supabase.channel(`docignore:${docCardIdForIgnore}:${sfx}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'entity_ignore_terms', filter: `scope_id=eq.${docCardIdForIgnore}` }, reload)
      .subscribe();
    return () => {
      cancelled = true;
      try { supabase.removeChannel(ch); } catch (_) {}
    };
  }, [workspaceId, docCardIdForIgnore]);

  const openLinkPicker = useCallback((editor, opts = {}) => {
    if (!editor) return;
    const sel = editor.state.selection;
    if (sel.empty) return;
    // Look for an existing link mark inside the selection.
    let existingLinkId = null;
    let initialSelected = opts.initialSelected || [];
    if (!opts.initialSelected) {
      const $from = editor.state.doc.resolve(sel.from);
      const m = $from.marks().find(x => x.type.name === 'link');
      if (m?.attrs.linkId) {
        existingLinkId = m.attrs.linkId;
        const link = getLink(ydoc, existingLinkId);
        initialSelected = link?.targets || [];
      }
    }
    // Anchor the picker below the selection.
    const winSel = window.getSelection();
    const rect = winSel?.rangeCount
      ? winSel.getRangeAt(0).getBoundingClientRect()
      : { left: 100, top: 100, right: 200, bottom: 120 };
    setLinkPicker({ anchor: rect, multi: true, initialSelected, existingLinkId });
  }, [ydoc]);

  const commitLink = useCallback((targets) => {
    const editor = editorRef.current;
    if (!editor || !linkPicker) { setLinkPicker(null); return; }
    const sel = editor.state.selection;
    if (sel.empty) { setLinkPicker(null); return; }
    if (!targets || targets.length === 0) {
      // No targets picked → if updating an existing link, remove the mark.
      if (linkPicker.existingLinkId) {
        editor.chain().focus().unsetMark('link').run();
      }
      setLinkPicker(null);
      return;
    }
    const linkId = linkPicker.existingLinkId || uuid();
    if (linkPicker.existingLinkId) {
      updateLinkTargets(ydoc, linkId, targets);
    } else {
      addLink(ydoc, {
        id: linkId,
        pageId: activePageId,
        anchor: { from: sel.from, to: sel.to },
        targets,
        createdBy: userId || null,
      });
    }
    editor.chain().focus().setMark('link', { linkId }).run();
    setLinkPicker(null);
  }, [ydoc, linkPicker, activePageId, userId]);

  // Expose openLinkPicker to parent (DocSurface) via a ref-callback prop,
  // so the toolbar Link button can call it without requiring forwardRef.
  useEffect(() => {
    registerOpenLinkPicker?.(openLinkPicker);
    return () => registerOpenLinkPicker?.(null);
  }, [registerOpenLinkPicker, openLinkPicker]);

  // Inline comment-add flow — opens an InlineComposer next to the selection,
  // commits a tt-comment mark + thread record on Post.
  const addComment = useAddCommentFlow({
    ydoc,
    scope,
    activePageId,
    currentUser,
    getEditor: () => editorRef.current,
  });

  // Expose addComment.open to DocSurface so the toolbar button can invoke it.
  useEffect(() => {
    registerOpenAddComment?.(addComment.open);
    return () => registerOpenAddComment?.(null);
  }, [registerOpenAddComment, addComment.open]);

  const navigateRef = useEntityNavigate();

  // Drop an entity ref onto the doc → inserts the entity's name as
  // text + applies a manual link mark pointing at the ref. Used by
  // the cross-surface drag-to-link flow.
  const insertEntityLinkAt = (pos, ref) => {
    const editor = editorRef.current;
    if (!editor || !ref || !activePageId) return;
    const text = (ref.title || ref.name || labelForRefKind(ref)) + '';
    const linkId = uuid();
    try {
      addLink(ydoc, {
        id: linkId,
        pageId: activePageId,
        anchor: { from: pos, to: pos + text.length },
        targets: [ref],
        createdBy: userId || null,
      });
      editor.chain().focus()
        .insertContentAt(pos, text)
        .setTextSelection({ from: pos, to: pos + text.length })
        .setMark('link', { linkId })
        .setTextSelection({ from: pos + text.length, to: pos + text.length })
        .run();
    } catch (e) { console.warn('insertEntityLinkAt', e); }
  };

  // [{ ref, ... }] derived from a manual-link's Y.Doc record.
  // Each target lives on a single Link record; v1 always wraps as
  // canonical EntityRefs so the popover can render previews uniformly.
  const buildRefsFromManualLink = (linkId) => {
    if (!linkId) return null;
    const link = getLink(ydoc, linkId);
    if (!link) return null;
    return (link.targets || []).map(t => coerceRef(t)).filter(Boolean);
  };
  const buildRefsFromCandidate = (records) => {
    if (!Array.isArray(records)) return null;
    return records.map(recordToRef).filter(Boolean);
  };

  const handleEditorClick = (e) => {
    // Manual link spans (rendered with data-link-id by LinkRenderer).
    const manualEl = e.target.closest?.('[data-link-id]');
    if (manualEl) {
      const linkId = manualEl.dataset.linkId;
      const refs = buildRefsFromManualLink(linkId);
      e.preventDefault();
      setLinkHover(null);
      if (refs && refs.length === 1 && !(e.metaKey || e.ctrlKey)) {
        navigateRef(refs[0]);
      } else if (refs && refs.length) {
        setLinkHover({
          anchor: manualEl.getBoundingClientRect(),
          refs, term: manualEl.textContent || '',
        });
      }
      return;
    }
    // Auto-detect candidate spans (rendered by AutoDetectPlugin).
    const autoEl = e.target.closest?.('.tt-link-auto[data-records]');
    if (autoEl) {
      let records = [];
      try { records = JSON.parse(autoEl.dataset.records || '[]'); } catch {}
      const refs = buildRefsFromCandidate(records);
      e.preventDefault();
      setLinkHover({
        anchor: autoEl.getBoundingClientRect(),
        refs: refs || [],
        term: autoEl.textContent || '',
      });
      return;
    }
  };

  // Hover-preview state machine: 250ms enter delay, 200ms grace on leave so
  // the user can move the cursor INTO the popover without it disappearing.
  // De-duped by chip element — repeated mouseovers on the same chip
  // (which happen as the cursor crosses internal sub-spans created by
  // overlapping decorations) don't reset the open timer.
  const [linkHover, setLinkHover] = useState(null);
  const hoverTimers = useRef({ open: null, close: null });
  const lastChipRef = useRef(null);
  const cancelHoverTimers = () => {
    clearTimeout(hoverTimers.current.open);
    clearTimeout(hoverTimers.current.close);
    hoverTimers.current.open = null;
    hoverTimers.current.close = null;
  };
  const handleLinkHoverEnter = (e) => {
    const manualEl = e.target.closest?.('[data-link-id]');
    const autoEl   = manualEl ? null : e.target.closest?.('.tt-link-auto[data-records]');
    const el = manualEl || autoEl;
    if (!el) return;
    // Same chip we were already hovering → don't reset the timer or
    // we'll never actually open the popover.
    if (lastChipRef.current === el && (hoverTimers.current.open || linkHover)) return;
    lastChipRef.current = el;
    cancelHoverTimers();
    hoverTimers.current.open = setTimeout(() => {
      hoverTimers.current.open = null;
      let refs = null, term = el.textContent || '';
      if (manualEl) refs = buildRefsFromManualLink(manualEl.dataset.linkId);
      else if (autoEl) {
        let records = [];
        try { records = JSON.parse(autoEl.dataset.records || '[]'); } catch {}
        refs = buildRefsFromCandidate(records);
      }
      setLinkHover({ anchor: el.getBoundingClientRect(), refs: refs || [], term });
    }, 250);
  };
  const handleLinkHoverLeave = (e) => {
    const fromChip = e.target.closest?.('[data-link-id], .tt-link-auto[data-records]');
    if (!fromChip) return;
    // If the cursor is moving to another element INSIDE the same chip,
    // don't trigger the close — that's an internal sub-span boundary,
    // not a real exit.
    const toChip = e.relatedTarget?.closest?.('[data-link-id], .tt-link-auto[data-records]');
    if (toChip && toChip === fromChip) return;
    lastChipRef.current = null;
    clearTimeout(hoverTimers.current.open);
    hoverTimers.current.open = null;
    hoverTimers.current.close = setTimeout(() => setLinkHover(null), 200);
  };
  useEffect(() => () => cancelHoverTimers(), []);

  // "See all references" → open the side drawer for the first ref.
  const [backlinksRef, setBacklinksRef] = useState(null);

  // Upload an image File and insert it at `pos` (or current selection if null).
  const uploadAndInsert = async (editor, file, pos = null) => {
    if (!file || !file.type?.startsWith('image/')) return;
    if (!workspaceId || !userId) return;
    try {
      const payload = await uploadImage({ file, workspaceId, userId });
      if (pos != null) {
        editor.chain().focus().insertContentAt(pos, { type: 'image', attrs: { src: payload.publicUrl } }).run();
      } else {
        editor.chain().focus().setImage({ src: payload.publicUrl }).run();
      }
    } catch (e) {
      console.error('image upload failed', e);
      feedback.toast({ type: 'error', message: `Image upload failed: ${e?.message || e}` });
    }
  };

  const pickImageFromDisk = (editor) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = () => { const f = input.files?.[0]; if (f) uploadAndInsert(editor, f); };
    input.click();
  };

  const pickBoardEmbed = (editor) => {
    if (!onRequestBoardEmbed) {
      console.warn('Board embed picker not wired up — onRequestBoardEmbed prop missing');
      return;
    }
    onRequestBoardEmbed((picked) => {
      if (!picked) return;
      editor.chain().focus().insertContent({
        type: 'boardEmbed',
        attrs: { boardId: picked.boardId, cardId: picked.cardId || null, label: picked.label || null },
      }).run();
    });
  };

  const insertBookmarkInline = (editor) => {
    if (!activePageId) return;
    const anchor = editor.state.selection.from;
    let suggested = '';
    try {
      const para = editor.state.doc.resolve(anchor).parent;
      suggested = para?.textContent?.slice(0, 40) || '';
    } catch (_) {}
    // eslint-disable-next-line no-alert
    const name = window.prompt('Bookmark name', suggested || 'Bookmark');
    if (!name) return;
    addBookmark(ydoc, { name: name.trim() || 'Bookmark', pageId: activePageId, anchor, scope });
  };

  const editor = useEditor({
    extensions: [
      // Schema-defining extensions live in baseDocExtensions so the template
      // picker can build a matching offline schema for seeding pages.
      ...baseDocExtensions,
      // ⌘K → link picker (URL or entity picker).
      Extension.create({
        name: 'soleilLinkShortcut',
        addKeyboardShortcuts: () => ({
          'Mod-k': () => { openLinkPicker(editorRef.current); return true; },
        }),
      }),
      // ⌘⌥M → add comment on current selection.
      Extension.create({
        name: 'soleilCommentShortcut',
        addKeyboardShortcuts: () => ({
          'Mod-Alt-m': () => { addComment.open(); return true; },
        }),
      }),
      // Live decoration of link marks: kind-aware colours + multi-target badge.
      Extension.create({
        name: 'soleilLinkRenderer',
        addProseMirrorPlugins: () => [makeLinkRendererPlugin({ getYdoc: () => ydoc })],
      }),
      // Auto-detect entity names in the doc and add dotted underline decorations.
      Extension.create({
        name: 'soleilAutoDetect',
        addProseMirrorPlugins: () => [makeAutoDetectPlugin({
          getIndex:   () => nameIndexRef.current,
          getIgnored: () => docIgnoreRef.current,
        })],
      }),
      // Enter key handler: if caret is inside an auto-detect candidate span,
      // open the EntityPicker pre-filled with the candidate's records.
      Extension.create({
        name: 'soleilAutoDetectShortcut',
        addKeyboardShortcuts: () => ({
          'Enter': () => {
            const editor = editorRef.current;
            if (!editor) return false;
            const sel = editor.state.selection;
            // Only short-circuit Enter when caret is collapsed.
            if (!sel.empty) return false;
            // Find the DOM node at the caret. If it's inside a candidate span,
            // open the picker.
            const dom = editor.view.domAtPos(sel.from);
            const el = (dom?.node?.nodeType === 3 ? dom.node.parentElement : dom?.node)?.closest?.('.tt-autolink-candidate');
            if (!el) return false;
            let records = [];
            try { records = JSON.parse(el.dataset.records || '[]'); } catch {}
            if (records.length === 0) return false;
            // Map the candidate's DOM range to PM positions.
            let from, to;
            try {
              from = editor.view.posAtDOM(el.firstChild, 0);
              to   = editor.view.posAtDOM(el.firstChild, el.firstChild.nodeValue.length);
            } catch { return false; }
            editor.commands.setTextSelection({ from, to });
            // Hand off to openLinkPicker with initialSelected pre-filled from the records.
            openLinkPicker(editor, { initialSelected: records.map(recordToTarget) });
            return true;
          },
        }),
      }),
      Typography,
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === 'heading' ? 'Heading' : "Type '/' for blocks, or just start writing…",
        showOnlyWhenEditable: true,
        showOnlyCurrent: true,
      }),
      ...(fragment ? [Collaboration.configure({ fragment })] : []),
      // CollaborationCursor was unreliable in our setup — replaced with a
      // custom DocPresence overlay that uses the same awareness-based
      // cursor system as the canvas (LiveCursor with rAF-lerp).
      makeSlashExtension({
        onInsertImage: pickImageFromDisk,
        onInsertBookmark: insertBookmarkInline,
        onInsertBoardEmbed: pickBoardEmbed,
      }),
      FindHighlightExtension,
      // BlockHandleExtension removed — per-block drag handles felt
      // too Notion-y; Google-Docs-style flowing prose works better.
      ExtraShortcuts,
      mentionExt,
    ],
    autofocus: 'end',
    // false → read-only (viewer-shared board). RLS will reject any
    // doc-state writes anyway, but disabling Tiptap stops attempts.
    editable,
    editorProps: {
      attributes: {
        class: 'tt-editor',
        spellcheck: 'true',
        // Tell Grammarly to enable itself on this contenteditable. The
        // extension auto-disables on contenteditables that don't opt in
        // by default; the explicit attribute restores it without
        // breaking Tiptap's input rules.
        'data-gramm': 'true',
        'data-gramm_editor': 'true',
        'data-enable-grammarly': 'true',
      },
      // Image drop / paste — upload via our existing Storage helper, then
      // insert at the drop point (or current cursor for paste).
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        // Universal entity-ref drop → insert as a manual link mark at
        // the drop position. Picker rows / canvas chips / message
        // attachment chips all use this mime type so any of them can
        // be dragged into a doc.
        const refRaw = event.dataTransfer?.getData(ENTITY_REF_MIME);
        if (refRaw) {
          let ref = null;
          try { ref = coerceRef(JSON.parse(refRaw)); } catch (_) {}
          if (ref) {
            event.preventDefault();
            const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
            const pos = coords?.pos ?? view.state.selection.from;
            insertEntityLinkAt(pos, ref);
            return true;
          }
        }
        const files = Array.from(event.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        const pos = coords?.pos ?? view.state.selection.from;
        const ed = editorRef.current;
        if (ed) files.forEach(f => uploadAndInsert(ed, f, pos));
        return true;
      },
      handlePaste: (_view, event) => {
        const items = Array.from(event.clipboardData?.items || []);
        const imgs = items.filter(it => it.type.startsWith('image/'));
        if (!imgs.length) return false;
        event.preventDefault();
        const ed = editorRef.current;
        if (ed) imgs.forEach(it => { const f = it.getAsFile(); if (f) uploadAndInsert(ed, f); });
        return true;
      },
      handleClickOn: (_view, _pos, _node, _nodePos, event) => {
        // Intercept soleil:// links so the host can route them (open the
        // target board / scroll to the bookmark) instead of the browser
        // trying to navigate to a junk URL.
        const a = event.target?.closest?.('a[href^="soleil://"]');
        if (!a) return false;
        const href = a.getAttribute('href');
        const m = /^soleil:\/\/bookmark\/([^/]+)\/([^/?#]+)/.exec(href);
        if (m) {
          event.preventDefault();
          document.dispatchEvent(new CustomEvent('soleil-open-bookmark', {
            detail: { boardId: m[1], bookmarkId: m[2] },
          }));
          return true;
        }
        return false;
      },
    },
    // Force a fresh editor when the bound page changes.
    // (Editor identity is keyed on the parent's `key={pageId}` — see DocSurface.)
  }, [pageId]);

  // Notify parent so it can wire the toolbar to the live editor instance.
  const lastNotified = useRef(null);
  useEffect(() => {
    editorRef.current = editor;
    if (editor && lastNotified.current !== editor) {
      lastNotified.current = editor;
      onEditorReady?.(editor);
    }
  }, [editor, onEditorReady]);

  // One-time idempotent migration: legacy bookmarks → kind='docPos' Links.
  // Runs whenever ydoc binds (or changes), safe to call repeatedly.
  useEffect(() => {
    if (!ydoc) return;
    const docCardId = (scope && scope.docCardId) || null;
    try {
      const n = migrateBookmarksToLinks(ydoc, { docCardId });
      if (n > 0) console.info(`Migrated ${n} bookmarks → links in ${docCardId || 'root doc'}`);
    } catch (e) {
      console.warn('Bookmark migration failed', e);
    }
  }, [ydoc, scope]);

  // Observe links Y.Map and debounce-call updateBacklinks (2s inactivity).
  // Skipped for root doc — those have no docCardId to anchor backlinks.
  useEffect(() => {
    if (!ydoc || !workspaceId || !activePageId) return;
    const docCardId = (scope && scope.docCardId) || null;
    if (!docCardId) return;  // root doc — skip backlinks until per-card
    const lm = ydoc.getMap('links');
    let timer = null;
    const fire = () => {
      const all = listLinks(ydoc).filter(l => l.pageId === activePageId);
      updateBacklinks({ workspaceId, docCardId, pageId: activePageId, links: all });
    };
    const onChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(fire, 2000);
    };
    lm.observeDeep(onChange);
    return () => {
      if (timer) clearTimeout(timer);
      lm.unobserveDeep(onChange);
    };
  }, [ydoc, workspaceId, activePageId, scope]);

  // Project doc page text into doc_page_index so the universal hover
  // popover can list "Appears in" doc rows. Debounced to ride out
  // typing storms (2s of quiet → flush). Watches the page-content
  // map + pages array so renames/adds/deletes also trigger a sync.
  useEffect(() => {
    if (!ydoc || !workspaceId) return;
    const docCardId = (scope && scope.docCardId) || null;
    if (!docCardId) return;
    // Scope already carries its own pages + content Y types (via
    // cardScope) — observe those directly, no card-y-map lookup needed.
    const pagesType = scope.pages;
    const contentType = scope.content;
    if (!pagesType || !contentType) return;
    let timer = null;
    const fire = () => {
      try {
        const pages = readPagesWithText(ydoc, scope);
        syncDocPageIndex({ workspaceId, docCardId, pages });
      } catch (e) { console.warn('doc_page_index sync', e); }
    };
    const onChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(fire, 2000);
    };
    pagesType.observeDeep?.(onChange);
    contentType.observeDeep?.(onChange);
    // Initial flush on mount so existing docs get indexed.
    onChange();
    return () => {
      if (timer) clearTimeout(timer);
      pagesType.unobserveDeep?.(onChange);
      contentType.unobserveDeep?.(onChange);
    };
  }, [ydoc, workspaceId, scope]);

  if (!editor || !fragment) return <div className="doc-empty">Pick a page on the left, or add one.</div>;

  return (
    <div className="doc-editor-wrap" onClick={handleEditorClick} onMouseOver={handleLinkHoverEnter} onMouseOut={handleLinkHoverLeave}>
      {/* No floating menus — they crowded the cursor. Format from the top
          toolbar (always visible) or right-click for a context menu. */}
      <DocEditorContextMenu editor={editor}
                            onOpenLinkPicker={openLinkPicker}
                            onAddComment={addComment.open} />
      <EditorContent editor={editor} />
      {addComment.node}
      {linkHover && (
        <EntityHoverPopover
          anchor={linkHover.anchor}
          refs={linkHover.refs}
          term={linkHover.term}
          workspaceId={workspaceId}
          docScope={docCardIdForIgnore ? { docCardId: docCardIdForIgnore } : null}
          onMouseEnter={cancelHoverTimers}
          onMouseLeave={() => { hoverTimers.current.close = setTimeout(() => setLinkHover(null), 200); }}
          onClose={() => setLinkHover(null)}
          onSeeAll={() => {
            const ref = linkHover.refs?.[0];
            setLinkHover(null);
            if (ref) setBacklinksRef(ref);
          }}
        />
      )}
      {backlinksRef && (
        <EntityBacklinksPanel
          ref={backlinksRef}
          onClose={() => setBacklinksRef(null)}
        />
      )}
      {linkPicker && (
        <EntityPicker
          workspaceId={workspaceId}
          anchor={linkPicker.anchor}
          multi={linkPicker.multi}
          initialSelected={linkPicker.initialSelected}
          onCommit={commitLink}
          onCancel={() => setLinkPicker(null)}
          urlMode
        />
      )}
      {mention && (
        <EntityPicker
          workspaceId={workspaceId}
          anchor={mention.clientRect}
          initialQuery={mention.query}
          multi
          onCommit={(targets) => {
            const editor = editorRef.current;
            if (!editor || !targets?.length) { setMention(null); return; }
            const linkId = uuid();
            const text = (mention.query && mention.query.trim()) || (targets[0]?.name || 'mention');
            // Create the Link record FIRST so the renderer can resolve it on
            // the next transaction.
            addLink(ydoc, {
              id: linkId,
              pageId: activePageId,
              // Anchor is filled in below after we know the inserted-text range.
              anchor: { from: mention.range.from, to: mention.range.from + text.length },
              targets,
              createdBy: userId || null,
            });
            // Replace the @text with the resolved text + apply the link mark.
            editor.chain().focus()
              .deleteRange(mention.range)
              .insertContent(text)
              .setTextSelection({ from: mention.range.from, to: mention.range.from + text.length })
              .setMark('link', { linkId })
              .run();
            setMention(null);
          }}
          onCancel={() => setMention(null)}
        />
      )}
      <CommentGutter
        ydoc={ydoc}
        scope={scope}
        pageId={activePageId}
        editor={editorRef.current}
        onOpenThread={(id) => {
          const dot = document.querySelector(`.comment-gutter-dot[data-thread="${id}"]`);
          setOpenThread({ id, anchor: dot?.getBoundingClientRect() });
        }}
      />
      {openThread && (
        <CommentInlinePopover
          ydoc={ydoc} scope={scope} threadId={openThread.id}
          anchor={openThread.anchor} currentUser={currentUser}
          onClose={() => setOpenThread(null)}
        />
      )}
    </div>
  );
}

// Right-click context menu — appears at click position; lists the most-used
// inline + block formatting actions for the current selection.
function DocEditorContextMenu({ editor, onOpenLinkPicker, onAddComment }) {
  const [pos, setPos] = useState(null);
  useEffect(() => {
    const root = editor?.view?.dom;
    if (!root) return;
    const onCtx = (e) => {
      // Only intercept when the cursor is inside the editor itself.
      e.preventDefault();
      setPos({ x: e.clientX, y: e.clientY, hasSelection: !editor.state.selection.empty });
    };
    root.addEventListener('contextmenu', onCtx);
    return () => root.removeEventListener('contextmenu', onCtx);
  }, [editor]);
  useEffect(() => {
    if (!pos) return;
    const onDown = (e) => {
      if (!e.target?.closest?.('.doc-ctx')) setPos(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') setPos(null); };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [pos]);

  if (!pos || !editor) return null;
  const close = () => setPos(null);
  const run = (fn) => () => { fn(); close(); };
  const isActive = (name, attrs) => editor.isActive(name, attrs);

  // Clamp menu inside viewport.
  const W = 220, H = 360, PAD = 8;
  const left = Math.max(PAD, Math.min(window.innerWidth - W - PAD, pos.x));
  const top  = Math.max(PAD, Math.min(window.innerHeight - H - PAD, pos.y));

  const Item = ({ icon, label, shortcut, active, onClick, danger }) => (
    <button className={`doc-ctx-item ${active ? 'is-active' : ''} ${danger ? 'danger' : ''}`} onClick={onClick}>
      <span className="doc-ctx-icon">{icon}</span>
      <span className="doc-ctx-label">{label}</span>
      {shortcut && <span className="doc-ctx-kbd">{shortcut}</span>}
    </button>
  );
  const Sep = () => <div className="doc-ctx-sep" />;

  return (
    <div className="doc-ctx" style={{ position: 'fixed', left, top }} role="menu">
      <Item icon={<b>B</b>} label="Bold" shortcut="⌘B" active={isActive('bold')}
            onClick={run(() => editor.chain().focus().toggleBold().run())} />
      <Item icon={<i>I</i>} label="Italic" shortcut="⌘I" active={isActive('italic')}
            onClick={run(() => editor.chain().focus().toggleItalic().run())} />
      <Item icon={<u>U</u>} label="Underline" shortcut="⌘U" active={isActive('underline')}
            onClick={run(() => editor.chain().focus().toggleUnderline().run())} />
      <Item icon={<s>S</s>} label="Strikethrough" shortcut="⌘⇧X" active={isActive('strike')}
            onClick={run(() => editor.chain().focus().toggleStrike().run())} />
      <Sep />
      <Item icon={<HighlightIcon />} label="Highlight" active={isActive('highlight')}
            onClick={run(() => editor.chain().focus().toggleHighlight({ color: '#fff7a8' }).run())} />
      <Item icon={<CodeIcon />} label="Inline code" shortcut="⌘E" active={isActive('code')}
            onClick={run(() => editor.chain().focus().toggleCode().run())} />
      <Item icon={<LinkIcon />} label="Link" shortcut="⌘K"
            onClick={run(() => onOpenLinkPicker?.(editor))} />
      <Sep />
      <Item icon={<H1Icon />} label="Heading 1" shortcut="⌘⌥1" active={isActive('heading', { level: 1 })}
            onClick={run(() => editor.chain().focus().toggleHeading({ level: 1 }).run())} />
      <Item icon={<H2Icon />} label="Heading 2" shortcut="⌘⌥2" active={isActive('heading', { level: 2 })}
            onClick={run(() => editor.chain().focus().toggleHeading({ level: 2 }).run())} />
      <Item icon={<H3Icon />} label="Heading 3" shortcut="⌘⌥3" active={isActive('heading', { level: 3 })}
            onClick={run(() => editor.chain().focus().toggleHeading({ level: 3 }).run())} />
      <Sep />
      <Item icon={<UlIcon />} label="Bulleted list" shortcut="⌘⇧8" active={isActive('bulletList')}
            onClick={run(() => editor.chain().focus().toggleBulletList().run())} />
      <Item icon={<OlIcon />} label="Numbered list" shortcut="⌘⇧7" active={isActive('orderedList')}
            onClick={run(() => editor.chain().focus().toggleOrderedList().run())} />
      <Item icon={<TaskIcon />} label="Task list" shortcut="⌘⇧9" active={isActive('taskList')}
            onClick={run(() => editor.chain().focus().toggleTaskList().run())} />
      <Item icon={<QuoteIcon />} label="Quote" active={isActive('blockquote')}
            onClick={run(() => editor.chain().focus().toggleBlockquote().run())} />
      {pos.hasSelection && (
        <>
          <Sep />
          <Item icon={<CommentIcon />} label="Add comment" shortcut="⌘⌥M"
                onClick={run(() => onAddComment?.())} />
        </>
      )}
    </div>
  );
}

// Shared icon set for context menu + toolbar — small, calm 14px line icons.
function svg(props, children) { return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...props}>{children}</svg>; }
const HighlightIcon = () => svg({}, <><path d="M3 11 L8 6 L10 8 L5 13 Z M8 6 L11 3 L13 5 L10 8" /><path d="M2 13 H6" /></>);
const CodeIcon  = () => svg({}, <><path d="M5 10 L2 7 L5 4" /><path d="M9 4 L12 7 L9 10" /></>);
const LinkIcon  = () => svg({}, <><path d="M5 7 L9 7 M6 4 L4 4 A3 3 0 0 0 4 10 L6 10 M8 4 L10 4 A3 3 0 0 1 10 10 L8 10" /></>);
const H1Icon    = () => svg({}, <><path d="M3 3 V11 M3 7 H8 M8 3 V11" /><path d="M11 4 L13 3 V11" /></>);
const H2Icon    = () => svg({}, <><path d="M3 3 V11 M3 7 H7 M7 3 V11" /><path d="M10 5 A1.5 1.5 0 0 1 13 5 C13 7 10 9 10 11 H13" /></>);
const H3Icon    = () => svg({}, <><path d="M3 3 V11 M3 7 H7 M7 3 V11" /><path d="M10 5 A1.5 1.5 0 0 1 13 5 A1.5 1.5 0 0 1 11 7.5 A1.5 1.5 0 0 1 13 10 A1.5 1.5 0 0 1 10 10" /></>);
const UlIcon    = () => svg({}, <><circle cx="3" cy="4" r=".7" fill="currentColor" stroke="none" /><circle cx="3" cy="7" r=".7" fill="currentColor" stroke="none" /><circle cx="3" cy="10" r=".7" fill="currentColor" stroke="none" /><path d="M6 4 H12 M6 7 H12 M6 10 H12" /></>);
const OlIcon    = () => svg({}, <><text x="1.4" y="5.5" fontSize="3.2" fontFamily="ui-monospace" stroke="none" fill="currentColor">1</text><text x="1.4" y="9" fontSize="3.2" fontFamily="ui-monospace" stroke="none" fill="currentColor">2</text><text x="1.4" y="12.5" fontSize="3.2" fontFamily="ui-monospace" stroke="none" fill="currentColor">3</text><path d="M6 4 H12 M6 7 H12 M6 10 H12" /></>);
const TaskIcon  = () => svg({}, <><rect x="2" y="2.5" width="4" height="4" rx="1" /><path d="M3 4.5 L4 5.5 L5.5 3.8" /><path d="M8 4.5 H12" /><rect x="2" y="8.5" width="4" height="4" rx="1" /><path d="M8 10.5 H12" /></>);
const QuoteIcon = () => svg({}, <><path d="M2 5 Q2 3 4 3 V6 H2 V5 Q2 7 4 8" /><path d="M8 5 Q8 3 10 3 V6 H8 V5 Q8 7 10 8" /></>);
const CommentIcon = () => svg({}, <><path d="M2 4 A1 1 0 0 1 3 3 H11 A1 1 0 0 1 12 4 V9 A1 1 0 0 1 11 10 H6 L4 12 V10 H3 A1 1 0 0 1 2 9 Z" /></>);

function promptLink(editor) {
  const previous = editor.getAttributes('link').href || '';
  // Use a tiny inline prompt for now. The app's feedback.prompt would be
  // nicer but it's async-modal and would interfere with the editor's
  // selection — keep this synchronous for the v1.
  // eslint-disable-next-line no-alert
  const url = window.prompt('URL', previous);
  if (url === null) return;
  if (url === '') {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    return;
  }
  editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
}

// Maps a Trie record (from the auto-detect index) to an EntityPicker target shape.
function recordToTarget(r) {
  if (r.kind === 'board') return { kind: 'board', id: r.id };
  if (r.kind === 'doc')   return { kind: 'doc', docCardId: r.id };
  return { kind: 'card', boardId: r.boardId, cardId: r.id };
}
