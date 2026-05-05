import { BacklinksList } from './BacklinksList.jsx';

export function HomeGraphDetailDrawer({ workspaceId, node, onClose, onOpen }) {
  if (!node) return null;
  const [kind, ...rest] = node.id.split(':');
  const boardId   = kind === 'board' ? rest[0] : (kind === 'card' ? rest[0] : undefined);
  const cardId    = kind === 'card'  ? rest[1] : undefined;
  const docCardId = kind === 'card' && node.kind === 'doc' ? rest[1]
                  : (kind === 'card' ? undefined : undefined);
  return (
    <aside className="home-graph-drawer surface-frosted">
      <header className="home-graph-drawer-head">
        <div>
          <div className="t-eyebrow">{kind.toUpperCase()}</div>
          <div className="home-graph-drawer-name t-h3">{node.name}</div>
        </div>
        <button className="home-graph-drawer-x" onClick={onClose} aria-label="Close">×</button>
      </header>
      <div className="home-graph-drawer-body">
        <button className="btn-primary" style={{ width: '100%' }} onClick={onOpen}>Open</button>
        <div className="t-eyebrow" style={{ marginTop: 24, marginBottom: 8 }}>REFERENCED BY</div>
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
