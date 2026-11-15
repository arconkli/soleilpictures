import { BacklinksList } from './BacklinksList.jsx';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

// Pretty label per node kind/sub-kind. The eyebrow used to just shout
// the raw `kind` slug (e.g., "CARD") which read as "no info" — now we
// surface the actual sub-kind ("Note", "Image", "Palette", "Boardlink",
// etc.) so a click feels like it's revealing real metadata.
function readableKind(node) {
  const broad = node.id.split(':')[0];
  // For card nodes, prefer the cardKind (note/image/palette/link/...)
  // over the broad "card" bucket.
  const sub = node.cardKind || node.kind || broad;
  const map = {
    board: t`Board`,
    boardlink: t`Board link`,
    doc: t`Doc`,
    note: t`Note`,
    image: t`Image`,
    palette: t`Palette`,
    link: t`Link`,
    card: t`Card`,
    url: t`External link`,
    docPos: t`Doc anchor`,
  };
  return map[sub] || sub.charAt(0).toUpperCase() + sub.slice(1);
}

function openLabel(node) {
  const broad = node.id.split(':')[0];
  if (broad === 'board') return t`Open board`;
  if (broad === 'url')   return t`Open link`;
  const sub = node.cardKind || node.kind;
  if (sub === 'doc')     return t`Open doc`;
  if (sub === 'note')    return t`Open note`;
  if (sub === 'image')   return t`Open image`;
  if (sub === 'palette') return t`Open palette`;
  return t`Open`;
}

export function HomeGraphDetailDrawer({ workspaceId, node, onClose, onOpen }) {
  if (!node) return null;
  const [kind, ...rest] = node.id.split(':');
  const boardId   = kind === 'board' ? rest[0] : (kind === 'card' ? rest[0] : undefined);
  const cardId    = kind === 'card'  ? rest[1] : undefined;
  const docCardId = kind === 'card' && node.kind === 'doc' ? rest[1] : undefined;
  return (
    <aside className="home-graph-drawer surface-frosted">
      <header className="home-graph-drawer-head">
        <div className="home-graph-drawer-head-info">
          <div className="home-graph-drawer-eyebrow">
            <span className="home-graph-drawer-dot" style={{ background: node.color || '#ffa500' }} />
            <span className="t-eyebrow">{readableKind(node)}</span>
          </div>
          <div className="home-graph-drawer-name t-h3">{node.name || t`Untitled`}</div>
        </div>
        <button className="home-graph-drawer-x" onClick={onClose} aria-label={t`Close`}>×</button>
      </header>
      <div className="home-graph-drawer-body">
        <button className="btn-primary" style={{ width: '100%' }} onClick={onOpen}>{openLabel(node)}</button>
        <div className="t-eyebrow" style={{ marginTop: 24, marginBottom: 8 }}><Trans>REFERENCED BY</Trans></div>
        <BacklinksList
          workspaceId={workspaceId}
          targetBoardId={boardId}
          targetCardId={cardId}
          targetDocCardId={docCardId}
          onOpenSource={() => onOpen?.()}
        />
      </div>
    </aside>
  );
}
