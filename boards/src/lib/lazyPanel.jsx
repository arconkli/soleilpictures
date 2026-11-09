// lazyPanel — a panel App keeps mounted behind an `open` prop (Settings, the
// command palette, Trash, Version history, …), loaded only once it's wanted.
//
// Each of these renders nothing while it's shut and does nothing until it
// opens, so not mounting one before its first open loses nothing: the chunk
// loads then, and from that open on the panel stays mounted exactly as it
// always was, keeping its state across a close and a reopen.
//
//   const SettingsPanel = lazyPanel(() => import('../components/SettingsPanel.jsx').then(m => ({ default: m.SettingsPanel })));
//   <SettingsPanel open={settingsOpen} … />
//   SettingsPanel.warm();   // fetch it now, so the first open seldom waits
//
// lazyWithReload underneath, so a chunk a deploy has replaced reloads the page
// once instead of failing.
//
// While the chunk loads, and the panel is open, the person sees its frame and
// title at once (PanelWait; its spinner fades in after 0.3 s):
//   lazyPanel(factory, { title: 'Settings', variant: 'modal' })
// It closes with the panel's own `onClose`.

import { Suspense, useState } from 'react';
import { lazyWithReload } from './lazyWithReload.js';
import { PanelWait } from '../components/PanelWait.jsx';

export function lazyPanel(factory, { title = null, variant = 'modal' } = {}) {
  const Panel = lazyWithReload(factory);
  function LazyPanel(props) {
    const [opened, setOpened] = useState(!!props.open);
    if (props.open && !opened) setOpened(true);
    if (!opened) return null;
    const wait = title && props.open
      ? <PanelWait title={title} variant={variant} onClose={props.onClose || null} />
      : null;
    return <Suspense fallback={wait}><Panel {...props} /></Suspense>;
  }
  LazyPanel.warm = Panel.warm;
  return LazyPanel;
}
