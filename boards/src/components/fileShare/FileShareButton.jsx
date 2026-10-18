// The "Share / Shared" button on a fullscreen viewer: the review player
// (frv), Quick look (ql), the image lightbox and the PDF viewer (pdfv). Each
// variant wears its viewer's own button class, so it sits in that toolbar as
// a native. A click opens the owner dialog through the bus (FileShareHost).
//
// "Shared" is neutral ink, like "Share": gold is only for active / selection
// / focus states. The callers keep their own gates (fileSharesAllowed(),
// canEdit, isShareableCard); this only draws the button.
import { Icon } from '../Icon.jsx';
import { Share2 } from '../../lib/icons.js';
import { openFileShare } from '../../lib/fileShareBus.js';
import { useFileShareState } from '../../hooks/useFileShareState.js';
import * as realApi from '../../lib/fileShares.js';
import './fileShareButton.css';

// A mouse press on the player's header doesn't take the focus, so Space stays
// the player's (FilmReview's own rule for its buttons).
const noFocus = (e) => { if (e.pointerType === 'mouse') e.preventDefault(); };

const VARIANT = {
  frv: { className: 'frv-iconbtn fsb-btn', size: 18, weight: 'regular' },
  ql: { className: 'ql-btn fsb-btn', size: 14, weight: 'light' },
  lightbox: { className: 'lightbox-download lightbox-share fsb-btn', size: 15, weight: 'regular' },
  pdfv: { className: 'pdfv-btn pdfv-share fsb-btn', size: 15, weight: 'regular' },
};

export function FileShareButton({ boardId, cardId, card = null, boardName = null, surface, variant = 'ql', api = realApi }) {
  const v = VARIANT[variant] || VARIANT.ql;
  const { shared } = useFileShareState({ boardId, cardId, enabled: !!(boardId && cardId), api });
  const isShared = shared === true;
  const label = isShared ? 'Shared' : 'Share';
  const aria = isShared ? 'Shared - manage sharing' : 'Share file';
  return (
    <button type="button"
            className={`${v.className}${isShared ? ' is-shared' : ''}`}
            data-shared={isShared ? '1' : '0'}
            aria-label={aria} title={aria}
            onPointerDown={variant === 'frv' ? noFocus : undefined}
            onClick={(e) => {
              // The lightbox and the PDF viewer close on a click that reaches them.
              e.stopPropagation();
              openFileShare({ boardId, cardId, card: card || { id: cardId }, boardName, surface });
            }}>
      <Icon as={Share2} size={v.size} weight={v.weight} />
      <span>{label}</span>
    </button>
  );
}

export default FileShareButton;
