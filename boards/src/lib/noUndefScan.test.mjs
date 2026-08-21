// noUndefScan — scope analysis over the big JSX surfaces for unresolved
// identifier references, using the repo's own @babel/parser + @babel/traverse.
//
// Three shipped bugs motivated this test, every one an unresolved identifier
// whose ReferenceError vanished into a try/catch(_){} and survived for months:
//   - isPaidPlan @ App.jsx list-drop: every list-view video upload died
//     silently for all tiers (broken 2026-07-13 → 2026-08-21)
//   - setAccountInitialTab/@setAccountOpen @ App.jsx: the Stripe-portal
//     return deep-link (?settings=billing) never worked from the day it
//     shipped — the state lived in Workspace, the effect in App()
//   - userId @ App.jsx pre-delete snapshot: the pre-board-delete version
//     snapshot was never once saved
// ESLint isn't wired into npm test, so this scan is the standing guard.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..');
const require = createRequire(resolve(SRC, '../package.json'));
const parser = require('@babel/parser');
const traverseMod = require('@babel/traverse');
const traverse = traverseMod.default || traverseMod;

// Files worth the scan: the giant multi-thousand-line components where a
// missing binding can hide in a corner for months. Add files as they earn it.
const FILES = [
  'App.jsx',
  'components/CanvasSurface.jsx',
  'components/SettingsPanel.jsx',
  'auth/AuthGate.jsx',
  'auth/TierRouter.jsx',
  'auth/PricingSuccess.jsx',
];

const BROWSER_GLOBALS = new Set([
  'window', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage',
  'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'fetch', 'URL', 'URLSearchParams',
  'Blob', 'File', 'FileReader', 'FormData', 'Image', 'Audio', 'AbortController', 'AbortSignal',
  'IntersectionObserver', 'ResizeObserver', 'MutationObserver', 'performance', 'crypto',
  'TextEncoder', 'TextDecoder', 'atob', 'btoa', 'structuredClone', 'queueMicrotask',
  'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'TouchEvent',
  'DragEvent', 'ClipboardEvent', 'WheelEvent', 'Node', 'Element', 'HTMLElement',
  'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLCanvasElement', 'HTMLVideoElement',
  'HTMLImageElement', 'DOMParser', 'DOMRect', 'Path2D', 'OffscreenCanvas', 'ImageBitmap',
  'createImageBitmap', 'getComputedStyle', 'matchMedia', 'alert', 'confirm', 'prompt',
  'innerWidth', 'innerHeight', 'devicePixelRatio', 'indexedDB', 'IDBKeyRange', 'WebSocket',
  'Worker', 'BroadcastChannel', 'MessageChannel', 'Notification', 'screen', 'self', 'globalThis',
  'undefined', 'NaN', 'Infinity', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean',
  'Symbol', 'BigInt', 'Date', 'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError',
  'ReferenceError', 'AggregateError', 'Promise', 'Proxy', 'Reflect', 'Map', 'Set', 'WeakMap',
  'WeakSet', 'WeakRef', 'ArrayBuffer', 'DataView', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray',
  'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array',
  'BigInt64Array', 'BigUint64Array', 'Intl', 'isNaN', 'isFinite', 'parseInt', 'parseFloat',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI', 'arguments', 'process',
  'MediaMetadata', 'AudioContext', 'webkitAudioContext', 'MediaRecorder', 'getSelection',
  'visualViewport', 'caches', 'ClipboardItem', 'FontFace', 'XMLHttpRequest', 'Option', 'CSS',
  'ErrorEvent', 'StorageEvent', 'FocusEvent', 'InputEvent', 'EventTarget', 'MessagePort',
  'PerformanceObserver', 'SVGElement', 'HTMLAnchorElement', 'reportError',
]);

function unresolvedIn(file) {
  const code = readFileSync(resolve(SRC, file), 'utf8');
  const ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx'], errorRecovery: false });
  const bad = [];
  traverse(ast, {
    ReferencedIdentifier(path) {
      const name = path.node.name;
      if (path.scope.hasBinding(name, true)) return;
      if (BROWSER_GLOBALS.has(name)) return;
      bad.push(`${name} @ ${file}:${path.node.loc.start.line}:${path.node.loc.start.column}`);
    },
  });
  return bad;
}

for (const file of FILES) {
  test(`no unresolved identifiers in ${file}`, () => {
    assert.deepEqual(unresolvedIn(file), []);
  });
}
