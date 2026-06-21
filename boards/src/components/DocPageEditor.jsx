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
import { getOrCreatePageContent, getOrCreateSheetContent, addBookmark, readPagesWithText } from '../lib/docState.js';
import { encodeAnchor } from '../lib/bookmarkRelPos.js';
import { useAddCommentFlow } from './AddCommentFlow.jsx';
import { uploadImage } from '../lib/uploads.js';
import { getLink, addLink, updateLinkTargets, listLinks } from '../lib/links.js';
import { untagDocRange, tagDocRange } from '../lib/tagsApi.js';
import { updateBacklinks, syncDocPageIndex } from '../lib/boardsApi.js';
import { extractTagMentions } from '../lib/extractTagMentions.js';
import { extractParagraphTags } from '../lib/extractParagraphTags.js';
import { splitSentences, wordContextSpan } from '../lib/sentenceSpan.js';
import { recordEntityLinks } from '../lib/recordEntityLinks.js';
import { applyCards } from '../lib/tagsClient.js';
import { ensureFontsFromHtml } from '../lib/googleFonts.js';
import { makeTagRangePlugin, TAG_RANGE_KEY } from './docExtensions/TagRangePlugin.js';
import { useAppliedTagRanges } from '../hooks/useAppliedTagRanges.js';
import { runParagraphCascade, loadWorkspaceTagCentroids } from '../lib/aiParagraphCascade.js';
import { TagRangeHoverPopover, readTagRangeFromEl } from './TagRangeHoverPopover.jsx';
import { DocTagGutter } from './DocTagGutter.jsx';
import { DocCandidateGutter } from './DocCandidateGutter.jsx';
import { makeLinkRendererPlugin } from './docExtensions/LinkRenderer.js';
import { makeAutoDetectPlugin } from './docExtensions/AutoDetectPlugin.js';
import { makeCandidateNamePlugin, CANDIDATE_NAME_KEY } from './docExtensions/CandidateNamePlugin.js';
import { useCandidateTagging } from '../hooks/useCandidateTagging.js';
import { CandidatePromptPopover } from './CandidatePromptPopover.jsx';
import { contentHash } from '../lib/clusterMath.js';
import { baseDocExtensions } from './docExtensions/baseExtensions.js';
import { ScreenplayKeymap } from './docExtensions/screenplay/ScreenplayKeymap.js';
import { ScreenplayPagination } from './docExtensions/screenplay/ScreenplayPagination.js';
import { DocPagination, PAGE_STRIDE, PAGE_H } from './docExtensions/DocPagination.js';
import { ReadableColors } from './docExtensions/ReadableColors.js';
import { ScreenplaySuggest } from './docExtensions/screenplay/ScreenplaySuggest.js';
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
// DocPageTagChips intentionally not mounted — the margin dot
// (DocTagGutter) is the canonical tag surface in the doc body now.
// import { DocPageTagChips } from './DocPageTagChips.jsx';

// In-memory cache for /api/tags/apply verdicts, keyed by
// (pageId, tagId, snippetHash). Typing in a doc only re-fires the API
// when the surrounding-snippet content actually changes.
const verdictCache = new Map();
// Bound the module-global cache so a long multi-doc session can't grow it
// without limit (every distinct snippet/tag pair the AI tagger evaluates used
// to stay forever). FIFO-evict the oldest entry past the cap.
const VERDICT_CACHE_MAX = 2000;
function verdictSet(key, val) {
  if (verdictCache.size >= VERDICT_CACHE_MAX) {
    const oldest = verdictCache.keys().next().value;
    if (oldest !== undefined) verdictCache.delete(oldest);
  }
  verdictCache.set(key, val);
}
function verdictKey(pageId, tagId, snippetHash) {
  return `${pageId}::${tagId}::${snippetHash}`;
}

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
      // Highlight: ⌘⇧H. No inline color — let the themed `.tt-editor mark`
      // CSS own it (dark #fff7a8 / light #fff09a) so highlights stay visible
      // in both themes instead of being pinned to one hardcoded colour.
      'Mod-Shift-h': () => this.editor.chain().focus().toggleHighlight().run(),
      // Alignment: ⌘⇧L / E / R / J (Google Docs)
      'Mod-Shift-l': () => this.editor.chain().focus().setTextAlign('left').run(),
      'Mod-Shift-e': () => this.editor.chain().focus().setTextAlign('center').run(),
      'Mod-Shift-r': () => this.editor.chain().focus().setTextAlign('right').run(),
      'Mod-Shift-j': () => this.editor.chain().focus().setTextAlign('justify').run(),
      // (Subscript/superscript ⌘./⌘, are the @tiptap/extension defaults — no
      // need to re-bind them here, and ⌘. is also the app's global clean-mode
      // toggle, so leave that key to the extension + global guard.)
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

