// lib/clipboardWrite.js: a link that has to be made first still reaches the
// clipboard on Safari, because the write starts inside the tap.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeClipboard } from './clipboardWrite.js';

const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const setNavigator = (value) => Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });

class FakeItem { constructor(data) { this.data = data; } }

afterEach(() => {
  if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
  else delete globalThis.navigator;
  delete globalThis.ClipboardItem;
  delete globalThis.document;
});

// A clipboard that records what it was asked, in the order it was asked.
function fakeClipboard({ write = true, writeText = true } = {}) {
  const calls = [];
  const clip = {};
  if (write !== null) {
    clip.write = async (items) => {
      calls.push('write');
      if (!write) throw new Error('NotAllowedError');
      const blob = await items[0].data['text/plain'];
      clip.text = await blob.text();
    };
  }
  clip.writeText = async (text) => {
    calls.push('writeText');
    if (!writeText) throw new Error('NotAllowedError');
    clip.text = text;
  };
  return { clip, calls };
}

test('a promise: the write starts before the text has arrived', async () => {
  const { clip, calls } = fakeClipboard();
  setNavigator({ clipboard: clip });
  globalThis.ClipboardItem = FakeItem;
  let arrive;
  const text = new Promise((r) => { arrive = r; });
  const done = writeClipboard(text);
  // Synchronously, inside the "tap": nothing has been awaited yet.
  assert.deepEqual(calls, ['write']);
  arrive('https://x.test/share/abc');
  assert.equal(await done, true);
  assert.equal(clip.text, 'https://x.test/share/abc');
  assert.deepEqual(calls, ['write']);
});

test('a promise, the item write refused: the text is written the plain way', async () => {
  const { clip, calls } = fakeClipboard({ write: false });
  setNavigator({ clipboard: clip });
  globalThis.ClipboardItem = FakeItem;
  assert.equal(await writeClipboard(Promise.resolve('link')), true);
  assert.equal(clip.text, 'link');
  assert.deepEqual(calls, ['write', 'writeText']);
});

test('a promise, no ClipboardItem: the text is awaited and written', async () => {
  const { clip, calls } = fakeClipboard({ write: null });
  setNavigator({ clipboard: clip });
  assert.equal(await writeClipboard(Promise.resolve('link')), true);
  assert.equal(clip.text, 'link');
  assert.deepEqual(calls, ['writeText']);
});

test('a promise that rejects or comes back empty is false, and nothing is thrown', async () => {
  for (const withItem of [true, false]) {
    const { clip } = fakeClipboard();
    setNavigator({ clipboard: clip });
    if (withItem) globalThis.ClipboardItem = FakeItem; else delete globalThis.ClipboardItem;
    assert.equal(await writeClipboard(Promise.reject(new Error('rpc failed'))), false);
    assert.equal(await writeClipboard(Promise.resolve('')), false);
    assert.equal(clip.text, undefined);
  }
  assert.equal(await writeClipboard(null), false);
});

test('a string goes straight to writeText', async () => {
  const { clip, calls } = fakeClipboard();
  setNavigator({ clipboard: clip });
  globalThis.ClipboardItem = FakeItem;
  assert.equal(await writeClipboard('plain'), true);
  assert.equal(clip.text, 'plain');
  assert.deepEqual(calls, ['writeText']);
});

test('writeText refused: the hidden-field copy is tried, and its answer returned', async () => {
  const { clip } = fakeClipboard({ writeText: false });
  setNavigator({ clipboard: clip });
  const made = [];
  globalThis.document = {
    createElement: () => {
      const ta = { style: {}, setAttribute() {}, select() {}, remove() { ta.removed = true; } };
      made.push(ta);
      return ta;
    },
    body: { appendChild() {} },
    execCommand: (cmd) => cmd === 'copy',
  };
  assert.equal(await writeClipboard('plain'), true);
  assert.equal(made[0].value, 'plain');
  assert.equal(made[0].removed, true);
  globalThis.document.execCommand = () => false;
  assert.equal(await writeClipboard('plain'), false);
  // No clipboard and no document at all: false, not a throw.
  delete globalThis.document;
  setNavigator({});
  assert.equal(await writeClipboard('plain'), false);
});
