// The editable, on-page screenplay title page — a real 8.5×11 sheet rendered
// as the first "page" of a screenplay (before the script body). Click any
// field and type directly on it, Final-Draft style. Backed by docMeta
// (getTitlePage/setTitlePage) so it persists with the snapshot + collaborates;
// it is NOT a ProseMirror surface (so it stays out of the paginator and the
// canvas undo manager). The same data renders identically in the PDF/print
// shell and round-trips through Fountain/FDX.
//
// Controlled: the parent (DocSurface) owns the observed `titlePage` object and
// the `onCommit(patch)` writer, so there is a single docMeta observer.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

// One transparent, auto-growing field that looks like text typed on the page.
function TitleField({ value, placeholder, onCommit, className, ariaLabel, editable, multiline }) {
  const ref = useRef(null);
  const focusedRef = useRef(false);
  const timerRef = useRef(null);
  const [local, setLocal] = useState(value || '');

  // Sync down from the collaborative value — but never while focused, so a
  // peer's edit (or our own debounced write echoing back) can't yank the caret.
  useEffect(() => {
    if (!focusedRef.current) setLocal(value || '');
  }, [value]);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  useLayoutEffect(() => { resize(); }, [local, resize, editable]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  if (!editable) {
    // Read-only (public viewer / no edit) — render the text, or nothing.
    if (!value) return null;
    return <div className={`sp-tp-field sp-tp-static ${className || ''}`}>{value}</div>;
  }

  const debouncedCommit = (v) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { onCommit(v); }, 400);
  };

  return (
    <textarea
      ref={ref}
      className={`sp-tp-field ${className || ''}`}
      rows={1}
      spellCheck={false}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={local}
      onFocus={() => { focusedRef.current = true; }}
      onChange={(e) => { setLocal(e.target.value); debouncedCommit(e.target.value); }}
      onBlur={() => {
        focusedRef.current = false;
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
        onCommit(local);
      }}
      onKeyDown={(e) => {
        // Don't let the doc/canvas global shortcuts (or the modal's Escape =
        // close) fire while typing in a title field.
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur(); return; }
        // Single-line fields commit on Enter instead of inserting a newline.
        if (!multiline && e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
      }}
    />
  );
}

export function ScreenplayTitlePage({ titlePage, onCommit, editable = true }) {
  const tp = titlePage || {};
  const set = useCallback((patch) => onCommit?.(patch), [onCommit]);

  return (
    <div className="doc-editor-wrap sp-title-page" data-sp-title-page="1">
      <div className="sp-tp-center">
        <TitleField className="sp-tp-title" value={tp.title} placeholder="TITLE"
                    editable={editable} ariaLabel="Title"
                    onCommit={(v) => set({ title: v })} />
        <TitleField className="sp-tp-credit" value={tp.credit} placeholder="Written by"
                    editable={editable} ariaLabel="Credit"
                    onCommit={(v) => set({ credit: v })} />
        <TitleField className="sp-tp-authors" value={tp.authors} placeholder="Author" multiline
                    editable={editable} ariaLabel="Author"
                    onCommit={(v) => set({ authors: v })} />
        <TitleField className="sp-tp-source" value={tp.source} placeholder="Based on…" multiline
                    editable={editable} ariaLabel="Source"
                    onCommit={(v) => set({ source: v })} />
      </div>

      <div className="sp-tp-foot">
        <div className="sp-tp-foot-left">
          <TitleField className="sp-tp-contact" value={tp.contact} placeholder="Contact" multiline
                      editable={editable} ariaLabel="Contact"
                      onCommit={(v) => set({ contact: v })} />
          <TitleField className="sp-tp-copyright" value={tp.copyright} placeholder="© / rights" multiline
                      editable={editable} ariaLabel="Copyright"
                      onCommit={(v) => set({ copyright: v })} />
        </div>
        <div className="sp-tp-foot-right">
          <TitleField className="sp-tp-draft" value={tp.draftDate} placeholder="Draft date"
                      editable={editable} ariaLabel="Draft date"
                      onCommit={(v) => set({ draftDate: v })} />
          <TitleField className="sp-tp-notes" value={tp.notes} placeholder="Notes" multiline
                      editable={editable} ariaLabel="Notes"
                      onCommit={(v) => set({ notes: v })} />
        </div>
      </div>
    </div>
  );
}
