import { EntityPicker } from './EntityPicker.jsx';

// Wraps EntityPicker filtered to workspace members. Returns the picked
// user via onPick({ id, name }).
export function NewDMPicker({ workspaceId, anchor, onPick, onClose }) {
  return (
    <EntityPicker
      workspaceId={workspaceId}
      anchor={anchor}
      filter={['user']}
      onCommit={(targets) => {
        const t = targets?.[0];
        if (t?.kind === 'user' && t.id) {
          onPick?.({ id: t.id, name: t.title });
        }
        onClose?.();
      }}
      onCancel={onClose}
    />
  );
}
