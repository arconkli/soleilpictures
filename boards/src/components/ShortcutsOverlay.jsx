// Keyboard-shortcuts overlay. Opened with "?" anywhere outside an editor,
// the toolbar's help button, or a `soleil-open-help` CustomEvent (same
// prop-drill-less pattern as soleil-open-tag). Content mirrors the real
// keymap in CanvasSurface — update both together.
//
// ShortcutsHost owns the state + listeners so any app shell (the real App,
// the ?local=1 QA app) gets the full behavior from a single mount.

import { useEffect, useState } from 'react';
import { Modal } from './Modal.jsx';
import { isEditableTarget } from '../lib/isEditableTarget.js';

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '');
const CMD = isMac ? '⌘' : 'Ctrl';

const SECTIONS = [
  {
    title: 'Tools',
    rows: [
      [['V'], 'Select / move'],
      [['H', 'Space'], 'Pan the canvas'],
      [['N'], 'Add a note'],
      [['D'], 'Free-draw'],
      [['A'], 'Arrow'],
      [['Esc'], 'Back to select · dismiss'],
    ],
  },
  {
    title: 'Edit',
    rows: [
      [[`${CMD}Z`, `${CMD}⇧Z`], 'Undo · redo'],
      [[`${CMD}C`, `${CMD}X`, `${CMD}V`], 'Copy · cut · paste'],
      [[`${CMD}D`], 'Duplicate'],
      [[`${CMD}A`], 'Select all'],
      [[`${CMD}G`], 'Group selection'],
      [['[', ']'], 'Send backward · forward'],
      [['⌫'], 'Delete selection'],
    ],
  },
  {
    title: 'View',
    rows: [
      [[`${CMD}0`], 'Reset zoom'],
      [[`${CMD}+`, `${CMD}−`], 'Zoom in · out'],
      [['⇧1'], 'Fit everything'],
      [['⇧2'], 'Fit selection'],
      [['Space-drag'], 'Pan (any tool)'],
    ],
  },
  {
    title: 'Notes',
    rows: [
      [['Double-click'], 'Edit a note or title'],
      [[`${CMD}B`, `${CMD}I`, `${CMD}U`], 'Bold · italic · underline'],
      [['@'], 'Mention a board, doc, or card'],
    ],
  },
  {
    title: 'Document',
    rows: [
      [['/'], 'Insert menu (blocks, table, image…)'],
      [[`${CMD}⌥1`, `${CMD}⌥0`], 'Heading 1 · body'],
      [[`${CMD}⇧7`, `${CMD}⇧8`, `${CMD}⇧9`], 'Numbered · bullet · task list'],
      [[`${CMD}⇧H`, `${CMD}E`], 'Highlight · inline code'],
      [[`${CMD}⇧L`, `${CMD}⇧E`, `${CMD}⇧R`], 'Align left · center · right'],
      [[`${CMD}K`, `${CMD}⌥M`], 'Link · comment'],
      [[`${CMD}F`], 'Find in document'],
      [['Tab', '⇧Tab'], 'Indent · outdent (screenplay: cycle element)'],
    ],
  },
];

const TIPS = [
  'Right-click the canvas or any card for more actions.',
  'Drag a card onto a board card to nest it inside.',
  `Hold Alt while dragging to ignore snapping; hold ${CMD} while resizing an image to break its aspect ratio.`,
];

export function ShortcutsHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e)) return;
      setOpen(v => {
        if (v) return false;
        // Don't open on top of another modal/dialog — stacked overlays
        // should keep the keyboard.
        if (document.querySelector('.modal-shell-bg, .feedback-bg, .settings-bg, .upgrade-backdrop')) return v;
        return true;
      });
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    document.addEventListener('soleil-open-help', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('soleil-open-help', onOpen);
    };
  }, []);
  return <ShortcutsOverlay open={open} onClose={() => setOpen(false)} />;
}

export function ShortcutsOverlay({ open, onClose }) {
  return (
    <Modal open={open} onClose={onClose} className="shortcuts-modal" ariaLabel="Keyboard shortcuts" showClose>
      <div className="shortcuts-hd">Keyboard shortcuts</div>
      <div className="shortcuts-grid">
        {SECTIONS.map((s) => (
          <section key={s.title} className="shortcuts-sec" aria-label={s.title}>
            <h3>{s.title}</h3>
            {s.rows.map(([keys, label]) => (
              <div key={label} className="shortcuts-row">
                <span className="shortcuts-keys">
                  {keys.map((k) => <kbd key={k}>{k}</kbd>)}
                </span>
                <span className="shortcuts-label">{label}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
      <div className="shortcuts-tips">
        <h3>Tips</h3>
        <ul>
          {TIPS.map((t) => <li key={t}>{t}</li>)}
        </ul>
      </div>
    </Modal>
  );
}
