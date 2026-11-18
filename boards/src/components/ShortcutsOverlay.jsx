// Keyboard-shortcuts overlay. Opened with "?" anywhere outside an editor,
// the toolbar's help button, or a `soleil-open-help` CustomEvent (a
// prop-drill-less pattern). Content mirrors the real
// keymap in CanvasSurface — update both together.
//
// ShortcutsHost owns the state + listeners so any app shell (the real App,
// the ?local=1 QA app) gets the full behavior from a single mount.

import { useEffect, useState } from 'react';
import { Modal } from './Modal.jsx';
import { isEditableTarget } from '../lib/isEditableTarget.js';
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { coarsePointer } from '../lib/noteTouchTyping.js';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '');
const CMD = isMac ? '⌘' : 'Ctrl';
// The key that turns a files drag into a copy (lib/dropRules.js copyKeyHeld):
// Option on a Mac; Ctrl elsewhere, where Alt copies too.
const COPY = isMac ? '⌥' : 'Ctrl';
// From a doc's or a note's text to its toolbar (hooks/useToolbarRoving).
const TO_BAR = isMac ? '⌥F10' : 'Alt+F10';

const SECTIONS = () => [
  {
    title: t`Tools`,
    rows: [
      [['V'], t`Select / move`],
      [['H', t({ message: 'Space', context: 'keyboard key' })], t`Pan the canvas`],
      [['N'], t`Add a note`],
      [['D'], t`Free-draw`],
      [['A'], t`Arrow`],
      [['G'], t`Add a grid`],
      [['C'], t`Add a cluster`],
      [[t({ message: 'Esc', context: 'keyboard key' })], t`Back to select · close what is on top`],
    ],
  },
  {
    title: t`Navigate`,
    rows: [
      [[`${CMD}K`, '/'], t`Search & commands`],
      [[`${CMD}B`], t`Toggle sidebar`],
      [[`${CMD}.`], t`Clean mode`],
    ],
  },
  {
    title: t`Sidebar`,
    rows: [
      [[t({ message: 'Enter', context: 'keyboard key' }), t({ message: 'Space', context: 'keyboard key' })], t`Open the focused cluster`],
      [['→', '←'], t`Expand · collapse`],
      [['F2'], t`Rename the cluster`],
      [['⇧F10', t({ message: 'Menu', context: 'keyboard key' })], t`The row menu`],
      [['↑', '↓'], t`Move through the clusters, or the files`],
      [[t({ message: 'Space', context: 'keyboard key' })], t`Quick look at the focused file`],
      [[t({ message: 'Enter', context: 'keyboard key' })], t`Go to the focused file: on its board, or in Files`],
      [[`${CMD}\\`], t`Hide · show Files`],
      [[t({ message: `${COPY}-drag`, context: 'keyboard key' })], t`Copy files instead of moving them`],
    ],
  },
  {
    title: t`Edit`,
    rows: [
      [[`${CMD}Z`, `${CMD}⇧Z`], t`Undo · redo`],
      [[`${CMD}C`, `${CMD}X`, `${CMD}V`], t`Copy · cut · paste`],
      // One selected card: what a double-click does (CanvasSurface cardEnterRef).
      [[t({ message: 'Enter', context: 'keyboard key' })], t`Open or edit the selected card`],
      [[`${CMD}D`], t`Duplicate`],
      [[`${CMD}A`], t`Select all`],
      [[`${CMD}G`], t`Group selection`],
      [['[', ']'], t`Send backward · forward`],
      [['⌫', t({ message: 'Del', context: 'keyboard key' })], t`Delete selection`],
    ],
  },
  {
    // A selected grid's boxes (CanvasSurface boxKeyRef).
    title: t`Grids`,
    rows: [
      [['←', '→', '↑', '↓'], t`Move between the boxes of the selected grid`],
      [[t({ message: 'Enter', context: 'keyboard key' })], t`Open the box: type in a text box, or its menu`],
      [['⌫', t({ message: 'Del', context: 'keyboard key' })], t`Clear the box (Undo brings it back)`],
      [[t({ message: 'Esc', context: 'keyboard key' })], t`Let go of the box, keeping the grid selected`],
    ],
  },
  {
    title: t({ message: 'View', context: 'noun' }),
    rows: [
      [['F'], t`Open or close the full Files page`],
      [[`${CMD}I`], t`Info — the selection, or the cluster when nothing is selected`],
      [[`${CMD}0`], t`Reset zoom`],
      [[`${CMD}+`, `${CMD}−`], t`Zoom in · out`],
      [['⇧1'], t`Fit everything`],
      [['⇧2'], t`Fit selection`],
      [[t({ message: 'Space-drag', context: 'keyboard key' })], t`Pan (any tool)`],
      [['W', 'A', 'S', 'D'], t`Move around, Shift for faster — turn on in Settings → Appearance`],
      [['Q', 'E'], t`Zoom in · out, with W A S D turned on`],
      [[t({ message: 'Scroll', context: 'keyboard key' })], t`Pan · zoom — swap in Settings → Appearance`],
      [[t({ message: `${CMD}-scroll`, context: 'keyboard key' })], t`Zoom at the pointer`],
    ],
  },
  {
    title: t`Files`,
    rows: [
      [['←', '→', '↑', '↓'], t`Move through files`],
      [[t({ message: 'Enter', context: 'keyboard key' })], t`Select the highlighted file`],
      [[t({ message: '⇧Space', context: 'keyboard key' })], t`Add the highlighted file to the selection · take it out`],
      [[t({ message: 'Space', context: 'keyboard key' })], t`Quick look — ← → step through, Space or Esc closes`],
      [[`${CMD}I`], t`Info for the selection, or the cluster`],
      [['F2'], t`Rename`],
      [['⇧F10'], t`The right-click menu`],
      [[`${CMD}A`], t`Select every file showing`],
      [[t({ message: 'Esc', context: 'keyboard key' })], t`Clear the selection`],
      [['⌫'], t`Delete the selection`],
      [[`${CMD}Z`, `${CMD}⇧Z`], t`Undo · redo`],
    ],
  },
  {
    title: t`Audio`,
    rows: [
      [[t({ message: 'Enter', context: 'keyboard key' })], t`Play · pause the selected clip`],
      [['L'], t`Loop the selected clip`],
      [[t({ message: 'Space', context: 'keyboard key' })], t`Audition the highlighted row (Files, list layout)`],
    ],
  },
  {
    // The review player (components/film/), while it's open. Mirrors
    // lib/playerKeys.js.
    title: t`Player`,
    rows: [
      [[t({ message: 'Space', context: 'keyboard key' })], t`Play · pause`],
      [['J', 'K', 'L'], t`Play backward · stop · forward — again to go faster`],
      [['K+J', 'K+L'], t`Tap: one frame back · forward. Hold: play slowly`],
      [['←', '→'], t`One frame back · forward`],
      [[',', '.'], t`One frame back · forward`],
      [['⇧←', '⇧→'], t`One second back · forward`],
      [[t({ message: 'Home', context: 'keyboard key' }), t({ message: 'End', context: 'keyboard key' })], t`First · last frame`],
      [['⇧<', '⇧>'], t`Slower · faster`],
      [['0–9'], t`Type a timecode, frame or seconds to jump to`],
      [['I', 'O'], t`Set in · out`],
      [['⇧I', '⇧O'], t`Go to in · out`],
      [[t({ message: '⇧Space', context: 'keyboard key' })], t`Play from in to out`],
      [['⌥L'], t`Loop (between in and out, or the whole clip)`],
      [['⌥X'], t`Clear in and out`],
      [['⌥=', '⌥−'], t`Zoom the timeline in · out`],
      [['⌥0'], t`Fit the whole clip in the timeline`],
      [['⇧Z'], t`Zoom the timeline to in and out`],
      [['Z'], t`Zoom the picture: fit · 100% · 200% — drag to look around`],
      [['G'], t`Framing guides — again for the next one`],
      [['F'], t`Full screen`],
      [['M'], t`Mute`],
      [['⇧↑', '⇧↓'], t`Volume up · down`],
      [['\\'], t`Flip to the version you compare with`],
      [[`${CMD}C`], t`Copy the timecode`],
      [[`⇧${CMD}C`], t`Copy a link to this frame`],
      [['?'], t`Show these shortcuts`],
      [[t({ message: 'Esc', context: 'keyboard key' })], t`Close the player`],
    ],
  },
  {
    title: t`Notes`,
    rows: [
      [[t({ message: 'Double-click', context: 'keyboard key' })], t`Edit a note or title`],
      [[`${CMD}Z`, `${CMD}⇧Z`], t`Undo · redo text (history survives closing the note)`],
      [[`${CMD}B`, `${CMD}I`, `${CMD}U`], t`Bold · italic · underline`],
      [[t({ message: 'Tab', context: 'keyboard key' }), t({ message: '⇧Tab', context: 'keyboard key' })], t`Nest · un-nest a list item`],
      [['@'], t`Mention a board, doc, or card`],
    ],
  },
  {
    title: t`Document`,
    rows: [
      [[`${CMD}Z`, `${CMD}⇧Z`], t`Undo · redo (text while typing; pages & structure otherwise)`],
      [[`${CMD}⌥1`, `${CMD}⌥0`], t`Heading 1 · body`],
      [[`${CMD}⇧7`, `${CMD}⇧8`, `${CMD}⇧9`], t`Numbered · bullet · task list`],
      [[`${CMD}⇧H`, `${CMD}E`], t`Highlight · inline code`],
      [[`${CMD}⇧L`, `${CMD}⇧E`, `${CMD}⇧R`], t`Align left · center · right`],
      [[`${CMD}K`, `${CMD}⌥M`], t`Link · comment`],
      [[`${CMD}F`], t`Find in document`],
      [[t({ message: 'Tab', context: 'keyboard key' }), t({ message: '⇧Tab', context: 'keyboard key' })], t`Indent · outdent (screenplay: cycle element)`],
    ],
  },
  {
    // Every role="toolbar" (hooks/useToolbarRoving), and the rail's +.
    title: t`Toolbars`,
    rows: [
      [[t({ message: 'Tab', context: 'keyboard key' })], t`To the next toolbar: each is one stop`],
      [[TO_BAR, t({ message: 'Esc', context: 'keyboard key' })], t`From a doc’s or a note’s text to its toolbar · back to the text`],
      [['←', '→'], t`The previous · next control in it (↑ ↓ on the tool rail)`],
      [[t({ message: 'Home', context: 'keyboard key' }), t({ message: 'End', context: 'keyboard key' })], t`Its first · last control`],
      [['→', '←'], t`Open · close the tool rail’s + menu`],
    ],
  },
];

