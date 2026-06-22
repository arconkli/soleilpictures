// Scene navigator for screenplay mode — a left-rail outline of every scene
// heading (with its number) that jumps the editor to that scene on click.
// Mirrors the page tree's role for prose docs. Reads the live editor doc and
// refreshes on every edit.

import { useEffect, useState } from 'react';

export function ScreenplaySceneNav({ editor, titlePageEnabled = false, onJumpTitlePage }) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!editor) return undefined;
    const tick = () => force(n => n + 1);
    editor.on('update', tick);
    return () => { editor.off('update', tick); };
  }, [editor]);

  const scenes = [];
  if (editor) {
    let n = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'screenplayBlock' && node.attrs.element === 'scene') {
        n += 1;
        scenes.push({ num: node.attrs.sceneNumber || String(n), text: (node.textContent || '').trim() || 'Untitled scene', pos });
      }
      return true;
    });
  }

  const jump = (pos) => {
    if (!editor) return;
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
        <button type="button" key={`${s.pos}:${i}`} className="sp-scenenav-item" onClick={() => jump(s.pos)} title={s.text}>
          <span className="sp-scenenav-num">{s.num}</span>
          <span className="sp-scenenav-text">{s.text}</span>
        </button>
      ))}
    </div>
  );
}
