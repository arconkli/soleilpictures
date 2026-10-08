// Board · Files — the topbar switch between a cluster's canvas and its files.
// It replaced a quiet "Canvas | List" pill that most people never noticed, so
// it is deliberately the loudest control in the topbar's centre: icons and
// labels, and the Files side carries a live count of what is inside.
//
// Files is one view in two sizes (lib/filesDock.js): beside the board as a
// docked panel, or filling the pane. Board is pressed only when Files is put
// away; Files is pressed whenever it shows. F toggles the panel (wired in the
// app shell, which owns the mode).
//
// Only the pressed Files segment uses gold, on its icon — gold is reserved for
// active state.

import { Icon } from './Icon.jsx';
import { BoundingBox, Files } from '../lib/icons.js';
import { VIEW_LABELS, formatFilesCount } from '../lib/viewSwitch.js';
import { switchSegments } from '../lib/filesDock.js';

const TITLES = {
  off:   { board: 'Board', files: 'Files — open beside the board (F)' },
  panel: { board: 'Board only — put Files away (F)', files: 'Files is open beside the board' },
  full:  { board: 'Back to the board (F)', files: 'Files' },
};

export function ViewSwitch({ mode = 'off', filesCount = 0, onSegment }) {
  const pressed = switchSegments(mode);
  const titles = TITLES[mode] || TITLES.off;
  const count = formatFilesCount(filesCount);
  return (
    <div className="view-pill view-pill--primary" role="group" aria-label="View">
      <button type="button"
              className={`view-pill-btn ${pressed.board ? 'on' : ''}`}
              aria-pressed={pressed.board}
              onClick={() => onSegment?.('board')}
              title={titles.board}>
        <span className="vp-ico" aria-hidden="true"><Icon as={BoundingBox} size={15} /></span>
        <span className="vp-lbl">{VIEW_LABELS.canvas}</span>
      </button>
      <button type="button"
              className={`view-pill-btn ${pressed.files ? 'on' : ''}`}
              aria-pressed={pressed.files}
              onClick={() => onSegment?.('files')}
              title={titles.files}
              data-tour="view-toggle">
        <span className="vp-ico" aria-hidden="true"><Icon as={Files} size={15} /></span>
        <span className="vp-lbl">{VIEW_LABELS.list}</span>
        {count && <span className="vp-count" aria-hidden="true">{count}</span>}
      </button>
    </div>
  );
}
