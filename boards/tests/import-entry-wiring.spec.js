// import-entry-wiring.spec.js — a folder or zips dropped on the List view is
// a bulk import, as on the board, and only where bulk import is on.
//
// The routing is App.jsx-only and ?local=1 (LocalBoardsApp) never mounts it,
// and an OS folder drag can't be simulated, so it is asserted on code shape,
// as import-preflight-wiring.spec.js does.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, new URL('../', import.meta.url)), 'utf8');

test.describe('bulk import entry wiring', () => {
  test('the List view reads a folder off the drop before anything else can take it, and zips after a version drop', () => {
    const s = read('src/components/ListSurface.jsx');
    const drop = s.slice(s.indexOf('const handleDrop = (e) => {'), s.indexOf('// URLs / plain text still have no home'));
    const folder = drop.indexOf('if (hasDirectory(entries)) { tree({ entries }); return; }');
    const version = drop.indexOf('if (canVersionHere && dropped?.length === 1');
    const zips = drop.indexOf('if (onImportTree && Array.from(dropped || []).some(isZipFile)) { tree({ files: Array.from(dropped) }); return; }');
    const ingest = drop.indexOf('onDropFilesToCluster?.(e.dataTransfer.files');
    expect(folder).toBeGreaterThan(0);
    // A folder is never a file's next version; one zip onto a zip still is.
    expect(folder).toBeLessThan(version);
    expect(zips).toBeGreaterThan(version);
    expect(zips).toBeLessThan(ingest);
    // View-only clusters refuse a drop before any of it.
    expect(drop.indexOf('if (!canEdit) {')).toBeLessThan(folder);
    // The handles go with it (Resume after a reload), and loose files the ordinary way.
    expect(drop).toMatch(/const handles = captureDropHandles\(e\.dataTransfer\);\s*Promise\.resolve\(onImportTree\(\{ \.\.\.input, handles, source: 'list' \}, \{ boardId: board\.id \}\)\)/);
    expect(drop).toMatch(/if \(out\?\.loose\?\.length\) onDropFilesToCluster\?\.\(out\.loose, \{ boardId: board\.id \}\)/);
  });

  test("App gives the zip reader this device's inflate ceiling: a phone unpacks far less", () => {
    const s = read('src/App.jsx');
    const env = s.slice(s.indexOf('const bulkImportEnv = useCallback(() => ({'), s.indexOf('makeDeps: ({ targetBoardId'));
    expect(env).toContain('limits: importLimitsFor({ lowMemory: lowMemoryDevice() }),');
  });

  test('App hands the sidebar the bulk import for a folder or zips dropped on a cluster row, only where it is on', () => {
    const s = read('src/App.jsx');
    const sidebar = s.slice(s.indexOf('<ClusterSidebar'), s.indexOf('uploadsByBoard={sidebarUploads}'));
    expect(sidebar).toMatch(/onImportTreeOnCluster=\{bulkImportAllowed\(\) \? \(boardId, input\) => importFolder\(\{\s*\.\.\.input, boardId, canAttemptFiles: bulkImportEnv\(\)\.who\(boardId\)\.plan !== 'free', boardWasEmpty: false,\s*\}\) : null\}/);
    // ClusterSidebar reads the drop before anything can take it: the folder
    // check and the handles are taken in the drop handler, before any await.
    const bar = read('src/components/sidebar/ClusterSidebar.jsx');
    expect(bar).toMatch(/const entries = onImportTreeOnCluster \? captureDropEntries\(e\.dataTransfer\) : \[\];/);
  });

  test('App hands the List view the bulk import only where it is on, through importFolder', () => {
    const s = read('src/App.jsx');
    expect(s).toMatch(/onImportTree=\{bulkImportAllowed\(\) \? \(input, \{ boardId \}\) => importFolder\(\{\s*\.\.\.input, boardId, canAttemptFiles: bulkImportEnv\(\)\.who\(boardId\)\.plan !== 'free', boardWasEmpty: false,\s*\}\) : null\}/);
  });

  test("the tray's guide: opened from the Upload menu only where bulk import is on, it imports as the menu does", () => {
    const s = read('src/App.jsx');
    // The Upload menu's last item, through ClusterSidebar's meterProps spread.
    const meter = s.slice(s.indexOf('meterProps={{'), s.indexOf('onOpenPlan={() => openSettings('));
    expect(meter).toContain('onOpenGuide: bulkImportAllowed() ? () => openImportGuide() : null,');
    // A zip dropped anywhere while it is open is what it asked for: no question.
    const start = s.indexOf('const bulkImportEnv = useCallback(() => ({');
    const env = s.slice(start, s.indexOf('}), [workspace?.id, workspace?.created_by', start));
    expect(env).toContain('unpackZips: () => isImportGuideOpen(),');
    expect(env).toContain('askZip: (model) => new Promise((resolve) => setZipAsk({ model, resolve })),');
    // Its drops and picks go where the Upload menu's do: the open cluster
    // when it can be edited, else one the person picks.
    const props = s.slice(s.indexOf('const importGuideProps = () => {'), s.indexOf('// Imports a reload or a closed tab stopped'));
    expect(props).toContain("onImport: (input) => uploadTreeFromSidebar({ ...input, askZips: false, source: 'guide' }, 'Import into…'),");
    expect(props).toMatch(/const here = currentSurface === 'board' && currentBoard\?\.id && canEditBoard\(currentBoard\.id\) \? currentBoard : null;/);
    // A tablet's browser can't pick a folder either: iPadOS reports
    // webkitdirectory and still opens a file picker.
    expect(props).toContain('canFolder: !mobileShell && !isTouch,');
    expect(s).toMatch(/\{bulkImportAllowed\(\) && <ImportTray aboveNav=\{mobileShell\} guide=\{importGuideProps\(\)\}\s+besideMessages=\{floatingChrome && !!tweak\.showMessages\} \/>\}/);
    // The tray reads a drop on the guide while it is being dispatched.
    const tray = read('src/components/ImportTray.jsx');
    const drop = tray.slice(tray.indexOf('const onDrop = (e) => {'), tray.indexOf('return (', tray.indexOf('const onDrop = (e) => {')));
    expect(drop).toMatch(/const entries = captureDropEntries\(e\.dataTransfer\);\s*const handles = captureDropHandles\(e\.dataTransfer\);/);
    expect(drop.indexOf('captureDropEntries')).toBeLessThan(drop.indexOf('send('));
  });
});
