// The bell (placement C, owner's pick, 2026-10-21). The new sidebar has no
// Notifications row, so the list opens from here: the board's right island
// after the theme switch, or the phone's top bar before Share. A tb-icon like
// its neighbours, always shown; with unread rows it widens to carry the count
// in ink beside the glyph (9+ above nine), never a coloured badge, and while
// the list is open it wears the sidebar's pressed chip.
//
// The button only: App owns the open state and hands this the toggle, and
// NotificationsPanel takes this button as its anchor (placement, outside
// presses, where focus returns on Escape).

import { forwardRef } from 'react';
import { Icon } from './Icon.jsx';
import { Bell } from '../lib/icons.js';
import { bellAriaLabel, bellCountLabel } from '../lib/notificationsBell.js';
import './notificationsPanel.css';

export const NotificationsBell = forwardRef(function NotificationsBell(
  { unread = 0, open = false, onToggle = null }, ref,
) {
  const count = bellCountLabel(unread);
  return (
    <button type="button" ref={ref}
      className={`tb-icon nb-bell${count ? ' has-unread' : ''}${open ? ' is-pressed' : ''}`}
      title="Notifications" aria-label={bellAriaLabel(unread)}
      aria-haspopup="dialog" aria-expanded={open}
      onClick={() => onToggle?.()}>
      <Icon as={Bell} size={16} />
      {count && <span className="nb-count" aria-hidden="true">{count}</span>}
    </button>
  );
});
