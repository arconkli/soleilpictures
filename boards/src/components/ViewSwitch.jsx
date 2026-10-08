// Board · Files — the topbar switch between a cluster's canvas and its file
// browser. It replaced a quiet "Canvas | List" pill that most people never
// noticed, so it is deliberately the loudest control in the topbar's centre:
// icons and labels, the Files side carries a live count of what is inside, and
// F flips between the two (wired in the app shell, which owns the view).
//
// Only the active segment uses gold, on its icon — gold is reserved for
// active state.

import { Icon } from './Icon.jsx';
import { BoundingBox, Files } from '../lib/icons.js';
import { VIEW_LABELS, formatFilesCount } from '../lib/viewSwitch.js';

export function ViewSwitch({ view, filesCount = 0, onSwitch }) {
  const onFiles = view === 'list';
  const count = formatFilesCount(filesCount);
  return (
    <div className="view-pill view-pill--primary" role="group" aria-label="View">
      <button type="button"
              className={`view-pill-btn ${onFiles ? '' : 'on'}`}
              aria-pressed={!onFiles}
              onClick={() => { if (onFiles) onSwitch?.('canvas'); }}
              title="Board — arrange it on the canvas (F)">
        <span className="vp-ico" aria-hidden="true"><Icon as={BoundingBox} size={15} /></span>
        <span className="vp-lbl">{VIEW_LABELS.canvas}</span>
      </button>
      <button type="button"
              className={`view-pill-btn ${onFiles ? 'on' : ''}`}
              aria-pressed={onFiles}
              onClick={() => { if (!onFiles) onSwitch?.('list'); }}
              title="Files — everything in this cluster, as a grid or a list (F)"
              data-tour="view-toggle">
        <span className="vp-ico" aria-hidden="true"><Icon as={Files} size={15} /></span>
        <span className="vp-lbl">{VIEW_LABELS.list}</span>
        {count && <span className="vp-count" aria-hidden="true">{count}</span>}
      </button>
    </div>
  );
}
