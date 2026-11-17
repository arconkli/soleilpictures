// menuIconsLoad.js — the one door to components/menuIcons.js. The menus' icons
// are about a third of the icon download and nobody needs them before the first
// menu opens, so they load on their own: App asks for them once the page is
// idle. A menu drawn sooner keeps each icon's space, and the icon fills in when
// they land.
import { useEffect, useSyncExternalStore } from 'react';

let pending = null;
let pick = null;   // the module's menuIcon, once loaded
const listeners = new Set();

export function loadMenuIcons() {
  if (!pending) {
    pending = import('../components/menuIcons.js').then((m) => {
      pick = m.menuIcon;
      listeners.forEach((l) => l());
    }, () => {
      // No icons is a fine way to fail; a later call tries again.
      pending = null;
    });
  }
  return pending;
}

export function menuIconNow(name) {
  return pick ? pick(name) : null;
}

const subscribe = (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

export function useMenuIcons() {
  const loaded = useSyncExternalStore(subscribe, () => pick !== null, () => false);
  useEffect(() => { if (!loaded) loadMenuIcons(); }, [loaded]);
  return loaded;
}
