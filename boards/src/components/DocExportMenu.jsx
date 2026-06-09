// Export the active doc as HTML, Markdown, or print-to-PDF.
//
// HTML: uses editor.getHTML() wrapped in a minimal printable shell so all
// docs export with consistent typography regardless of the user's theme.
// Markdown: walks the editor JSON and serializes to GFM (good-enough subset).
// PDF: window.print() of the same printable shell — user picks "Save as PDF"
// in the system dialog.

import { useEffect, useRef, useState } from 'react';

export function DocExportMenu({ editor, docName }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const safeName = (docName || 'document').replace(/[^a-z0-9-_ ]/gi, '_').slice(0, 80);

  const downloadBlob = (blob, ext) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${safeName}.${ext}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const printableHTML = (bodyHTML) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(safeName)}</title>
<style>
  body { font-family: ui-serif, Georgia, "Iowan Old Style", serif; font-size: 12pt; line-height: 1.6; color: #111; max-width: 720px; margin: 40px auto; padding: 0 20px; }
  h1 { font-size: 28pt; margin: 1.2em 0 .3em; }
  h2 { font-size: 20pt; margin: 1.2em 0 .3em; }
  h3 { font-size: 15pt; margin: 1em 0 .3em; }
  h4, h5, h6 { margin: 1em 0 .3em; }
  p { margin: .5em 0; }
  ul, ol { padding-left: 24px; }
  blockquote { border-left: 3px solid #ccc; padding: .2em 12px; color: #444; font-style: italic; }
  code { background: #f4f4f5; border-radius: 3px; padding: 1px 4px; font-family: ui-monospace, monospace; }
  pre { background: #f4f4f5; border-radius: 6px; padding: 12px; overflow: auto; }
  pre code { background: transparent; padding: 0; }
  hr { border: 0; border-top: 1px solid #ddd; margin: 1.6em 0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 6px 9px; text-align: left; }
  th { background: #f4f4f5; }
  img { max-width: 100%; height: auto; border-radius: 4px; }
  a { color: #2563eb; }
  mark { background: #fff7a8; }
  ul[data-type="taskList"] { list-style: none; padding-left: 4px; }
  ul[data-type="taskList"] li { display: flex; gap: 8px; align-items: flex-start; }
</style></head><body>${bodyHTML}</body></html>`;

  const exportHTML = () => {
    if (!editor) return;
    const bodyHTML = editor.getHTML();
    downloadBlob(new Blob([printableHTML(bodyHTML)], { type: 'text/html' }), 'html');
    setOpen(false);
  };

  const exportMarkdown = () => {
    if (!editor) return;
    const md = jsonToMarkdown(editor.getJSON());
    downloadBlob(new Blob([md], { type: 'text/markdown' }), 'md');
    setOpen(false);
  };

  const exportPDF = () => {
    if (!editor) return;
    const bodyHTML = editor.getHTML();
    const w = window.open('', '_blank', 'noopener');
    if (!w) return;
    w.document.write(printableHTML(bodyHTML));
    w.document.close();
    // Trigger the system print dialog — user chooses "Save as PDF".
    setTimeout(() => { try { w.focus(); w.print(); } catch (_) {} }, 300);
    setOpen(false);
  };

  return (
    <span className="doc-export-wrap" ref={ref}>
      <button className="doc-tb-btn" title="Export" aria-label="Export"
              aria-haspopup="menu" aria-expanded={open}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setOpen(o => !o)}
              disabled={!editor}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 2 V9 M4 6 L7 9 L10 6" />
          <path d="M3 11 H11" />
        </svg>
      </button>
      {open && (
        <div className="doc-export-menu" role="menu">
          <button onClick={exportHTML}>Export HTML</button>
          <button onClick={exportMarkdown}>Export Markdown</button>
          <button onClick={exportPDF}>Print / Save as PDF</button>
        </div>
      )}
    </span>
  );
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
}

// Tiptap JSON → GFM-flavored Markdown. Covers the blocks our editor produces:
// paragraph, heading, bulletList/orderedList/taskList, listItem, taskItem,
// blockquote, codeBlock, code (inline), bold, italic, strike, underline (HTML),
// link, image, hardBreak, horizontalRule, table.
function jsonToMarkdown(doc) {
  const out = [];
  const renderInline = (nodes = []) => nodes.map(renderInlineNode).join('');
  const renderInlineNode = (n) => {
    if (n.type === 'text') return wrapMarks(n.text || '', n.marks || []);
    if (n.type === 'hardBreak') return '  \n';
    if (n.type === 'image') return `![${n.attrs?.alt || ''}](${n.attrs?.src || ''})`;
    return '';
  };
  const wrapMarks = (text, marks) => {
    let s = text;
    for (const m of marks) {
      if (m.type === 'bold') s = `**${s}**`;
      else if (m.type === 'italic') s = `*${s}*`;
      else if (m.type === 'strike') s = `~~${s}~~`;
      else if (m.type === 'code') s = `\`${s}\``;
      else if (m.type === 'underline') s = `<u>${s}</u>`;
      else if (m.type === 'link') s = `[${s}](${m.attrs?.href || ''})`;
      else if (m.type === 'highlight') s = `==${s}==`;
    }
    return s;
  };
  const renderBlock = (node, depth = 0) => {
    if (!node) return;
    switch (node.type) {
      case 'doc': (node.content || []).forEach(c => renderBlock(c, depth)); break;
      case 'paragraph': out.push(renderInline(node.content)); out.push(''); break;
      case 'heading': {
        const lvl = node.attrs?.level || 1;
        out.push('#'.repeat(Math.min(6, lvl)) + ' ' + renderInline(node.content));
        out.push('');
        break;
      }
      case 'bulletList': (node.content || []).forEach((li, i) => renderListItem(li, '-', depth)); out.push(''); break;
      case 'orderedList': (node.content || []).forEach((li, i) => renderListItem(li, `${i + 1}.`, depth)); out.push(''); break;
      case 'taskList': (node.content || []).forEach(li => renderTaskItem(li, depth)); out.push(''); break;
      case 'blockquote': (node.content || []).forEach(c => {
        const before = out.length;
        renderBlock(c, depth);
        for (let i = before; i < out.length; i++) out[i] = '> ' + out[i];
      }); out.push(''); break;
      case 'codeBlock': {
        const lang = node.attrs?.language || '';
        const text = (node.content || []).map(c => c.text || '').join('');
        out.push('```' + lang); out.push(text); out.push('```'); out.push('');
        break;
      }
      case 'horizontalRule': out.push('---'); out.push(''); break;
      case 'image': out.push(`![${node.attrs?.alt || ''}](${node.attrs?.src || ''})`); out.push(''); break;
      case 'table': renderTable(node); out.push(''); break;
      default: if (node.content) (node.content).forEach(c => renderBlock(c, depth));
    }
  };
  const renderListItem = (li, marker, depth) => {
    const indent = '  '.repeat(depth);
    const inner = [];
    (li.content || []).forEach((child) => {
      if (child.type === 'paragraph') inner.push(renderInline(child.content));
      else {
        const buf = []; const save = out.length;
        renderBlock(child, depth + 1);
        const lines = out.splice(save).filter(Boolean);
        inner.push(lines.join('\n'));
      }
    });
    out.push(indent + marker + ' ' + (inner[0] || ''));
    for (let i = 1; i < inner.length; i++) out.push(indent + '  ' + inner[i]);
  };
  const renderTaskItem = (li, depth) => {
    const indent = '  '.repeat(depth);
    const checked = li.attrs?.checked ? '[x]' : '[ ]';
    const text = (li.content || [])
      .filter(c => c.type === 'paragraph')
      .map(c => renderInline(c.content)).join(' ');
    out.push(indent + '- ' + checked + ' ' + text);
  };
  const renderTable = (table) => {
    const rows = (table.content || []).map(row =>
      (row.content || []).map(cell =>
        (cell.content || []).map(c => renderInline(c.content || [])).join(' ')
      )
    );
    if (!rows.length) return;
    out.push('| ' + rows[0].join(' | ') + ' |');
    out.push('|' + rows[0].map(() => '---').join('|') + '|');
    for (let i = 1; i < rows.length; i++) out.push('| ' + rows[i].join(' | ') + ' |');
  };
  renderBlock(doc);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
