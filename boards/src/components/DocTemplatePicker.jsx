// First-open template picker for brand-new docs. Shown when a doc has zero
// pages. Selecting a template seeds the page tree + content; "Skip" creates
// a single empty page. Closes by clicking outside or pressing Esc.

import { useEffect } from 'react';
import { DOC_TEMPLATES } from '../lib/docTemplates.js';

// Tiny visual preview for each template card. Each id renders a different
// layout sketch (single column, table, dated journal, multi-page stack, etc.)
// so the picker doesn't read as N identical placeholders.
function TemplateMini({ tpl }) {
  const id = tpl.id;
  const sw = tpl.swatches || [];
  if (id === 'blank') {
    return <div className="doc-tpl-mini doc-tpl-mini-blank" />;
  }
  if (id === 'treatment') {
    return (
      <div className="doc-tpl-mini">
        <div className="doc-tpl-mini-h" style={{ width: '50%' }} />
        <div className="doc-tpl-mini-rule" />
        <div className="doc-tpl-mini-quote" />
        <div className="doc-tpl-mini-bar" />
        <div className="doc-tpl-mini-bar" style={{ width: '88%' }} />
        <div className="doc-tpl-mini-bar" style={{ width: '60%' }} />
        <div className="doc-tpl-mini-swatches">
          {sw.map((c, i) => <span key={i} style={{ background: c }} />)}
        </div>
      </div>
    );
  }
  if (id === 'shotlist') {
    return (
      <div className="doc-tpl-mini">
        <div className="doc-tpl-mini-h" style={{ width: '40%' }} />
        <div className="doc-tpl-mini-table">
          <div /><div /><div /><div />
          <div /><div /><div /><div />
          <div /><div /><div /><div />
        </div>
      </div>
    );
  }
  if (id === 'onepager') {
    return (
      <div className="doc-tpl-mini" style={{ background: sw[0] || 'var(--bg-1)' }}>
        <div className="doc-tpl-mini-h" style={{ width: '34%', background: sw[2] || 'var(--ink-0)' }} />
        <div className="doc-tpl-mini-quote" style={{ background: sw[1] || 'var(--line-3)' }} />
        <div className="doc-tpl-mini-bar" style={{ background: sw[2] || 'var(--ink-0)', opacity: .55 }} />
        <div className="doc-tpl-mini-bar" style={{ background: sw[2] || 'var(--ink-0)', opacity: .55, width: '70%' }} />
      </div>
    );
  }
  if (id === 'journal') {
    return (
      <div className="doc-tpl-mini" style={{ background: sw[0] || 'var(--bg-1)' }}>
        <div className="doc-tpl-mini-h" style={{ width: '60%', background: sw[1] || 'var(--ink-0)' }} />
        <div className="doc-tpl-mini-rule" />
        <div className="doc-tpl-mini-bar" style={{ background: sw[1] || 'var(--ink-0)', opacity: .4, width: '24%' }} />
        <div className="doc-tpl-mini-bar" style={{ width: '88%' }} />
        <div className="doc-tpl-mini-bar" style={{ background: sw[1] || 'var(--ink-0)', opacity: .4, width: '30%' }} />
        <div className="doc-tpl-mini-bar" style={{ width: '70%' }} />
      </div>
    );
  }
  if (id === 'production') {
    return (
      <div className="doc-tpl-mini doc-tpl-mini-stack">
        <div className="doc-tpl-mini-page" />
        <div className="doc-tpl-mini-page doc-tpl-mini-page-2" />
        <div className="doc-tpl-mini-page doc-tpl-mini-page-3" />
        <div className="doc-tpl-mini-swatches">
          {sw.map((c, i) => <span key={i} style={{ background: c }} />)}
        </div>
      </div>
    );
  }
  if (id === 'moodnotes') {
    return (
      <div className="doc-tpl-mini">
        <div className="doc-tpl-mini-h" style={{ width: '40%' }} />
        <div className="doc-tpl-mini-grid">
          {sw.map((c, i) => <span key={i} style={{ background: c }} />)}
          {Array.from({ length: 8 - sw.length }).map((_, i) => <span key={'g' + i} />)}
        </div>
      </div>
    );
  }
  if (id === 'spec') {
    return (
      <div className="doc-tpl-mini">
        <div className="doc-tpl-mini-h" style={{ width: '24%' }} />
        <div className="doc-tpl-mini-bar" />
        <div className="doc-tpl-mini-h" style={{ width: '20%', marginTop: 8 }} />
        <div className="doc-tpl-mini-bar" style={{ width: '70%' }} />
        <div className="doc-tpl-mini-h" style={{ width: '28%', marginTop: 8 }} />
        <div className="doc-tpl-mini-bar" style={{ width: '90%' }} />
      </div>
    );
  }
  return <div className="doc-tpl-mini doc-tpl-mini-blank" />;
}
import { addPage, getOrCreatePageContent } from '../lib/docState.js';
import { getSchema } from '@tiptap/core';
import { prosemirrorJSONToYXmlFragment } from 'y-prosemirror';
import { baseDocExtensions } from './docExtensions/baseExtensions.js';

export function DocTemplatePicker({ ydoc, scope, onPicked, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const apply = (tpl) => {
    const schema = getSchema(baseDocExtensions);
    let firstId = null;
    ydoc.transact(() => {
      for (const page of tpl.pages) {
        const id = addPage(ydoc, { name: page.name, scope });
        if (!firstId) firstId = id;
        try {
          const frag = getOrCreatePageContent(ydoc, id, scope);
          prosemirrorJSONToYXmlFragment(schema, page.content, frag);
        } catch (e) {
          console.warn('template seed failed', e);
        }
      }
    }, 'local');
    onPicked?.(firstId);
  };

  return (
    <div className="doc-tplbg" onClick={onClose}>
      <div className="doc-tpl" onClick={(e) => e.stopPropagation()}>
        <div className="doc-tpl-head">
          <div>
            <div className="doc-tpl-kicker">New doc</div>
            <div className="doc-tpl-title">Pick a starting point</div>
          </div>
          <button className="doc-tpl-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="doc-tpl-grid">
          {DOC_TEMPLATES.map(t => (
            <button key={t.id} className="doc-tpl-card" onClick={() => apply(t)}>
              <TemplateMini tpl={t} />
              <div className="doc-tpl-card-name">{t.label}</div>
              <div className="doc-tpl-card-blurb">{t.blurb}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
