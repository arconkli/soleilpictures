// Scene navigator for screenplay mode — a left-rail outline of every scene
// heading (with its number) that jumps the editor to that scene on click.
// Mirrors the page tree's role for prose docs. Reads the live editor doc, and
// redraws only when a scene heading or its number changes — not on every key
// typed in a speech.

import { useEditorState } from '@tiptap/react';
import { computeSceneNumbers } from './docExtensions/screenplay/screenplayFlow.js';

// Numbering via the SAME engine as the gutters and the PDF
// (computeSceneNumbers: auto by order, or locked A/B once any scene carries
// a stamped number) — a naive ordinal here diverged the moment an imported
// FDX locked some numbers (gutters read 1, 1A, 2 while the rail read 1, 2, 3).
// It numbers scene headings only, so it's handed only those. Read once per
// doc: a caret move keeps the doc, and reads nothing.
const NO_SCENES = [];
const scenesByDoc = new WeakMap();
function readScenes(doc) {
  let scenes = scenesByDoc.get(doc);
  if (scenes) return scenes;
  const heads = [];
  doc.forEach((node) => {
    if (node.type.name !== 'screenplayBlock' || node.attrs.element !== 'scene') return;
    heads.push({ element: 'scene', sceneNumber: node.attrs.sceneNumber || null, text: node.textContent });
  });
  const nums = computeSceneNumbers(heads);
  scenes = heads.map((h, i) => ({ num: nums.get(i), text: (h.text || '').trim() || 'Untitled scene' }));
  scenesByDoc.set(doc, scenes);
  return scenes;
}

export function ScreenplaySceneNav({ editor, titlePageEnabled = false, onJumpTitlePage }) {
  const scenes = useEditorState({ editor, selector: () => (editor ? readScenes(editor.state.doc) : NO_SCENES) });

  // Resolve the scene's CURRENT position at click time — a collaborator's edit
  // above it since the last render would otherwise send the caret into the
  // wrong block (render-time positions go stale silently).
  const jump = (sceneIdx) => {
    if (!editor) return;
    let pos = null;
    let seen = -1;
    editor.state.doc.descendants((node, p) => {
      if (pos == null && node.type.name === 'screenplayBlock' && node.attrs.element === 'scene') {
        seen += 1;
        if (seen === sceneIdx) pos = p;
      }
      return pos == null;
    });
    if (pos == null) return;
    editor.chain().focus().setTextSelection(pos + 1).run();
    try {
      const found = editor.view.domAtPos(pos + 1);
      const el = found?.node?.nodeType === 1 ? found.node : found?.node?.parentElement;
      el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    } catch (_) { /* position may be transient mid-edit */ }
  };

  return (
    <div className="sp-scenenav">
      <div className="sp-scenenav-head t-eyebrow">Scenes</div>
      {titlePageEnabled && (
        <button type="button" className="sp-scenenav-item sp-scenenav-title" onClick={() => onJumpTitlePage?.()}>
          Title Page
        </button>
      )}
      {scenes.length === 0 && <div className="sp-scenenav-empty">No scenes yet</div>}
      {scenes.map((s, i) => (
        <button type="button" key={`${s.num}:${i}`} className="sp-scenenav-item" onClick={() => jump(i)} title={s.text}>
          <span className="sp-scenenav-num">{s.num}</span>
          <span className="sp-scenenav-text">{s.text}</span>
        </button>
      ))}
    </div>
  );
}
