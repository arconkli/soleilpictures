// importResume — a bulk import that outlived its tab: finding it, and what its
// runner needs to go on from where it stopped.
//
// An import runs in the tab it was dropped in (lib/importJob.js), but its
// ledger is on the server (0430: import_jobs, import_folders, import_items).
// When that tab reloads or closes mid-import, the next load finds the job
// still marked running, paused, waiting or failed, and the tray offers it
// (lib/importStart.js offerStopped): Resume, where this browser kept the
// folder's handle (Chromium, lib/importHandles.js); otherwise drop it again —
// the same folders dropped on the same cluster continue the job, and what
// landed is skipped (mockup r4-Tray-Reload / Tray-Drop).
//
// Stopped, or running in another tab? The tab running a job holds a Web Lock
// named for it (lockImport) until the job ends or the tab goes. A job whose
// lock nobody holds is stopped.
//
// Pure apart from what it's handed: the Supabase client, navigator.locks and
// the handles.

export const IMPORT_LOCK = 'soleil-import:';
export const STOPPED_WITHIN_DAYS = 30;
const UNFINISHED = ['running', 'paused', 'waiting', 'failed'];
const DAY_MS = 24 * 60 * 60 * 1000;

// Hold the job's lock while this tab runs it. → release(). Without Web Locks,
// or when another tab holds it, there is nothing to release.
export function lockImport(locks, jobId) {
  if (typeof locks?.request !== 'function' || !jobId) return () => {};
  let release = null;
  let letGo = false;
  try {
    Promise.resolve(locks.request(IMPORT_LOCK + jobId, { mode: 'exclusive', ifAvailable: true }, (lock) => (
      lock ? new Promise((r) => { release = r; if (letGo) r(); }) : null
    ))).catch(() => {});
  } catch (_) { /* no lock: the job still runs */ }
  return () => { letGo = true; release?.(); };
}

// The ids of the imports some tab of this browser is running now.
export async function runningImportIds(locks) {
  if (typeof locks?.query !== 'function') return new Set();
  try {
    const { held = [] } = await locks.query();
    return new Set(held.map((l) => String(l?.name || ''))
      .filter((n) => n.startsWith(IMPORT_LOCK)).map((n) => n.slice(IMPORT_LOCK.length)));
  } catch (_) { return new Set(); }
}

// This person's imports into the workspace that stopped before they finished:
// unfinished on the server, touched in the last STOPPED_WITHIN_DAYS, and
// running in no tab. Oldest first. A read that fails finds none.
export async function findStoppedImports({ supabase, workspaceId, locks = null, now = Date.now() }) {
  if (!supabase || !workspaceId) return [];
  const { data, error } = await supabase.from('import_jobs')
    .select('id, target_board_id, source, source_ref, status, waiting_reason, totals, done, root_board_ids, updated_at')
    .eq('workspace_id', workspaceId)
    .in('status', UNFINISHED)
    .gte('updated_at', new Date(now - STOPPED_WITHIN_DAYS * DAY_MS).toISOString())
    .order('created_at', { ascending: true })
    .limit(20);
  if (error || !Array.isArray(data)) return [];
  const running = await runningImportIds(locks);
  return data.filter((j) => !running.has(j.id));
}

// What a stopped job's runner starts from (importJob's seed): the cluster each
// folder became, the files that landed, and the card id each file it started
// was given, so a card already on its cluster is found again, not doubled.
// Read a page at a time: a job can have tens of thousands of files.
export async function loadImportSeed({ supabase, jobId, pageSize = 1000 }) {
  const every = async (table, cols) => {
    const rows = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase.from(table).select(cols)
        .eq('job_id', jobId).order('rel_path', { ascending: true }).range(from, from + pageSize - 1);
      if (error) throw Object.assign(new Error(error.message || `${table} could not be read`), { code: error.code });
      rows.push(...(data || []));
      if (!data || data.length < pageSize) return rows;
    }
  };
  const [folders, items] = await Promise.all([
    every('import_folders', 'rel_path, board_id'),
    every('import_items', 'rel_path, status, card_id'),
  ]);
  return {
    jobId,
    created: folders.map((f) => [f.rel_path, f.board_id]),
    landed: items.filter((i) => i.status === 'landed').map((i) => i.rel_path),
    cardIds: items.filter((i) => i.card_id).map((i) => [i.rel_path, i.card_id]),
  };
}

// The tray's name for a stopped import, as importStart names a running one:
// its folder, or how many.
export function stoppedTitle(sourceRef) {
  const tops = Array.isArray(sourceRef?.tops) ? sourceRef.tops : [];
  if (tops.length === 1) return String(tops[0]);
  if (tops.length > 1) return `${tops.length} folders`;
  const zips = Array.isArray(sourceRef?.zips) ? sourceRef.zips : [];
  if (zips.length === 1) return String(zips[0]).replace(/\.zip$/i, '');
  return zips.length ? `${zips.length} zips` : 'Import';
}

// Is this drop what a stopped import was bringing in — the same top folders
// (by name, in any order; importStart keeps the first 50) on the same
// cluster? → that tray entry, or null.
const sameNames = (a, b) => {
  const x = [...(a || [])].slice(0, 50).map(String).sort();
  const y = [...(b || [])].slice(0, 50).map(String).sort();
  return x.length > 0 && x.length === y.length && x.every((n, i) => n === y[i]);
};
export function matchStopped(entries, { boardId, tops }) {
  return (entries || []).find((e) => e?.phase === 'stopped' && e.stopped?.targetBoardId === boardId
    && sameNames(e.stopped.tops, tops)) || null;
}

// Read the folders again (Chromium): called inside the click that asked, so
// the browser can show its prompt. → true once every one can be read.
export async function askToRead(handles) {
  const list = (handles || []).filter(Boolean);
  if (!list.length) return false;
  for (const h of list) {
    if (typeof h.queryPermission !== 'function' || typeof h.requestPermission !== 'function') return false;
    try {
      let state = await h.queryPermission({ mode: 'read' });
      if (state !== 'granted') state = await h.requestPermission({ mode: 'read' });
      if (state !== 'granted') return false;
    } catch (_) { return false; }
  }
  return true;
}
