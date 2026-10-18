// Is this one file shared? For the "Share / Shared" button on a viewer.
//
//   useFileShareState({ boardId, cardId, enabled, api })
//     -> { shared: true | false | null, linkAccess, peopleCount, commentCount }
//
// Reads get_file_share_settings (0421) once when enabled, and again whenever
// the dialog writes this file's share (FILE_SHARE_CHANGED_EVENT). An error,
// e.g. 42501 for someone who can't manage the cluster, reads as shared: null
// (unknown), so the button just says "Share".
import { useEffect, useState } from 'react';
import * as realApi from '../lib/fileShares.js';
import { FILE_SHARE_CHANGED_EVENT } from '../lib/fileShareBus.js';

const UNKNOWN = Object.freeze({ shared: null, linkAccess: null, peopleCount: 0, commentCount: 0 });

export function fileShareStateOf(data) {
  if (!data || typeof data !== 'object') return UNKNOWN;
  const people = Array.isArray(data.people) ? data.people : [];
  const linkAccess = data.link_access || 'none';
  const exists = !!data.exists;
  return {
    shared: exists && (linkAccess !== 'none' || people.length > 0),
    linkAccess: exists ? linkAccess : 'none',
    peopleCount: exists ? people.length : 0,
    commentCount: Number(data.comment_count) || 0,
  };
}

export function useFileShareState({ boardId, cardId, enabled = true, api = realApi } = {}) {
  const [state, setState] = useState(UNKNOWN);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled || !boardId || !cardId || typeof document === 'undefined') return undefined;
    const on = (e) => {
      const d = e.detail || {};
      if (d.boardId === boardId && d.cardId === cardId) setTick((t) => t + 1);
    };
    document.addEventListener(FILE_SHARE_CHANGED_EVENT, on);
    return () => document.removeEventListener(FILE_SHARE_CHANGED_EVENT, on);
  }, [enabled, boardId, cardId]);

  useEffect(() => {
    if (!enabled || !boardId || !cardId) { setState(UNKNOWN); return undefined; }
    let off = false;
    (async () => {
      let out = UNKNOWN;
      try {
        const { data, error } = await api.getFileShareSettings(boardId, cardId);
        out = error ? UNKNOWN : fileShareStateOf(data);
      } catch (_) { out = UNKNOWN; }
      if (!off) setState(out);
    })();
    return () => { off = true; };
  }, [enabled, boardId, cardId, api, tick]);

  return state;
}
