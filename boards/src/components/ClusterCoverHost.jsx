// The custom-colour picker and the custom-thumbnail flow (file input, then the
// crop modal) for any cluster's menu, mounted once in App.jsx and opened
// through lib/clusterCoverBus.js. It was SidebarBoardTree's own; the calls and
// components are unchanged.
import { useEffect, useRef, useState } from 'react';
import { ColorPicker } from './ColorPicker.jsx';
import { ThumbnailCropModal } from './ThumbnailCropModal.jsx';
import { CLUSTER_COLOR_EVENT, CLUSTER_THUMB_EVENT } from '../lib/clusterCoverBus.js';

export function ClusterCoverHost({
  boards,                 // map of boardId → board (the picker starts from its bg_color)
  onSetBoardBgColor,      // (boardId, hex|null) => void
  onSetBoardThumb,        // (boardId, blob) => Promise
}) {
  // { boardId, value, x, y } | null
  const [picker, setPicker] = useState(null);
  // thumbCrop = { boardId, file } while the crop modal is up; thumbSaving
  // covers the upload round-trip.
  const thumbInputRef = useRef(null);
  const pendingThumbBoardId = useRef(null);
  const [thumbCrop, setThumbCrop] = useState(null);
  const [thumbSaving, setThumbSaving] = useState(false);
  const boardsRef = useRef(boards);
  boardsRef.current = boards;

  useEffect(() => {
    const onColor = (e) => {
      const { id, x, y } = e.detail || {};
      if (!id) return;
      setPicker({ boardId: id, value: boardsRef.current?.[id]?.bg_color || '#1c1c1f', x, y });
    };
    const onThumb = (e) => {
      const id = e.detail?.id;
      if (!id) return;
      pendingThumbBoardId.current = id;
      const input = thumbInputRef.current;
      if (input) { input.value = ''; input.click(); }
    };
    document.addEventListener(CLUSTER_COLOR_EVENT, onColor);
    document.addEventListener(CLUSTER_THUMB_EVENT, onThumb);
    return () => {
      document.removeEventListener(CLUSTER_COLOR_EVENT, onColor);
      document.removeEventListener(CLUSTER_THUMB_EVENT, onThumb);
    };
  }, []);

  const onThumbFileChange = (e) => {
    const file = e.target.files?.[0];
    const boardId = pendingThumbBoardId.current;
    pendingThumbBoardId.current = null;
    if (file && boardId) setThumbCrop({ boardId, file });
  };
  const saveThumbCrop = async (blob) => {
    const boardId = thumbCrop?.boardId;
    if (!boardId) { setThumbCrop(null); return; }
    setThumbSaving(true);
    try { await onSetBoardThumb?.(boardId, blob); }
    finally { setThumbSaving(false); setThumbCrop(null); }
  };

  return (
    <>
      {picker && (
        <ColorPicker
          value={picker.value}
          onChange={(c) => onSetBoardBgColor?.(picker.boardId, c)}
          onClose={() => setPicker(null)}
          position={{ x: picker.x, y: picker.y }}
          allowTransparent
        />
      )}
      <input ref={thumbInputRef} type="file" accept="image/*"
             style={{ display: 'none' }} onChange={onThumbFileChange} />
      {thumbCrop && (
        <ThumbnailCropModal
          file={thumbCrop.file}
          saving={thumbSaving}
          onCancel={() => { if (!thumbSaving) setThumbCrop(null); }}
          onSave={saveThumbCrop}
        />
      )}
    </>
  );
}
