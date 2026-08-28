import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from './Modal.jsx';
import { GridLayoutThumb } from './GridLayoutThumb.jsx';
import { computeCellRects, readingOrder } from '../lib/gridLayout.js';
import { HINT_LIMITS } from '../lib/gridLayoutLibrary.js';
import './saveTemplateDialog.css';

// Save-as-template, with optional per-cell labels.
//
// This is a real dialog rather than feedback.prompt because naming eight boxes
// needs eight fields, and — more importantly — needs the diagram beside them.
// "Field 2" means nothing without being able to see which box is the second
// one, so focusing or hovering a field lights its cell in the preview and vice
// versa. That pairing is the entire reason this component exists.
//
// Every label is optional, including all of them: a template with no labels is
// the normal case and must stay a two-keystroke save. The name is the only
// required field.
//
// Publishing lives HERE, as one checkbox, rather than behind a ··· menu you find
// later. Sharing a template is a thought you have while making it, and a store
// nobody can stock is not a store — burying the only way to contribute three
// clicks deep is what made publishing feel like posting into a side channel.
//
// Cells are listed in READING ORDER, which is how hints are indexed and how
// people count boxes — not the depth-first order the tree stores them in.

export function SaveTemplateDialog({ open, layout, defaultName = '', canPublish = false, onCancel, onSave }) {
  const [name, setName] = useState(defaultName);
  const [hints, setHints] = useState([]);
  const [active, setActive] = useState(-1);
  const [publish, setPublish] = useState(false);
  const [description, setDescription] = useState('');
  const nameRef = useRef(null);

  const cellCount = useMemo(() => {
    if (!layout) return 0;
    return readingOrder(computeCellRects(layout, { x: 0, y: 0, w: 100, h: 100 })).length;
  }, [layout]);

  // Reset whenever the dialog opens on a different grid, so the last grid's
  // labels can't bleed into this one.
  useEffect(() => {
    if (!open) return;
    setName(defaultName);
    setHints(Array(cellCount).fill(''));
    setActive(-1);
    // Publishing is opt-in every time. A sticky checkbox would eventually
    // publish something the person did not mean to make public.
    setPublish(false);
    setDescription('');
  }, [open, defaultName, cellCount]);

  if (!open) return null;

  const labelled = hints.filter((h) => h.trim()).length;
  const canSave = !!name.trim();

  const submit = (e) => {
    e?.preventDefault?.();
    if (!canSave) return;
    onSave({
      name: name.trim(),
      hints,
      publish: canPublish && publish,
      description: description.trim(),
    });
  };

  return (
    <Modal open={open} onClose={onCancel} className="savetpl" backdropClassName="savetpl-back"
           labelledBy="savetpl-title" initialFocusRef={nameRef}>
      <form onSubmit={submit}>
        <div className="savetpl-head">
          <div className="savetpl-kicker">Templates</div>
          <div className="savetpl-title" id="savetpl-title">Save as template</div>
        </div>

        <div className="savetpl-body">
          <label className="savetpl-field">
            <span className="savetpl-label">Name</span>
            <input
              ref={nameRef}
              className="savetpl-input"
              value={name}
              maxLength={80}
              placeholder="Storyboard page"
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <div className="savetpl-cells">
            <div className="savetpl-cells-head">
              <span className="savetpl-label">Label the boxes</span>
              <span className="savetpl-optional">
                {labelled ? `${labelled} of ${cellCount} labelled` : 'Optional'}
              </span>
            </div>
            <p className="savetpl-help">
              Shown in grey inside each empty box, and gone as soon as there is
              something in it. Never part of the content.
            </p>

            <div className="savetpl-split">
              <div className="savetpl-preview" aria-hidden="true">
                <GridLayoutThumb tree={layout} title={name} numbered highlight={active} />
              </div>

              <ol className="savetpl-list">
                {Array.from({ length: cellCount }, (_, i) => (
                  <li key={i} className={active === i ? 'is-active' : undefined}>
                    <span className="savetpl-num" aria-hidden="true">{i + 1}</span>
                    <input
                      className="savetpl-input savetpl-hint"
                      value={hints[i] || ''}
                      maxLength={HINT_LIMITS.MAX_LEN}
                      placeholder={i === 0 ? 'e.g. WIDE SHOT' : ''}
                      // Both pointer and keyboard light the matching cell — a
                      // keyboard user tabbing through fields needs the diagram
                      // to follow just as much as a mouse user does.
                      aria-label={`Label for box ${i + 1}`}
                      onFocus={() => setActive(i)}
                      onBlur={() => setActive((cur) => (cur === i ? -1 : cur))}
                      onMouseEnter={() => setActive(i)}
                      onMouseLeave={() => setActive((cur) => (cur === i ? -1 : cur))}
                      onChange={(e) => setHints((prev) => {
                        const next = prev.slice();
                        next[i] = e.target.value;
                        return next;
                      })}
                    />
                  </li>
                ))}
              </ol>
            </div>
          </div>

          {/* The store needs at least two boxes to accept a template — the
              same gate submit_grid_layout_to_public enforces (0266), stated
              here so the checkbox is not offered on something that would be
              rejected after the fact. */}
          {canPublish && cellCount >= 2 && (
            <div className="savetpl-share">
              <label className="savetpl-check">
                <input
                  type="checkbox"
                  checked={publish}
                  onChange={(e) => setPublish(e.target.checked)}
                />
                <span>Share it in the store</span>
              </label>
              <p className="savetpl-help">
                Anyone can find it at /templates and add it. They get their own copy,
                so removing yours later never reaches into anybody else's library.
                Only the shape and the labels are shared — never your content.
              </p>
              {publish && (
                <label className="savetpl-field">
                  <span className="savetpl-label">One line about it</span>
                  <input
                    className="savetpl-input"
                    value={description}
                    maxLength={140}
                    placeholder="Three locations, three frames each — wide, detail, light."
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </label>
              )}
            </div>
          )}
        </div>

        <div className="savetpl-actions">
          <button type="button" className="savetpl-btn" onClick={onCancel}>Cancel</button>
          <button type="submit" className="savetpl-btn savetpl-btn-primary" disabled={!canSave}>
            {canPublish && publish ? 'Save and share' : 'Save template'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
