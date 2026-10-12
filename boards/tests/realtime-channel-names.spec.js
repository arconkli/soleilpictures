// realtime-channel-names.spec.js
//
// realtime-js returns an existing channel with the same topic, even one that
// is still leaving, and subscribe() on it is a no-op; its bindings die when
// the leave completes. A hook whose component remounts (every <Workspace> on a
// workspace switch) must therefore name its channel per mount, or it silently
// stops receiving events. SHARE-12 was "Shared with me" going quiet that way.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

for (const [file, prefix] of [
  ['src/hooks/useSharedBoards.js', 'shared-boards:${userId}'],
  ['src/hooks/useCanvasComments.js', 'comments:${boardId}'],
]) {
  test(`${file} names its channel per mount`, () => {
    const s = read(file);
    expect(s).toContain('const sfx = Math.random().toString(36).slice(2, 9);');
    expect(s).toContain(`.channel(\`${prefix}:\${sfx}\`)`);
  });
}
