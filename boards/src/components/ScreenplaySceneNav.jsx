// Scene navigator for screenplay mode — a left-rail outline of every scene
// heading (with its number) that jumps the editor to that scene on click.
// Mirrors the page tree's role for prose docs. Reads the live editor doc and
// refreshes on every edit.

import { useEffect, useState } from 'react';
import { computeSceneNumbers } from './docExtensions/screenplay/screenplayFlow.js';

export function ScreenplaySceneNav({ editor, titlePageEnabled = false, onJumpTitlePage }) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!editor) return undefined;
    const tick = () => force(n => n + 1);
    editor.on('update', tick);
    return () => { editor.off('update', tick); };
  }, [editor]);

  // Numbering via the SAME engine as the gutters and the PDF
  // (computeSceneNumbers: auto by order, or locked A/B once any scene carries
  // a stamped number) — a naive ordinal here diverged the moment an imported
  // FDX locked some numbers (gutters read 1, 1A, 2 while the rail read 1, 2, 3).
  const scenes = [];
  if (editor) {
    const blocks = [];
    editor.state.doc.forEach((node) => {
      const isSp = node.type.name === 'screenplayBlock';
      blocks.push({
        element: isSp ? (node.attrs.element || 'action') : 'action',
        sceneNumber: isSp ? (node.attrs.sceneNumber || null) : null,
        text: node.textContent,
      });
    });
    computeSceneNumbers(blocks).forEach((num, idx) => {
      scenes.push({ num, text: (blocks[idx].text || '').trim() || 'Untitled scene' });
    });
  }

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
