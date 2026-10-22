// useEditorLimit — the 10-editor limit for one cluster's or workspace's
// account, as the share panel and Members read it (held: editorLimitAllowed).
// An admin's Settings › Preview can restate it, look only (editorLimitPreview).
//
// cap is get_editor_capacity's numbers (lib/editorLimit.js
// normalizeEditorCapacity), or null while unknown, off, or held: callers treat
// null as room, because the server refuses anyway. With the hold off nothing
// is fetched at all (0520 isn't applied while it is held).
//
// The account's owner also gets the list of who holds the places
// (list_my_account_editors): always for Members, which draws it, and only once
// the account is full for the share panel, which reads it for "already holds a
// place". A viewer who edits elsewhere in the account can be made an editor
// here without taking another place.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getEditorCapacity, listMyAccountEditors } from '../lib/boardsApi.js';
import { editorLimitAllowed } from '../lib/appHost.js';
import { accountHolders, editorLimitFull, applyEditorLimitPreview } from '../lib/editorLimit.js';
import { readEditorLimitPreview, EDITOR_LIMIT_PREVIEW_EVENT } from '../lib/editorLimitPreview.js';

export function useEditorLimit({ boardId = null, workspaceId = null, enabled = true, list = 'full' } = {}) {
  const [cap, setCap] = useState(null);
  const [editors, setEditors] = useState([]);
  const [previewing, setPreviewing] = useState(false);
  const seq = useRef(0);
  const on = !!enabled && editorLimitAllowed() && !!(boardId || workspaceId);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    if (!on) { setCap(null); setEditors([]); setPreviewing(false); return null; }
    let next = null;
    try { next = await getEditorCapacity({ boardId, workspaceId }); } catch (_) { next = null; }
    if (mine !== seq.current) return next;
    const as = readEditorLimitPreview();
    const asOwner = !!as && as !== 'full_ask' && !!next?.isAccountOwner;
    const wantList = asOwner || (!!next?.enforced && next.isAccountOwner
      && (list === 'always' || editorLimitFull(next)));
    let rows = [];
    if (wantList) {
      try {
        rows = await listMyAccountEditors();
      } catch (_) { rows = []; }
      if (mine !== seq.current) return next;
    }
    const shown = applyEditorLimitPreview(next, rows, as);
    setCap(shown.cap);
    setEditors(shown.editors);
    setPreviewing(shown.previewing);
    return shown.cap;
  }, [on, boardId, workspaceId, list]);

  useEffect(() => { refresh(); }, [refresh]);

  // Settings › Preview changed its state: restate the numbers.
  useEffect(() => {
    const again = () => { refresh(); };
    window.addEventListener(EDITOR_LIMIT_PREVIEW_EVENT, again);
    return () => window.removeEventListener(EDITOR_LIMIT_PREVIEW_EVENT, again);
  }, [refresh]);

  const holders = useMemo(() => accountHolders(editors), [editors]);
  return { cap, editors, holders, refresh, previewing };
}
