import { Icon } from './Icon.jsx';
import { R2Image } from './R2Image.jsx';
import { EntityLink } from './EntityLink.jsx';
import { FilePdf, FileIcon, FileText, Link as LinkIcon, LayoutGrid, StickyNote } from '../lib/icons.js';
import { useEntityNavigate } from '../hooks/useEntityNavigate.js';
import { coerceRef } from '../lib/entityRef.js';
import { messageThings } from '../lib/messageFeed.js';
import { attachmentMetaLabel, imageBoxStyle } from '../lib/messageAttachmentLinks.js';
import { publicAttachmentUrl } from '../lib/messageAttachmentUrls.js';
import { safeExternalHref } from '../lib/safeExternalHref.js';
import { useMessagesBoard, useMessagesLook } from './messagesLook.js';

// The tallest a lone picture stands in the card look's thread.
const PICTURE_MAX_H = 260;

// What a message carries, in the card look: not inside its bubble but as
// cards from the board under it (a picture, a file, a link, a card, a cluster
// with its cover), with the board's corner and hairline whoever sent them.
// Each still drags onto a canvas, where it becomes a card.
export function MessageThings({ msg, workspaceId, onDragStart }) {
  const things = messageThings(msg);
  if (!things.length) return null;
  const pics = things.filter((a) => a.kind === 'image' && a.storage_path);
  const rest = things.filter((a) => !(a.kind === 'image' && a.storage_path));
  return (
    <div className="msg-things">
      {pics.length === 1 && <Picture att={pics[0]} onDragStart={onDragStart} />}
      {pics.length > 1 && (
        <div className={`msg-thing-grid${pics.length === 2 ? ' is-two' : ''}`}>
          {pics.map((att, i) => <Picture key={i} att={att} onDragStart={onDragStart} tile />)}
        </div>
      )}
      {rest.map((att, i) => <Thing key={i} att={att} workspaceId={workspaceId} onDragStart={onDragStart} />)}
    </div>
  );
}

// A picture opens full size in a new tab. One alone keeps its shape (its
// stored size reserves the room before it loads); two or more share a grid.
function Picture({ att, onDragStart, tile = false }) {
  const src = publicAttachmentUrl(att.storage_path);
  return (
    <div className={`msg-thing is-image${tile ? ' is-tile' : ''}`} draggable onDragStart={(e) => onDragStart?.(e, att)}>
      <a className="msg-thing-pic" href={src} target="_blank" rel="noopener noreferrer"
         title={att.name ? `Open ${att.name}` : 'Open image'}>
        <img alt={att.name || ''} src={src} draggable={false}
             width={att.width || undefined} height={att.height || undefined}
             style={tile ? undefined : (imageBoxStyle(att, PICTURE_MAX_H) || undefined)} />
      </a>
    </div>
  );
}

function Thing({ att, workspaceId, onDragStart }) {
  const drag = (e) => onDragStart?.(e, att);
  if (att.kind === 'board') return <ClusterThing att={att} onDragStart={drag} />;
  if (att.kind === 'file') {
    const name = att.name || 'file';
    const meta = attachmentMetaLabel(att);
    const inner = (
      <>
        <span className="msg-thing-icon"><Icon as={/pdf/i.test(att.mime || name) ? FilePdf : FileIcon} size={18} weight="regular" /></span>
        <span className="msg-thing-text">
          <span className="msg-thing-name">{name}</span>
          {meta && <span className="msg-thing-meta">{meta}</span>}
        </span>
      </>
    );
    return (
      <div className="msg-thing is-file" draggable onDragStart={drag}>
        {att.storage_path ? (
          <a className="msg-thing-body" href={publicAttachmentUrl(att.storage_path, { download: name })}
             download={name} target="_blank" rel="noopener noreferrer" title={`Download ${name}`}>{inner}</a>
        ) : <span className="msg-thing-body">{inner}</span>}
      </div>
    );
  }
  if (att.kind === 'url') {
    const href = safeExternalHref(att.href);
    const host = hostOf(att.href);
    const title = att.title && att.title !== att.href ? att.title : host || att.href;
    return (
      <div className="msg-thing is-link" draggable onDragStart={drag}>
        <a className="msg-thing-body" href={href || undefined} target="_blank" rel="noopener noreferrer" title={att.href}>
          <span className="msg-thing-icon"><Icon as={LinkIcon} size={18} weight="regular" /></span>
          <span className="msg-thing-text">
            <span className="msg-thing-name">{title}</span>
            {host && host !== title && <span className="msg-thing-meta">{host}</span>}
          </span>
        </a>
      </div>
    );
  }
  // A card or a document: its kind and its name; hover shows it, a click goes there.
  const ref = coerceRef(att);
  const isDoc = att.kind === 'doc' || att.kind === 'docPos';
  return (
    <div className="msg-thing is-entity" draggable onDragStart={drag}>
      <EntityLink refs={[ref].filter(Boolean)} workspaceId={workspaceId} asTag="span" className="msg-thing-body">
        <span className="msg-thing-icon"><Icon as={isDoc ? FileText : StickyNote} size={18} weight="regular" /></span>
        <span className="msg-thing-text">
          <span className="msg-thing-name">{String(att.title || att.name || (isDoc ? 'Document' : 'Card'))}</span>
          <span className="msg-thing-meta">{isDoc ? 'Document' : 'Card'}</span>
        </span>
      </EntityLink>
    </div>
  );
}

// A cluster as Home shows one: its cover, its name, where it is and how many
// cards. A click opens it.
function ClusterThing({ att, onDragStart }) {
  const ref = coerceRef(att);
  const info = useMessagesBoard(ref?.id);
  const navigate = useEntityNavigate();
  const name = info?.name || att.title || att.name || 'Cluster';
  const where = info?.parentName ? `Cluster in ${info.parentName}` : 'Cluster';
  const cards = info?.cards ? `${info.cards} card${info.cards === 1 ? '' : 's'}` : '';
  return (
    <div className={`msg-thing is-cluster${info?.thumbKey ? ' has-cover' : ''}`} draggable onDragStart={onDragStart}>
      <button type="button" className="msg-thing-body" title={`Open ${name}`} onClick={() => { if (ref) navigate(ref); }}>
        {info?.thumbKey
          ? <span className="msg-thing-cover"><R2Image src={info.thumbKey} bust={info.bust} alt="" /></span>
          : <span className="msg-thing-icon"><Icon as={LayoutGrid} size={18} weight="regular" /></span>}
        <span className="msg-thing-text">
          <span className="msg-thing-name">{name}</span>
          <span className="msg-thing-meta">{[where, cards].filter(Boolean).join(' · ')}</span>
        </span>
      </button>
    </div>
  );
}

// A cluster a message names (its @ pill), in the card look: its cover before
// its name. Nothing elsewhere, or for a cluster with no cover yet.
export function ClusterPillCover({ boardId }) {
  const card = useMessagesLook() === 'card';
  const info = useMessagesBoard(card ? boardId : null);
  if (!info?.thumbKey) return null;
  return (
    <span className="msg-pill-cover" aria-hidden="true">
      <R2Image src={info.thumbKey} bust={info.bust} alt="" />
    </span>
  );
}

function hostOf(href) {
  try { return new URL(String(href || '')).host.replace(/^www\./, ''); } catch (_) { return ''; }
}
