// What a doc's footer and a phone's title line report: the current page's word
// and character counts, and a save state that claims only what is proven
// (lib/docSaveStatus.js): Saved once the cluster's room says it holds every
// change made here, or a whole-board save did; and, when the room can't be
// reached, whether the changes are kept on this device.

import { useEffect, useState } from 'react';
import { docCounts } from '../lib/docCounts.js';
import { acquireSaveTracker, saveLine } from '../lib/docSaveStatus.js';

const NOTHING = Object.freeze({ mode: 'none', pending: false, savedAt: null });

// `doc`: the cluster's Y.Doc. `room`: its live room, once attached (DocSurface
// passes it then). `boardId`: the board whose saves these are, or null, when
// none count (another board's never do).
export function useDocStatus({ editor, boardId = null, doc = null, room = null }) {
  const [counts, setCounts] = useState({ words: 0, chars: 0 });

  // Word/char count for current page. Counted once typing pauses: the full
  // textContent + split per keystroke was a whole-document pass on every
  // character of a long doc, for a number nobody reads mid-word.
  useEffect(() => {
    if (!editor) { setCounts({ words: 0, chars: 0 }); return; }
    let timer = 0;
    const count = () => {
      timer = 0;
      if (editor.isDestroyed) return;
      const { words, chars } = docCounts(editor.state.doc);
      setCounts((c) => (c.words === words && c.chars === chars ? c : { words, chars }));
    };
    const tick = () => { clearTimeout(timer); timer = setTimeout(count, 300); };
    count();
    editor.on('update', tick);
    return () => { clearTimeout(timer); editor.off('update', tick); };
  }, [editor]);

  // The doc's save tracker, shared with any other line that shows it. The
  // room joins it when it attaches, so what's unsaved carries over.
  const [tracker, setTracker] = useState(null);
  const [snap, setSnap] = useState(NOTHING);
  useEffect(() => {
    const { tracker: t, release } = acquireSaveTracker(doc, { boardId });
    setTracker(t);
    setSnap(t.get());
    const off = t.subscribe(() => setSnap(t.get()));
    return () => { off(); release(); };
  }, [doc, boardId]);
  useEffect(() => { tracker?.setRoom(room); }, [tracker, room]);

  // Force a re-render every 30s so the "saved Xs ago" label stays fresh.
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force(n => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // yboard.js marks the doc when its last local draft didn't take.
  const status = saveLine(snap, { online, kept: doc?._soleilKept !== false });
  return { words: counts.words, chars: counts.chars, online, status, savedAt: snap.savedAt };
}
