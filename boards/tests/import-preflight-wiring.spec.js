// import-preflight-wiring.spec.js — every bulk drop path asks the cap question
// BEFORE bytes move, and the answer is recorded.
//
// The dialog itself renders in the harness (?local=1&importask=…, see
// ImportCapDialog specs); the ROUTING is App.jsx-only, which ?local=1 never
// mounts, so it is asserted on code shape.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, new URL('../', import.meta.url)), 'utf8');
const app = () => read('src/App.jsx');
const canvas = () => read('src/components/CanvasSurface.jsx');

test.describe('import preflight wiring', () => {
  test('the canvas drop and picker path preflight through the mutator', () => {
    const s = canvas();
    expect(s).toMatch(/await mutators\.preflightImport\(\{ n: classified, kinds, source \}\)/);
    // The answer is authoritative: the accepted list is trimmed to `take`.
    expect(s).toMatch(/if \(keep < classified\) accepted\.splice\(keep\)/);
  });

  test('the list-view drop path preflights too, instead of slicing silently', () => {
    const s = app();
    const fn = s.slice(s.indexOf('const ingestFilesArranged = async'), s.indexOf('// 2)', s.indexOf('const ingestFilesArranged = async')));
    expect(fn).toMatch(/await preflightImport\(\{ n: nClassified, kinds: classifiedKinds, source: 'list_drop' \}\)/);
    expect(fn).toMatch(/accepted = accepted\.slice\(0, keep\)/);
    // The classification totals are captured BEFORE the cap can trim them, so
    // n_accepted keeps meaning "passed the file-type gate" on both paths.
    expect(fn).toMatch(/const nClassified = accepted\.length/);
  });

  test('every outcome of the question is a row: view, blocked, and the chosen action', () => {
    const s = app();
    const pre = s.slice(s.indexOf('const preflightImport = async'), s.indexOf('const addCard = ('));
    expect(pre).toMatch(/action: 'blocked'/);
    expect(pre).toMatch(/action: 'view'/);
    // The three buttons resolve through ONE path that logs the action.
    const ans = s.slice(s.indexOf('const answerImportAsk = useCallback'), s.indexOf('const capPitchedAtRef'));
    expect(ans).toMatch(/logEventNow\(EV\.IMPORT_PREFLIGHT, \{\s*action, n_files: ask\.n, take/);
    // Upgrade must CLAIM the moment, not merely set the reason. On 2026-09-17
    // — the first and so far only time anyone has pressed this button — the
    // cap-hit modal opened and was replaced by the storage gate in the same
    // second, because the same 65-file drop also carried non-standard files
    // and an unclaimed slot had nothing to defer to. Recorded dwell on the
    // screen the person had just asked for: 16 ms.
    // openCapWall is the one helper every deliberate cap-wall open goes
    // through; it claims the slot before setting the reason. upsellPacing.test
    // .mjs pins that ordering — here we only pin that this button uses it.
    expect(ans).toMatch(/if \(action === 'upgrade'\) openCapWall\(\);/);
  });

  test('an unresolved cap pays for one round trip rather than gambling the folder', () => {
    const s = app();
    const pre = s.slice(s.indexOf('const preflightImport = async'), s.indexOf('const addCard = ('));
    expect(pre).toMatch(/if \(plan\.outcome === 'unresolved'\)[\s\S]*refetch/);
  });
});