export function DocPageEditor({ ydoc, scope, pageId, sheetId = null, docMode = 'doc', pageless = true, zoom = 1, onEditorReady, onEditorDestroy, onEditorFocus, onDeleteSheet, workspaceId, userId, activePageId, onRequestBoardEmbed, onRequestLink, onStartComment, awareness, onNavigateTarget, registerOpenLinkPicker, registerOpenAddComment, currentUser, boards, editable = true, isPublic = false }) {
  // Resolve the fragment: an explicit sheetId binds to that sheet, otherwise
  // we fall back to the page's primary content (back-compat with one-sheet
  // pages). sheetId === pageId also lands on the primary fragment.
  const fragment = pageId
    ? (sheetId && sheetId !== pageId
       ? getOrCreateSheetContent(ydoc, pageId, sheetId, scope)
       : getOrCreatePageContent(ydoc, pageId, scope))
    : null;
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

  // Candidate names — recurring proper nouns not yet tagged. Painted as a
  // faint dotted underline by CandidateNamePlugin; tap → promote/dismiss.
  // The shared useCandidateTagging hook owns the index + prompt + promote /
  // dismiss (same as notes); the doc-specific bit is pinning the tapped span
  // so a freshly promoted tag converts to a colored underline immediately.
  //
  // Build a { pHash, startOffset, length } anchor for the tapped span
  // (TagRangePlugin re-locates ranges by paragraph content-hash). Best
  // effort: null for short paragraphs the range plugin skips, or if the
  // DOM→PM mapping fails — the tag still exists workspace-wide regardless.
  const candidateAnchorFromEl = (el) => {
    const ed = editorRef.current;
    if (!ed?.view || !el) return null;
    try {
      const from = ed.view.posAtDOM(el.firstChild || el, 0);
      const length = (el.textContent || '').length;
      if (!(length > 0)) return null;
      const $from = ed.state.doc.resolve(from);
      let depth = $from.depth;
      while (depth > 0 && $from.node(depth).type.name !== 'paragraph') depth--;
      if (depth === 0) return null;
      const paraStart = $from.start(depth);
      const raw = $from.node(depth).textContent || '';
      const trimmed = raw.trim();
      if (trimmed.length < 20) return null; // TagRangePlugin skips short paras
      const leading = raw.length - raw.replace(/^\s+/, '').length;
      const startOffset = (from - paraStart) - leading;
      if (startOffset < 0 || startOffset + length > trimmed.length) return null;
      return { pHash: contentHash(trimmed), startOffset, length };
    } catch (_) {
      return null;
    }
  };

  const {
    candidateIndexRef,
    candidatePrompt, setCandidatePrompt,
    candidateBusy, promoteCandidate, dismissCandidate,
  } = useCandidateTagging({
    editorRef, workspaceId, userId,
    notify: (t) => feedback.toast(t),
    applyPromotedTag: async (tag, c) => {
      const docCardId = scope?.docCardId || null;
      if (!tag?.id || !docCardId || !pageId) return false;
      const anchor = candidateAnchorFromEl(c.el);
      if (!anchor) return false;
      await tagDocRange({
        workspaceId, docCardId, pageId,
        boardId: scope?.boardId || null,
        tagId: tag.id, source: 'user',
        sourceAnchor: anchor,
        contextText: c.sample || null,
      });
      return true;
    },
  });

  // Applied tag ranges for the active page — painted as tag-color
  // underlines by TagRangePlugin. Refs let the plugins read fresh
  // values without re-mounting the editor.
  const appliedTagRanges = useAppliedTagRanges({
    workspaceId,
    docCardId: scope?.docCardId || null,
    pageId: activePageId || null,
  });
  const appliedTagRangesRef = useRef([]);
  const appliedRangeBoxesRef = useRef([]);
  useEffect(() => {
    appliedTagRangesRef.current = appliedTagRanges || [];
    // Compute absolute doc positions for each range so the auto-detect
    // plugin can ask "does this entity-name match overlap an applied
    // range?" without re-walking. Updates whenever ranges change OR
    // the editor doc changes (handled below in the transaction hook).
    refreshAppliedRangeBoxes();
    // Force the TagRangePlugin to recompute even when the doc hasn't
    // changed (e.g. a new entity_links row just landed).
    const ed = editorRef.current;
    if (ed?.view) {
      // Recompute the tag-range underlines AND the candidate underlines
      // (so a newly-applied range suppresses any candidate it now covers).
      const tr = ed.state.tr
        .setMeta(TAG_RANGE_KEY, { changed: true })
        .setMeta(CANDIDATE_NAME_KEY, { changed: true });
      ed.view.dispatch(tr);
    }
  }, [appliedTagRanges]);

  // Recompute the absolute-position boxes for each applied range so
  // AutoDetectPlugin can suppress decorations that overlap them. Re-runs
  // on every editor transaction so paragraphs that move (because a
  // paragraph above grew/shrank) keep their boxes accurate.
  const refreshAppliedRangeBoxes = () => {
    const ed = editorRef.current;
    if (!ed?.state?.doc) { appliedRangeBoxesRef.current = []; return; }
    const ranges = appliedTagRangesRef.current || [];
    if (ranges.length === 0) { appliedRangeBoxesRef.current = []; return; }
    // Walk the doc, hash each paragraph, look up matching ranges.
    const byHash = new Map();
    ed.state.doc.descendants((node, pos) => {
      if (node.type?.name !== 'paragraph') return true;
      const text = (node.textContent || '').trim();
      if (text.length < 20) return false;
      // Re-import contentHash here would be heavy; use the same FNV-1a
      // by reusing what the plugin already does. Cheap to compute.
      let h = 2166136261;
      for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      const hash = (h >>> 0).toString(16);
      if (!byHash.has(hash)) byHash.set(hash, pos + 1);
      return false;
    });
    const boxes = [];
    for (const r of ranges) {
      const paraFrom = byHash.get(r.pHash);
      if (paraFrom == null) continue;
      boxes.push({ from: paraFrom + r.startOffset, to: paraFrom + r.startOffset + r.length });
    }
    appliedRangeBoxesRef.current = boxes;
  };

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
    // Stash the selection range so we can restore it if the picker is
    // cancelled (opening/typing in the picker collapses the editor caret).
    setLinkPicker({ anchor: rect, multi: true, initialSelected, existingLinkId, from: sel.from, to: sel.to });
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
      // Tag wins. If any record is a tag, the user is invoking that
      // concept — navigate directly instead of opening the disambiguation
      // popover. Hold cmd/ctrl to see the full match list.
      const tagRef = (refs || []).find(r => r?.kind === 'tag');
      if (tagRef && !(e.metaKey || e.ctrlKey)) {
        setLinkHover(null);
        navigateRef(tagRef);
        return;
      }
      setLinkHover({
        anchor: autoEl.getBoundingClientRect(),
        refs: refs || [],
        term: autoEl.textContent || '',
      });
      return;
    }
    // Candidate names (dotted underline from CandidateNamePlugin) — a tap
    // opens the "make character/setting?" prompt right where you're reading.
    const candEl = e.target.closest?.('.tt-candidate[data-name]');
    if (candEl) {
      e.preventDefault();
      setLinkHover(null);
      setTagHover(null);
      setCandidatePrompt({
        anchor: candEl.getBoundingClientRect(),
        name: candEl.dataset.name || (candEl.textContent || '').trim(),
        count: Number(candEl.dataset.count) || 0,
        sample: candEl.dataset.sample || '',
        el: candEl,
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
  const [tagHover, setTagHover] = useState(null);  // { anchor, tagId, tagName, tagColor, source }
  const hoverTimers = useRef({ open: null, close: null });
  const lastChipRef = useRef(null);
  const cancelHoverTimers = () => {
    clearTimeout(hoverTimers.current.open);
    clearTimeout(hoverTimers.current.close);
    hoverTimers.current.open = null;
    hoverTimers.current.close = null;
  };
  // Resolve which chip (tag-range tint, manual link, or auto link) sits
  // under an event target. Shared by the hover path and the touch-tap path.
  const chipAtTarget = (target) => {
    const tagRange = readTagRangeFromEl(target);
    const manualEl = !tagRange && target.closest?.('[data-link-id]');
    const autoEl   = !tagRange && !manualEl && target.closest?.('.tt-link-auto[data-records]');
    const el = tagRange?.el || manualEl || autoEl;
    return el ? { el, tagRange, manualEl, autoEl } : null;
  };
  const openChipPopover = ({ el, tagRange, manualEl, autoEl }) => {
    if (tagRange) {
      setTagHover({
        anchor: el.getBoundingClientRect(),
        tagId: tagRange.tagId,
        tagName: tagRange.tagName,
        tagColor: tagRange.tagColor,
        source: el.getAttribute('data-source') || 'auto-word',
        sourceAnchor: tagRange.sourceAnchor,
      });
      setLinkHover(null);
      return;
    }
    let refs = null;
    const term = el.textContent || '';
    if (manualEl) refs = buildRefsFromManualLink(manualEl.dataset.linkId);
    else if (autoEl) {
      let records = [];
      try { records = JSON.parse(autoEl.dataset.records || '[]'); } catch {}
      refs = buildRefsFromCandidate(records);
    }
    setLinkHover({ anchor: el.getBoundingClientRect(), refs: refs || [], term });
    setTagHover(null);
  };
  const handleLinkHoverEnter = (e) => {
    // Tag-color tint (.tt-tag-word) hover opens the SAME tag popover
    // that the margin dot opens. Wins over manual / auto-detect spans
    // when both happen at the same point.
    const chip = chipAtTarget(e.target);
    if (!chip) return;
    if (lastChipRef.current === chip.el && (hoverTimers.current.open || linkHover || tagHover)) return;
    lastChipRef.current = chip.el;
    cancelHoverTimers();
    hoverTimers.current.open = setTimeout(() => {
      hoverTimers.current.open = null;
      openChipPopover(chip);
    }, 250);
  };
  // Touch has no hover — a tap on a chip opens the same popover
  // immediately (it carries the navigate/see-all actions).
  const handleChipPointerUp = (e) => {
    if (e.pointerType !== 'touch') return;
    const chip = chipAtTarget(e.target);
    if (!chip) return;
    cancelHoverTimers();
    lastChipRef.current = chip.el;
    openChipPopover(chip);
  };
  const handleLinkHoverLeave = (e) => {
    const fromChip = e.target.closest?.('[data-link-id], .tt-link-auto[data-records], .tt-tag-word');
    if (!fromChip) return;
    const toChip = e.relatedTarget?.closest?.('[data-link-id], .tt-link-auto[data-records], .tt-tag-word');
    if (toChip && toChip === fromChip) return;
    lastChipRef.current = null;
    clearTimeout(hoverTimers.current.open);
    hoverTimers.current.open = null;
    hoverTimers.current.close = setTimeout(() => {
      setLinkHover(null);
      setTagHover(null);
    }, 200);
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

  const insertBookmarkInline = async (editor) => {
    if (!activePageId) return;
    const anchor = editor.state.selection.from;
    let suggested = '';
    try {
      const para = editor.state.doc.resolve(anchor).parent;
      suggested = para?.textContent?.slice(0, 40) || '';
    } catch (_) {}
    const name = await feedback.prompt({
      title: 'Add bookmark',
      label: 'Bookmark name',
      defaultValue: suggested || 'Bookmark',
      confirmLabel: 'Add',
    });
    if (name == null) return; // cancelled
    const relAnchor = encodeAnchor(editor, anchor);
    addBookmark(ydoc, { name: name.trim() || 'Bookmark', pageId: activePageId, anchor, relAnchor, scope });
  };

  // Prose pagination (DocPagination) reports how many 8.5×11 pages the content
  // currently spans; we draw that many white sheets behind the text. zoomRef
  // lets the plugin read the live zoom without re-creating the editor.
  const [pageCount, setPageCount] = useState(1);
  const zoomRef = useRef(zoom);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  const editor = useEditor({
    extensions: [
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
          // Suppress dotted-underline decorations inside any applied
          // tag range — the colored underline wins.
          getAppliedRangeSet: () => appliedRangeBoxesRef.current || [],
        })],
      }),
      // Discover recurring proper nouns that aren't tags yet and mark them
      // with a fainter dotted underline; a tap promotes them to a
      // character/setting tag. Suppressed under applied tag ranges and
      // real mentions so it never double-paints.
      Extension.create({
        name: 'soleilCandidateNames',
        addProseMirrorPlugins: () => [makeCandidateNamePlugin({
          getIndex:           () => candidateIndexRef.current,
          getAppliedRangeSet: () => appliedRangeBoxesRef.current || [],
          getMentionIndex:    () => nameIndexRef.current,
        })],
      }),
      // Paint tag-color underlines over applied tag ranges (paragraph,
      // sentence, or word+context spans persisted by the AI tagger).
      Extension.create({
        name: 'soleilTagRange',
        addProseMirrorPlugins: () => [makeTagRangePlugin({
          getRanges: () => appliedTagRangesRef.current || [],
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
            const el = (dom?.node?.nodeType === 3 ? dom.node.parentElement : dom?.node)?.closest?.('.tt-link-auto[data-records]');
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
      // @tiptap/extension-collaboration registers yUndoPlugin and the
      // Mod-Z / Mod-Y keymaps internally — adding our own would
      // double-register the plugin and crash the editor with
      // "Adding different instances of a keyed plugin (y-undo$)".
      ...(fragment ? [Collaboration.configure({ fragment })] : []),
      // CollaborationCursor was unreliable in our setup — replaced with a
      // custom DocPresence overlay that uses the same awareness-based
      // cursor system as the canvas (LiveCursor with rAF-lerp).
      makeSlashExtension({
        onInsertImage: pickImageFromDisk,
        onInsertBookmark: insertBookmarkInline,
        onInsertBoardEmbed: pickBoardEmbed,
        // In screenplay mode `/` offers script elements, not prose blocks. The
        // editor is keyed `sid:docMode` so it rebuilds when the mode flips.
        docMode,
      }),
      FindHighlightExtension,
      // BlockHandleExtension removed — per-block drag handles felt
      // too Notion-y; Google-Docs-style flowing prose works better.
      ExtraShortcuts,
      // Screenplay Tab/Enter cycling + auto-caps (priority:1000 so it wins
      // over ExtraShortcuts/AutoDetect/mention; gated to screenplayBlock) +
      // the on-screen line-accurate pagination overlay.
      ...(docMode === 'screenplay'
        ? [ScreenplaySuggest, ScreenplayKeymap, ScreenplayPagination]
        // Prose: measurement-based reflow pagination (real pages, line-level
        // splitting). Reports page count so we can draw the page sheets. Only in
        // PAGED mode — pageless docs (the default) are one continuous sheet with
        // no page breaks, so the paginator isn't mounted at all.
        : pageless
          ? []
          : [DocPagination.configure({ getZoom: () => zoomRef.current, onPages: setPageCount })]),
      // Keep user-chosen text colors readable on the page sheet in both themes
      // (scoped stylesheet override; never mutates content).
      ReadableColors,
      mentionExt,
    ],
    // Don't steal focus from an active text field (e.g. the page-rename
    // input in the sidebar) or another editor. A newly-mounted sheet —
    // whether the one auto-appended when a page fills, or a sibling sheet
    // re-rendering — must not yank the caret away from what the user is
    // typing in. Only autofocus on a genuine first open (nothing editable
    // is currently focused); 'end' places the caret at the document end.
    autofocus: (() => {
      if (typeof document === 'undefined') return false;
      const a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) {
        return false;
      }
      return 'end';
    })(),
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
    // Seed a brand-new screenplay sheet's first block as a Scene Heading so
    // the writer starts in the right element. Gated on isEmpty so it never
    // clobbers loaded content.
    onCreate: ({ editor }) => {
      if (docMode === 'screenplay' && editor.isEmpty) {
        editor.chain().setScreenplayElement('scene').run();
      }
    },
    // Force a fresh editor when the bound page, doc mode, or page layout
    // changes. Flipping pageless adds/removes the DocPagination plugin, so the
    // editor must rebuild. (Editor identity is ALSO keyed on the parent's
    // key={sid:docMode:pageless} — see DocSurface.)
  }, [pageId, docMode, pageless]);

  // Register this sheet's editor with the parent (toolbar wiring + the
  // sheet-editor registry for cross-sheet find/replace) on setup, and
  // de-register on cleanup. Pairing them in ONE effect with STABLE callbacks
  // is what survives React StrictMode's dev mount→unmount→mount cycle (a
  // separate cleanup-only effect would delete the entry the register effect
  // just added).
  useEffect(() => {
    editorRef.current = editor;
    if (!editor) return undefined;
    onEditorReady?.(editor, sheetId);
    // Inject Google-catalog font stylesheets referenced by the loaded content.
    try { ensureFontsFromHtml(editor.getHTML()); } catch (_) {}
    return () => { onEditorDestroy?.(sheetId); };
  }, [editor, sheetId, onEditorReady, onEditorDestroy]);

  // Touch-only selection bubble: on a phone/tablet the format toolbar scrolls
  // off-screen and tapping it can drop the selection, so a non-empty selection
  // shows an in-place bubble for the core inline formats. Implemented as a
  // plain fixed-position React element (NOT Tiptap's <BubbleMenu>, whose plugin
  // fought EditorContent's DOM and threw insertBefore on editor remount).
  const [bubble, setBubble] = useState(null); // { top, left } | null
  useEffect(() => {
    if (!editor) return undefined;
    const coarse = typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(pointer: coarse)').matches;
    if (!coarse) return undefined; // desktop keeps the top toolbar
    const update = () => {
      const sel = editor.state.selection;
      if (sel.empty || !editor.isEditable || !editor.isFocused) { setBubble(null); return; }
      try { const c = editor.view.coordsAtPos(sel.from); setBubble({ top: c.top, left: c.left }); }
      catch (_) { setBubble(null); }
    };
    const hide = () => setBubble(null);
    editor.on('selectionUpdate', update);
    editor.on('focus', update);
    editor.on('blur', hide);
    return () => { editor.off('selectionUpdate', update); editor.off('focus', update); editor.off('blur', hide); };
  }, [editor]);

  // When a comment thread is deleted, strip its now-orphaned highlight mark
  // from this editor's text (no-op if the mark isn't in this sheet).
  useEffect(() => {
    if (!editor) return;
    const onRemove = (e) => {
      const id = e.detail?.id;
      if (id != null) { try { editor.commands.removeCommentById(id); } catch (_) {} }
    };
    window.addEventListener('soleil-remove-comment-mark', onRemove);
    return () => window.removeEventListener('soleil-remove-comment-mark', onRemove);
  }, [editor]);

  // With stacked sheets, DocSurface needs to know which editor the user is
  // currently editing so the toolbar / find / link picker target the right
  // instance. Fire onEditorFocus with our editor on every focus.
  useEffect(() => {
    if (!editor || !onEditorFocus) return;
    const onFocus = () => onEditorFocus(editor);
    editor.on('focus', onFocus);
    return () => { editor.off('focus', onFocus); };
  }, [editor, onEditorFocus]);

  // Keep applied-range absolute boxes in sync with the live doc so the
  // auto-detect plugin can suppress decorations under colored ranges.
  // Paragraph positions shift as the user types above/below; the
  // hashes don't, so we re-derive boxes on every transaction.
  useEffect(() => {
    if (!editor) return;
    const onTr = () => refreshAppliedRangeBoxes();
    editor.on('transaction', onTr);
    onTr();
    return () => editor.off('transaction', onTr);
  }, [editor]);

  // Independent paragraph-cascade trigger. The doc_page_index sync
  // effect only runs when scope.docCardId AND Y.Type observation is
  // wired; for root docs or freshly-created doc cards that's not
  // always true. This listener fires the cascade on every editor
  // update (debounced 2s) so paragraph tagging works regardless.
  //
  // Crucial: depend on stable primitive values, NOT the `scope`
  // object — scope is a new identity each render so depending on it
  // remounts the effect on every keystroke, cancelling the timer
  // before it can fire (the cascade would never run).
  const scopeDocCardId = scope?.docCardId || null;
  const scopeBoardId   = scope?.boardId   || null;
  useEffect(() => {
    console.info('[paragraph-cascade] mount check — editor:', !!editor,
      'workspaceId:', !!workspaceId, 'docCardId:', !!scopeDocCardId,
      'activePageId:', !!activePageId);
    if (!editor || !workspaceId) return;
    if (!scopeDocCardId || !activePageId) {
      console.info('[paragraph-cascade] gated — needs both a docCardId and an activePageId to run');
      return;
    }
    let timer = null;
    const fire = async () => {
      try {
        const paragraphs = extractParagraphTags(editor.state.doc);
        if (paragraphs.length === 0) {
          console.info('[paragraph-cascade] no >=20-char paragraphs on this page yet');
          return;
        }
        const centroids = await loadWorkspaceTagCentroids(workspaceId);
        if (centroids.size === 0) {
          console.info('[paragraph-cascade] no tag centroids in workspace — create / use a tag first');
          return;
        }
        await runParagraphCascade({
          workspaceId,
          docCardId: scopeDocCardId,
          boardId: scopeBoardId,
          pageId: activePageId,
          paragraphs,
          tagCentroids: centroids,
          trie: nameIndexRef.current,
        });
      } catch (e) { console.warn('[paragraph-cascade] failed', e?.message || e); }
    };
    const onUpdate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(fire, 2000);
    };
    editor.on('update', onUpdate);
    // Initial fire shortly after mount so existing content gets tagged.
    timer = setTimeout(fire, 1500);
    return () => {
      if (timer) clearTimeout(timer);
      editor.off('update', onUpdate);
    };
  }, [editor, workspaceId, scopeDocCardId, scopeBoardId, activePageId]);

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
    const fire = async () => {
      try {
        const pages = readPagesWithText(ydoc, scope);
        syncDocPageIndex({ workspaceId, docCardId, pages });
        // Persist auto-detected tag mentions per page with an AI verdict
        // gate. The trie already gave us name-match candidates; for each
        // mention we ask /api/tags/apply whether the surrounding sentence
        // is genuinely about that tag's concept:
        //   high   → link_kind='applied', source='auto-doc' (chip on doc)
        //   medium → link_kind='mention' (shows under "Mentioned in")
        //   low    → link_kind='mention' (same — still useful breadcrumb)
        // Verdicts are memoized per (page,tag,snippetHash) so typing in
        // the doc only re-calls /apply when the surrounding text changes.
        const trie = nameIndexRef.current;
        if (!trie?.findMatches) return;

        // Step 1: collect mentions per page; partition cached vs uncached.
        const perPage = [];                  // [{ pageId, mentions, uncached }]
        const uncachedToFetch = [];          // [{ id, text, candidate_tags, meta }]
        for (const p of pages) {
          if (!p?.id) continue;
          const mentions = extractTagMentions(p.text || '', trie);
          if (mentions.length === 0) {
            // No mentions on this page — still need to wipe prior auto rows
            // so removed text actually disappears from the tag detail view.
            perPage.push({ pageId: p.id, mentions: [], uncached: [] });
            continue;
          }
          const uncached = [];
          for (const m of mentions) {
            const k = verdictKey(p.id, m.ref.id, m.snippetHash);
            if (!verdictCache.has(k)) uncached.push({ ...m, _key: k, _pageId: p.id });
          }
          perPage.push({ pageId: p.id, mentions, uncached });
          // Build /apply payload — composite id encodes both page and tag.
          for (const m of uncached) {
            uncachedToFetch.push({
              id: `${m._pageId}|${m.ref.id}`,
              text: m.contextText || '',
              candidate_tags: [{ id: m.ref.id, name: m.name || '' }],
              _key: m._key,
            });
          }
        }

        // Step 2: fetch missing verdicts in chunks of 16 (worker cap).
        if (uncachedToFetch.length > 0) {
          for (let i = 0; i < uncachedToFetch.length; i += 16) {
            const slice = uncachedToFetch.slice(i, i + 16);
            try {
              const resp = await applyCards(slice.map(({ _key, ...c }) => c));
              const verdicts = resp?.verdicts || [];
              const byId = new Map(slice.map(s => [s.id, s._key]));
              for (const v of verdicts) {
                const key = byId.get(v.card_id);
                if (!key) continue;
                // worker returns tags[]; first entry is the only candidate we sent.
                const c = (v.tags || [])[0]?.confidence || 'low';
                verdictSet(key, c);
              }
              // Any cards the model didn't return a verdict for → 'low' so
              // we don't keep refetching.
              for (const s of slice) {
                if (!verdictCache.has(s._key)) verdictSet(s._key, 'low');
              }
            } catch (e) {
              console.warn('tag-apply verdict', e?.message || e);
              // Don't poison the cache on transient errors — leave uncached so
              // next sync retries.
            }
          }
        }

        // Tier 1-3 paragraph cascade — runs on the active page only
        // (other pages aren't in this editor instance). Scoped to the
        // workspace's existing tag centroids.
        try {
          if (editorRef.current && activePageId) {
            const paragraphs = extractParagraphTags(editorRef.current.state.doc);
            if (paragraphs.length > 0) {
              const centroids = await loadWorkspaceTagCentroids(workspaceId);
              if (centroids.size > 0) {
                await runParagraphCascade({
                  workspaceId,
                  docCardId,
                  boardId: (scope && scope.boardId) || null,
                  pageId: activePageId,
                  paragraphs,
                  tagCentroids: centroids,
                  trie,
                });
              }
            }
          }
        } catch (e) { console.warn('paragraph-cascade', e?.message || e); }

        // Step 3: per-page, bucket by verdict and persist.
        for (const { pageId, mentions } of perPage) {
          const applied = [];
          const mention = [];
          for (const m of mentions) {
            const k = verdictKey(pageId, m.ref.id, m.snippetHash);
            const v = verdictCache.get(k);
            if (v === 'high') applied.push(m); else mention.push(m);
          }
          // Two upserts per page, each scoped by source-attribution so they
          // don't trample each other (the recordEntityLinks delete filters
          // on `source`). 'auto-doc' = doc-name-match + AI-confirmed apply.
          // 'auto' = unconfirmed mention.
          recordEntityLinks({
            source: { kind: 'doc', id: docCardId, workspace: workspaceId, pageId },
            refs: applied,
            replaceForSource: true,
            replaceTargetKind: 'tag',
            replaceSourceAttribution: 'auto-doc',
            linkKind: 'applied',
            attribution: 'auto-doc',
          }).catch((e) => console.warn('tag-applied persist', e?.message || e));
          recordEntityLinks({
            source: { kind: 'doc', id: docCardId, workspace: workspaceId, pageId },
            refs: mention,
            replaceForSource: true,
            replaceTargetKind: 'tag',
            replaceSourceAttribution: 'auto',
            linkKind: 'mention',
            attribution: 'auto',
          }).catch((e) => console.warn('tag-mention persist', e?.message || e));
        }
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

  // Prose PAGED flow model: the wrap is a transparent column; we paint
  // `pageCount` white 8.5×11 sheets behind the text, and the DocPagination gap
  // widgets push content so it lands on each sheet. Pageless prose (the default)
  // and screenplay both keep the single continuous-sheet look (base wrap).
  const isFlow = docMode !== 'screenplay' && !pageless;
  const wrapStyle = isFlow
    ? { minHeight: ((pageCount - 1) * PAGE_STRIDE + PAGE_H) + 'px' }
    : undefined;

  return (
    <div className={`doc-editor-wrap${isFlow ? ' doc-flow' : ''}`} style={wrapStyle}
         onClick={handleEditorClick} onMouseOver={handleLinkHoverEnter} onMouseOut={handleLinkHoverLeave} onPointerUp={handleChipPointerUp}>
      {isFlow && (
        <div className="doc-pages-bg" aria-hidden="true">
          {Array.from({ length: Math.max(1, pageCount) }).map((_, i) => (
            <div className="doc-page-sheet" key={i} style={{ top: (i * PAGE_STRIDE) + 'px' }}>
              <span className="doc-page-num">{i + 1}</span>
            </div>
          ))}
        </div>
      )}
      {onDeleteSheet && (
        <button className="doc-sheet-delete"
                type="button"
                title="Delete this page"
                aria-label="Delete this page"
                onClick={(e) => { e.stopPropagation(); onDeleteSheet(); }}>
          ×
        </button>
      )}
      {/* No floating menus — they crowded the cursor. Format from the top
          toolbar (always visible) or right-click for a context menu.
          Public viewers get the native context menu instead — every item
          here is an editor action. */}
      {!isPublic && (
      <DocEditorContextMenu editor={editor}
                            onOpenLinkPicker={openLinkPicker}
                            onAddComment={addComment.open}
                            closeTagHover={() => setTagHover(null)}
                            onRemoveTag={editable && scope?.docCardId ? async (info) => {
                              try {
                                await untagDocRange({
                                  workspaceId,
                                  docCardId: scope.docCardId,
                                  pageId,
                                  tagId: info.tagId,
                                  sourceAnchor: info.sourceAnchor,
                                });
                              } catch (err) {
                                feedback.toast({ type: 'error', message: 'Remove tag failed: ' + (err.message || err) });
                              }
                            } : null} />
      )}
      {/* Page-level applied-tag chip strip removed — margin dots are
          the canonical tag surface inside the doc body now. */}
      <EditorContent editor={editor} />
      {!isPublic && editable && bubble && (
        <div className="doc-bubble" role="toolbar" aria-label="Selection formatting"
             style={{ position: 'fixed', top: Math.max(8, bubble.top - 46),
                      left: Math.max(8, Math.min(bubble.left, (typeof window !== 'undefined' ? window.innerWidth : 9999) - 220)),
                      zIndex: 2147483647 }}>
          <button className={editor.isActive('bold') ? 'is-active' : ''} aria-label="Bold"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></button>
          <button className={editor.isActive('italic') ? 'is-active' : ''} aria-label="Italic"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></button>
          <button className={editor.isActive('underline') ? 'is-active' : ''} aria-label="Underline"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></button>
          <button className={editor.isActive('highlight') ? 'is-active' : ''} aria-label="Highlight"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => editor.chain().focus().toggleHighlight().run()}>H</button>
          <button aria-label="Link"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => openLinkPicker(editor)}>🔗</button>
        </div>
      )}
      <DocTagGutter
        editor={editor}
        ranges={appliedTagRanges}
        onOpen={(e, range, opts) => {
          const anchor = e?.currentTarget?.getBoundingClientRect?.()
            || e?.target?.getBoundingClientRect?.()
            || null;
          console.info('[doc-tag-gutter] onOpen fired — anchor:', !!anchor, 'tag:', range.tagName);
          if (!anchor) return;
          cancelHoverTimers();
          setLinkHover(null);
          setTagHover({
            anchor,
            tagId: range.tagId,
            tagName: range.tagName,
            tagColor: range.tagColor,
            source: range.source,
            sourceAnchor: {
              pHash: range.pHash,
              startOffset: range.startOffset,
              length: range.length,
            },
          });
        }}
      />
      <DocCandidateGutter
        editor={editor}
        editable={editable}
        onConfirm={(cand, anchor) => {
          // ✓ — open the type picker right at the gutter button. Picking a
          // type runs promoteCandidate (reads candidatePrompt) → tagDocRange
          // pins the exact span via cand.el, same as tapping the word.
          cancelHoverTimers();
          setLinkHover(null);
          setTagHover(null);
          setCandidatePrompt({
            anchor,
            name: cand.name,
            count: cand.count,
            sample: cand.sample,
            el: cand.el,
          });
        }}
        onDismiss={(cand) => dismissCandidate(cand)}
      />
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
      {tagHover && (
        <TagRangeHoverPopover
          anchor={tagHover.anchor}
          tagId={tagHover.tagId}
          tagName={tagHover.tagName}
          tagColor={tagHover.tagColor}
          source={tagHover.source}
          workspaceId={workspaceId}
          sourceAnchor={tagHover.sourceAnchor}
          onRemove={editable && tagHover.sourceAnchor && scope?.docCardId ? async (anchor) => {
            setTagHover(null);
            try {
              await untagDocRange({
                workspaceId,
                docCardId: scope.docCardId,
                pageId,
                tagId: tagHover.tagId,
                sourceAnchor: anchor,
              });
            } catch (err) {
              feedback.toast({ type: 'error', message: 'Remove tag failed: ' + (err.message || err) });
            }
          } : null}
          onMouseEnter={cancelHoverTimers}
          onMouseLeave={() => { hoverTimers.current.close = setTimeout(() => setTagHover(null), 200); }}
          onClose={() => setTagHover(null)}
        />
      )}
      {candidatePrompt && editable && (
        <CandidatePromptPopover
          anchor={candidatePrompt.anchor}
          name={candidatePrompt.name}
          count={candidatePrompt.count}
          sample={candidatePrompt.sample}
          busy={candidateBusy}
          onPromote={promoteCandidate}
          onDismiss={dismissCandidate}
          onClose={() => setCandidatePrompt(null)}
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
          onCancel={() => {
            // Restore the text selection the picker was opened over, so the
            // caret/highlight isn't lost on Escape / click-outside.
            const ed = editorRef.current;
            if (ed && linkPicker && linkPicker.from != null) {
              try { ed.chain().focus().setTextSelection({ from: linkPicker.from, to: linkPicker.to }).run(); } catch (_) {}
            }
            setLinkPicker(null);
          }}
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
      {/* Comments are a collaboration surface — hidden entirely for
          anonymous public viewers (a reply would only write to their
          throwaway local snapshot and silently vanish). */}
      {!isPublic && (
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
      )}
      {!isPublic && openThread && (
        <CommentInlinePopover
          ydoc={ydoc} scope={scope} threadId={openThread.id}
          anchor={openThread.anchor} currentUser={currentUser}
          onClose={() => setOpenThread(null)}
        />
      )}
    </div>
  );
}

// Right-click context menu — concise; quick formatting + comment + remove tag.
// Headings/lists/quote/highlight/code/strikethrough live on the always-visible
// top toolbar so they're not duplicated here.
function DocEditorContextMenu({ editor, onOpenLinkPicker, onAddComment, closeTagHover, onRemoveTag }) {
  const [pos, setPos] = useState(null);
  useEffect(() => {
    const root = editor?.view?.dom;
    if (!root) return;
    const onCtx = (e) => {
      // Only intercept when the cursor is inside the editor itself.
      e.preventDefault();
      // Close any hover popover (esp. the tag popover) so it doesn't
      // overlap the right-click menu.
      closeTagHover?.();
      // Capture tag-range data if the click landed on a tagged word so
      // we can offer "Remove tag" for it. Reuse readTagRangeFromEl —
      // same helper the popover uses — to keep parsing consistent.
      const tagRange = readTagRangeFromEl(e.target);
      const tagInfo = tagRange && tagRange.tagId && tagRange.sourceAnchor
        ? { tagId: tagRange.tagId, tagName: tagRange.tagName, sourceAnchor: tagRange.sourceAnchor }
        : null;
      setPos({
        x: e.clientX, y: e.clientY,
        hasSelection: !editor.state.selection.empty,
        tagInfo,
      });
    };
    root.addEventListener('contextmenu', onCtx);
    return () => root.removeEventListener('contextmenu', onCtx);
  }, [editor, closeTagHover]);
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
  const W = 220, H = 220, PAD = 8;
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
      <Sep />
      <Item icon={<LinkIcon />} label="Link" shortcut="⌘K"
            onClick={run(() => onOpenLinkPicker?.(editor))} />
      <div className="doc-ctx-color-row" role="group" aria-label="Text color">
        <span className="doc-ctx-color-label">Color</span>
        {['#f5f5f7', '#ffa500', '#cf6a4f', '#7c5cc9', '#5b8fc7', '#3fa39a', '#10b981'].map(c => (
          <button key={c}
                  type="button"
                  className="doc-ctx-color-dot"
                  style={{ background: c }}
                  title={`Text color ${c}`}
                  onClick={run(() => editor.chain().focus().setColor(c).run())} />
        ))}
        <button type="button"
                className="doc-ctx-color-dot doc-ctx-color-clear"
                title="Clear color"
                onClick={run(() => editor.chain().focus().unsetColor().run())}>×</button>
        <label className="doc-ctx-color-dot doc-ctx-color-custom" title="Custom color">
          <input type="color"
                 onChange={(e) => { editor.chain().focus().setColor(e.target.value).run(); close(); }} />
          <span aria-hidden="true">⋯</span>
        </label>
      </div>
      {pos.hasSelection && (
        <>
          <Sep />
          <Item icon={<CommentIcon />} label="Add comment" shortcut="⌘⌥M"
                onClick={run(() => onAddComment?.())} />
        </>
      )}
      {pos.tagInfo && onRemoveTag && (
        <>
          <Sep />
          <Item icon={<RemoveTagIcon />}
                label={pos.tagInfo.tagName ? `Remove "${pos.tagInfo.tagName}"` : 'Remove tag'}
                danger
                onClick={run(() => onRemoveTag(pos.tagInfo))} />
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
const RemoveTagIcon = () => svg({}, <><path d="M2 7 L7 2 H11 V6 L6 11 Z" /><circle cx="9" cy="4" r=".7" fill="currentColor" stroke="none" /><path d="M4 9 L8 13 M8 9 L4 13" strokeWidth="1.6" /></>);

// Maps a Trie record (from the auto-detect index) to an EntityPicker target shape.
function recordToTarget(r) {
  if (r.kind === 'board') return { kind: 'board', id: r.id };
  if (r.kind === 'doc')   return { kind: 'doc', docCardId: r.id };
  return { kind: 'card', boardId: r.boardId, cardId: r.id };
}
