import { BacklinksList } from './BacklinksList.jsx';

export function DocRefsPanel({ workspaceId, docCardId, onOpenSource }) {
  return (
    <div className="doc-refs">
      <div className="doc-refs-head">
        <span className="t-eyebrow doc-rail-label">REFERENCED BY</span>
      </div>
      <div className="doc-refs-body">
        <BacklinksList workspaceId={workspaceId} targetDocCardId={docCardId} onOpenSource={onOpenSource} />
      </div>
    </div>
  );
}
