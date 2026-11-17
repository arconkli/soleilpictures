// Platform shortcut strings for the right-click menus (lib/menus/*). Plain text,
// as the menu renders them: '⌘D' on a Mac, 'Ctrl+D' elsewhere. The Mac test is
// the one CanvasSurface's isMac uses, read lazily so node tests can import this.

export const isMacPlatform = () => typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '');

// ⌘K / Ctrl+K
export const mod = (key) => (isMacPlatform() ? `⌘${key}` : `Ctrl+${key}`);

// ⇧1 / Shift+1
export const shift = (key) => (isMacPlatform() ? `⇧${key}` : `Shift+${key}`);

// A bare key (']', '[', 'N').
export const plain = (key) => String(key);

// What today's Delete row shows, on every platform.
export const del = () => '⌫';