// A finger has no right-click: its first tip says press and hold.
const TIPS = () => [
  coarsePointer()
    ? t`Press and hold the canvas or any card for more actions.`
    : t`Right-click the canvas or any card for more actions.`,
  t`Drag a card onto a board card to nest it inside.`,
  t`Hold Alt while dragging to ignore snapping; hold ${CMD} while resizing an image to break its aspect ratio.`,
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
    <Modal open={open} onClose={onClose} className="shortcuts-modal" ariaLabel={t`Keyboard shortcuts`} showClose>
      <div className="shortcuts-hd"><Trans>Keyboard shortcuts</Trans></div>
      <div className="shortcuts-grid">
        {SECTIONS().map((s) => (
          <section key={s.title} className="shortcuts-sec" aria-label={s.title}>
            <h3>{s.title}</h3>
            {s.rows.map(([keys, label]) => (
              <div key={`${label}:${keys.join(' ')}`} className="shortcuts-row">
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
        <h3><Trans>Tips</Trans></h3>
        <ul>
          {TIPS().map((tip) => <li key={tip}>{tip}</li>)}
        </ul>
        <p style={{ marginTop: 12, opacity: 0.7, fontSize: '0.85em' }}>
          <Trans>Everything else is written up in the{' '}
          <a href="/docs" target="_blank" rel="noreferrer noopener"
             onClick={() => logEvent(EV.DOCS_OPEN, { from: 'shortcuts', path: '/docs' })}>documentation</a>.</Trans>
        </p>
      </div>
    </Modal>
  );
}
