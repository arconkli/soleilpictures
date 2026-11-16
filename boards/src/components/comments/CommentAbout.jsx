import { Icon } from '../Icon.jsx';
import { MessageCircle, BoundingBox, Pin } from '../../lib/icons.js';
import { KindIcon } from '../KindIcon.jsx';
import { R2Image } from '../R2Image.jsx';
import { itemFromCard, displayName } from '../../lib/indexRowCard.js';
import './canvasComments.css';
import { t as tr } from '@lingui/core/macro';

// What a conversation is about, in words and as a small picture:
//   → { title, place, thumb }   place is where it is when it is on no card
export function describeAnchor(meta, { cardById, groupById, boardId, workspaceId, boards }) {
  const kind = meta?.anchorKind;
  if (kind === 'card') {
    const card = cardById?.get?.(meta.anchorId) || null;
    if (!card) return { title: tr`A card that is gone`, place: null, thumb: <CardThumb card={null} /> };
    let title = '';
    // a cluster on the canvas is named by the cluster it opens
    if (card.kind === 'board' || card.kind === 'boardlink') {
      title = String(boards?.[card.kind === 'board' ? card.id : card.target]?.name || '').trim();
    }
    if (!title) try { title = itemFromCard(card, { boardId, workspaceId })?.name || ''; } catch (_) { /* a card the index doesn't name */ }
    if (!title) title = displayName({ kind: card.kind, title: card.title, meta: card, snippet: card.text || card.body || '' });
    return { title, place: null, thumb: <CardThumb card={card} /> };
  }
  if (kind === 'group') {
    const name = String(groupById?.[meta.anchorId]?.name || '').trim();
    return { title: name || tr`Group`, place: null, thumb: <span className="cmt-cthumb"><Icon as={BoundingBox} size={14} weight="regular" /></span> };
  }
  if (kind === 'point') return { title: tr`On the canvas`, place: tr`On the canvas`, thumb: <span className="cmt-cthumb"><Icon as={Pin} size={14} weight="regular" /></span> };
  return { title: tr`This cluster`, place: tr`On this cluster`, thumb: <span className="cmt-cthumb"><Icon as={MessageCircle} size={14} weight="regular" /></span> };
}

function CardThumb({ card }) {
  const src = card && (card.kind === 'image' ? card.src : (card.poster || card.thumb || null));
  if (src && typeof src === 'string') {
    return <span className="cmt-cthumb"><R2Image src={src} alt="" eager /></span>;
  }
  if (card?.kind === 'palette' && Array.isArray(card.swatches) && card.swatches.length) {
    return (
      <span className="cmt-cthumb cmt-cthumb--swatch">
        {card.swatches.slice(0, 5).map((s, i) => <i key={i} style={{ background: typeof s === 'string' ? s : (s?.hex || s?.color || 'transparent') }} />)}
      </span>
    );
  }
  return <span className="cmt-cthumb"><KindIcon kind={card?.kind || 'note'} size={14} weight="regular" /></span>;
}
