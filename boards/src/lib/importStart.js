// importStart — one bulk import from the drop to the end: read the folder,
// plan it against the room the plan has, ask when part of it would wait, run
// the job, and keep the tray's entry (lib/importJobs.js) current until the
// person closes it.
//
// Everything with a network, React or browser side is App's, handed in as
// `env`, so this reads as the flow it is and the tests drive it with fakes:
//   newKey() · put(key, fields) · drop(key)        the tray's store
//   walk(entries, { signal, onProgress })          a drop (folderWalk)
//   walkPicked(files, { onProgress })              a picker's files
//   askZip(model) → 'unpack' | 'keep' | 'cancel'    the zip question (zipAskCopy)
//   who(boardId) → { own, plan, ownerName, workspaceName, targetName,
//                    trialOffer, addon, interval, firstPayment, tier }
//   makeDeps({ targetBoardId, canAttemptFiles, source, kind, sourceRef, placeTops })
//   ask(model) → 'cancel' | 'fit' | 'all'           the question (askCopy)
//   upgrade(offer, { stoppedBy })                    the cap wall, the storage
//                                                    gate or extra storage
//   hold({ key, boardId, limit, count, bytes, quota }) → id · unhold(id)
//   openBoard(id) · removeImport({ topIds, title })
//   wake(fn) → off                                   focus, billing changes
//   every(ms, fn) → off · log(name, props) · toast(t) · now()
//   clusterCost · limits (importLimitsFor: the inflate ceiling for this device)
// and for an import a reload stopped (lib/importResume.js, offerStopped):
//   stoppedFor({ boardId, tops }) → { jobId, key } | null   one of these folders here
//   loadSeed(jobId) → seed                           what its ledger says came in
//   lock(jobId) → release                            held while this tab runs it
//   saveHandles(jobId, record) · loadHandles(jobId) · dropHandles(jobId) · pruneHandles(ids)
//   findStopped() → jobs · isLive(boardId) · has(key) · setJobStatus(jobId, status)
//
// One import asks and runs at a time (`lane`): a second drop reads at once
// and waits its turn for the question, so two dialogs never stack and the
// question is asked against the room left after the import ahead. A job
// leaves the lane as soon as it stops running — waiting for room, paused,
// done — so one that waits for an upgrade doesn't hold up the next. One
// released from waiting doesn't queue again: the server decides every card,
// so two running at once only share what is left.
//
// Waiting for room is watched here: the job knows what its next file needs
// (`next`), and the budgets are read on focus, on a billing change from the
// checkout tab, when the held-drop watcher releases the import's hold, and
// every WAIT_POLL_MS. Room → release(), which fills again from where it
// stopped. The hold (lib/heldUploads.js, via 'import') is what makes a
// checkout open in a new tab while an import waits in this one.

import { createImportJob } from './importJob.js';
import { planBulk } from './importPlan.js';
import { treeFromWalk, combineTrees } from './importTree.js';
import { askCopy, zipAskCopy } from './importCopy.js';
import { isZipFile, canUnpackZips, zipGroups, readZips } from './importZips.js';
import { stoppedTitle, askToRead } from './importResume.js';
import { entryOfHandle } from './folderWalk.js';
import { EV } from './analyticsEvents.js';

export const WAIT_POLL_MS = 30000;

const controllers = new Map();   // key → { poke() }

// The held-drop watcher released this import's hold (the plan or the drive
// grew): look for room now rather than at the next poll.
export function pokeImport(key) {
  controllers.get(key)?.poke();
}

let lane = Promise.resolve();
function takeLane() {
  let release;
  const mine = new Promise((r) => { release = r; });
  const before = lane;
  lane = before.then(() => mine);
  let freed = false;
  return { ready: before, free: () => { if (!freed) { freed = true; release(); } } };
}

// The name an import goes by before its folder has been read.
function firstName(input, zips) {
  const e = input.entries?.[0];
  if (e?.name) return input.entries.length > 1 ? `${input.entries.length} folders` : e.name;
  const p = input.pickedFiles?.[0]?.webkitRelativePath;
  if (p) return p.split('/')[0];
  if (zips.length) return zips.length > 1 ? `${zips.length} zips` : String(zips[0].name || 'Zip').replace(/\.zip$/i, '');
  return input.title || 'Folder';
}

// input: { entries (a drop's) | pickedFiles (a folder picker's) | walked,
//          zips, files (loose; the zips among them are asked about),
//          askZips (false: picked as zips to unpack), boardId,
//          canAttemptFiles, source, placeTops,
//          handles (the drop's FileSystemHandle promises, kept for a resume),
//          resume ({ jobId, key }: the tray's Resume of a stopped import) }
// → { loose (files to add the ordinary way), key (the tray entry, or null) }
export async function startBulkImport(input, env) {
  const source = input.source || 'drop';

  // 0. Zips: unpack them into clusters, or add them as they are. Asked from
  // names and sizes before anything is read, outside the lane (nothing can be
  // dropped behind an open question), and not at all when the person picked
  // them to unpack. Escape lets go of the whole drop, as the cap question does.
  const given = Array.from(input.files || []);
  let zips = [...Array.from(input.zips || []), ...given.filter(isZipFile)];
  const extra = given.filter((f) => !isZipFile(f));
  if (zips.length) {
    let unpack = canUnpackZips() && input.askZips === false;
    if (canUnpackZips() && input.askZips !== false) {
      const choice = await env.askZip(zipAskCopy({ zips: zips.map((z) => ({ name: z.name, size: z.size })), groups: zipGroups(zips) }));
      env.log(EV.IMPORT_JOB, { source: `bulk_${source}`, board_id: input.boardId, phase: 'zip_question', choice, n_zips: zips.length });
      if (choice === 'cancel') return { loose: [], key: null };
      unpack = choice === 'unpack';
    }
    if (!unpack) { extra.push(...zips); zips = []; }
  }
  const folder = !!(input.walked || input.entries?.length || input.pickedFiles?.length);
  if (!folder && !zips.length) return { loose: extra, key: null };
  const kind = folder ? 'folder' : 'zip';

  const key = env.newKey();
  const reader = new AbortController();
  let title = firstName(input, zips);
  const started = env.now();
  let stopped = false;
  // Cancel before the job exists: the tray lets go at once, and the flow
  // stops at its next step (the walk aborts; a queued one never takes its turn).
  const act = (id) => { if (id === 'cancel') { stopped = true; reader.abort(); env.drop(key); } };
  env.put(key, { phase: 'reading', title, source: kind, zips: zips.length, reading: { files: 0, folders: 0, bytes: 0 }, act });

  // 1. Read the folder, then the zips' directories.
  let walked = null;
  let unzipped = null;
  try {
    let walkedSoFar = { files: 0, folders: 0 };
    const show = ({ files = 0, folders = 0, bytes = 0 } = {}) => env.put(key, {
      reading: { files: walkedSoFar.files + files, folders: walkedSoFar.folders + folders, bytes },
    });
    if (folder) {
      const onProgress = ({ files = 0, clusters = 0 } = {}) => { walkedSoFar = { files, folders: clusters }; show(); };
      walked = input.walked || (input.entries
        ? await env.walk(input.entries, { signal: reader.signal, onProgress })
        : await env.walkPicked(input.pickedFiles, { onProgress }));
      walkedSoFar = { files: walked?.files || 0, folders: walked?.clusters || 0 };
    }
    if (zips.length && !stopped) unzipped = await readZips(zips, { signal: reader.signal, onProgress: show, limits: env.limits });
  } catch (e) {
    env.drop(key);
    env.toast({ type: 'error', message: `The ${kind} could not be read: ${e?.message || e}`, ttl: 8000 });
    return { loose: [], key: null };
  }
  // What isn't part of the tree is added the ordinary way: files beside the
  // folder, zips kept as they are, and a ".zip" that turned out not to be one.
  const loose = [...extra, ...Array.from(walked?.root?.files || []), ...(unzipped?.notZips || [])];
  if (stopped) { env.drop(key); return { loose: [], key: null }; }
  const tree = combineTrees([...(walked ? [treeFromWalk(walked)] : []), ...(unzipped?.trees || [])]);
  const tops = tree.root.dirs;
  if (!tops.length) { env.drop(key); return { loose, key: null }; }
  title = tops.length === 1 ? tops[0].name : `${tops.length} folders`;
  env.put(key, { phase: 'queued', title, reading: { files: tree.stats.files || 0, folders: tree.stats.clusters || 0, bytes: 0 } });
  // A stopped import of these folders into this cluster — the tray's Resume,
  // or the same folders dropped here again — goes on where it stopped, and
  // what landed is skipped (lib/importResume.js).
  const again = input.resume || env.stoppedFor?.({ boardId: input.boardId, tops: tops.map((d) => d.name) }) || null;

  // 2. Its turn: one question and one running job at a time.
  const turn = takeLane();
  await turn.ready;
  if (stopped) { turn.free(); env.drop(key); return { loose, key: null }; }

  let job = null;
  try {
    const who = { ...(await env.who(input.boardId)) };
    const placeTops = input.placeTops || null;
    const deps = env.makeDeps({
      targetBoardId: input.boardId, canAttemptFiles: input.canAttemptFiles, source, kind,
      sourceRef: {
        tops: tops.map((d) => d.name).slice(0, 50),
        ...(unzipped ? { zips: zips.map((z) => z.name).slice(0, 50) } : {}),
      },
      placeTops,
    });

    // Its ledger first: the clusters it made and the files that landed. Only
    // then does its stopped entry make way for this one.
    let seed = null;
    if (again) {
      seed = await env.loadSeed(again.jobId);
      if (again.key) env.drop(again.key);
    }

    // 3. Plan it against the room there is now. A budget that can't be read
    // is no limit, as the drop preflight fails open: the server still
    // decides every card and every file.
    let budgets;
    try { budgets = await deps.budgets(); } catch (_) { budgets = { cardsLeft: Infinity, bytesLeft: Infinity }; }
    const plan = planBulk(tree.root, {
      clusterCost: env.clusterCost, cardsLeft: budgets.cardsLeft, bytesLeft: budgets.bytesLeft,
      canAttemptFiles: input.canAttemptFiles,
    });
    // Cancelled from the tray while the room was being read.
    if (stopped) { turn.free(); env.drop(key); return { loose, key: null }; }
    if (!plan.totals.files && !plan.clusters.length) {
      turn.free();
      env.drop(key);
      if (!loose.length) env.toast({ type: 'info', message: 'Nothing in that folder could be added.' });
      return { loose, key: null };
    }
    const base = { source: `bulk_${source}`, board_id: input.boardId, n_files: plan.totals.files, n_clusters: plan.clusters.length };

    // 4. Ask, when part of it would wait — once: an import going on was
    // asked when it began.
    let choice = 'fit';
    let model = null;
    if (plan.waiting.length && !seed) {
      env.put(key, { phase: 'asking' });
      model = askCopy({
        title, source: kind, zips: zips.length, tops: tops.length,
        folders: tree.stats.clusters || plan.clusters.length,
        splits: plan.clusters.filter((c) => c.part?.index === 1).map((c) => ({ name: c.name.replace(/ · 1 of \d+$/, ''), of: c.part.of })),
        totals: plan.totals, fit: plan.fitTotals, waiting: { files: plan.waiting.length },
        stoppedBy: plan.stoppedBy, budgets, clusterCost: env.clusterCost, ...who,
      });
      env.log(EV.IMPORT_PREFLIGHT, { ...base, action: 'view', take: plan.fit.length, over: plan.waiting.length, limit: plan.stoppedBy });
      choice = await env.ask(model);
      const action = choice === 'all' ? (model.offerKind === 'addon' ? 'add_storage' : 'upgrade') : choice === 'fit' ? 'partial' : 'cancel';
      env.log(EV.IMPORT_PREFLIGHT, { ...base, action, take: plan.fit.length, over: plan.waiting.length, limit: plan.stoppedBy });
      if (choice === 'cancel' || stopped) { turn.free(); env.drop(key); return { loose, key: null }; }
    }

    // 5. Run.
    let heldId = null;
    const hold = (limit, quota) => {
      if (heldId || !who.own) return;
      const s = job?.state;
      heldId = env.hold({
        key, boardId: input.boardId, limit: limit || plan.stoppedBy || 'cards',
        count: s ? s.waiting.files : plan.waiting.length, bytes: s ? s.waiting.bytes : plan.waiting.reduce((n, it) => n + it.bytes, 0),
        quota: quota ?? budgets.quota ?? null,
      });
    };
    const unhold = () => { if (heldId) { env.unhold(heldId); heldId = null; } };

    let offWake = null;
    let offPoll = null;
    let checking = false;
    const check = async () => {
      if (checking || job?.state.status !== 'waiting') return;
      checking = true;
      try {
        const need = job.state.next;
        const b = await deps.budgets();
        if (need && b.cardsLeft >= need.cards && b.bytesLeft >= need.bytes) {
          env.log(EV.IMPORT_JOB, { ...base, phase: 'resume', reason: job.state.waitingReason });
          job.release();   // not awaited: it runs until the next stop, and reports through onChange
        }
      } catch (_) { /* the next wake or poll tries again */ } finally { checking = false; }
    };
    const watch = (on) => {
      if (on && !offPoll) {
        offWake = env.wake(() => { check(); });
        offPoll = env.every(WAIT_POLL_MS, () => { check(); });
      } else if (!on && offPoll) {
        offWake?.(); offPoll(); offWake = null; offPoll = null;
      }
    };
    controllers.set(key, { poke: () => { check(); } });

    let lastStatus = null;
    let removed = false;
    // Once the job has its id: this tab holds its lock, and keeps what it was
    // dropped from, so a reload can offer to go on (lib/importResume.js).
    let unlock = null;
    let kept = false;
    const own = (id) => {
      if (!id) return;
      if (!unlock) unlock = env.lock?.(id) || (() => {});
      if (kept || !input.handles?.length || !env.saveHandles) return;
      kept = true;
      Promise.all(input.handles).then((hs) => {
        const handles = hs.filter((h) => h && (h.kind === 'directory' || (h.kind === 'file' && isZipFile(h))));
        if (handles.length && !removed && !['done', 'cancelled'].includes(job?.state.status)) return env.saveHandles(id, { kind, handles });
        return null;
      }).catch(() => {});
    };
    const letGo = (id) => {
      unlock?.();
      unlock = null;
      if (id) env.dropHandles?.(id);
    };
    const onChange = (snap) => {
      if (removed) return;   // the tray let it go; a late snapshot must not bring it back
      env.put(key, { snap });
      if (snap.status !== 'done' && snap.status !== 'cancelled') own(snap.id);
      if (snap.status === lastStatus) return;
      const was = lastStatus;
      lastStatus = snap.status;
      if (snap.status === 'done' || snap.status === 'cancelled') letGo(snap.id);
      if (!['creating', 'running', 'idle'].includes(snap.status)) turn.free();
      if (snap.status === 'waiting') {
        // The words follow the plan as it is now: a trial's drive fills, an
        // upgrade lands. Then hold, so a checkout opens in a new tab.
        // Both only if it is still waiting by then: room may have been found
        // meanwhile, and a hold left behind would send every checkout to a new tab.
        Promise.resolve().then(() => env.who(input.boardId)).then((w) => {
          if (removed) return;
          Object.assign(who, w);
          env.put(key, w);
        }, () => {}).then(() => {
          if (!removed && job.state.status === 'waiting') hold(job.state.waitingReason);
        });
        watch(true);
        check();
        env.log(EV.IMPORT_JOB, { ...base, phase: 'waiting', reason: snap.waitingReason, landed: snap.landed.files, waiting: snap.waiting.files });
      } else {
        watch(false);
        if (was === 'waiting') unhold();
      }
      if (['done', 'cancelled', 'failed'].includes(snap.status)) {
        env.log(EV.FOLDER_IMPORT, {
          ...base, bulk: true, placed: snap.landed.files, failed: snap.failed.length, waiting: snap.waiting.files,
          cancelled: snap.status === 'cancelled', stopped: snap.status === 'failed' ? 'error' : null, ms: env.now() - started,
        });
      }
    };

    job = createImportJob({ plan, title, deps, clusterCost: env.clusterCost, onChange, seed });
    const tray = {
      pause: () => job.pause(),
      resume: () => job.resume(),
      cancel: () => job.cancel(),
      retry: () => job.retryFailed(),
      upgrade: () => { hold(job.state.waitingReason); env.upgrade(who.trialOffer ? 'trial' : 'upgrade', { stoppedBy: job.state.waitingReason }); },
      addon: () => { hold(job.state.waitingReason); env.upgrade('addon', { stoppedBy: 'storage' }); },
      open: () => { const top = job.state.tops.find((t) => t.boardId); if (top) env.openBoard(top.boardId); },
      // Closed when finished: let go of the job (and its files) with the entry.
      // Closing one that failed keeps what is in and lets the rest go, as
      // Stop does, so no later load offers to go on with it.
      close: () => {
        const s = job.state;
        if (s.status === 'failed' && s.id) Promise.resolve(deps.setJob(s.id, { status: 'cancelled' })).catch(() => {});
        removed = true; watch(false); unhold(); letGo(s.id); controllers.delete(key); env.drop(key);
      },
      remove: async () => {
        const topIds = job.state.tops.map((t) => t.boardId).filter(Boolean);
        removed = true;
        if (['idle', 'creating', 'running', 'paused', 'waiting'].includes(job.state.status)) await job.cancel();
        else if (job.state.status === 'failed' && job.state.id) await Promise.resolve(deps.setJob(job.state.id, { status: 'cancelled' })).catch(() => {});
        unhold();
        watch(false);
        letGo(job.state.id);
        controllers.delete(key);
        env.drop(key);
        if (topIds.length) await env.removeImport({ topIds, title });
        env.log(EV.IMPORT_JOB, { ...base, phase: 'removed', landed: job.state.landed.files });
      },
    };
    env.put(key, { phase: 'job', snap: job.state, act: (id) => tray[id]?.(), ...who });

    // Buying from the question: hold first (so checkout opens in a new tab),
    // then open the offer. What fits comes in meanwhile.
    if (choice === 'all') {
      hold(plan.stoppedBy);
      env.upgrade(model?.offerKind, { stoppedBy: plan.stoppedBy });
    }
    env.log(EV.IMPORT_JOB, seed
      ? { ...base, phase: 'restart', how: input.resume ? 'handles' : 'drop', landed: seed.landed.length }
      : { ...base, phase: 'start', choice, fit: plan.fit.length, waiting: plan.waiting.length });
    job.start().finally(() => {
      turn.free();
      // A stop to wait, seen while the job was still unwinding, couldn't be
      // released then (it was busy): look again now that it is still.
      if (job.state.status === 'waiting') check();
    });
    return { loose, key };
  } catch (e) {
    turn.free();
    env.drop(key);
    env.toast({ type: 'error', message: `The import could not start: ${e?.message || e}`, ttl: 8000 });
    return { loose, key: null };
  }
}

// Imports a reload or a closed tab stopped before they finished (lib/
// importResume.js), offered in the tray (mockup r4-Tray-Reload / Tray-Drop).
// Resume, where this browser kept what one was dropped from (Chromium): it
// asks to read the folder again inside the click, then goes on through
// startBulkImport. Elsewhere the words say to drop it again, and
// startBulkImport finds it by its folders (stoppedFor). Remove ends the job
// and takes what came in to the trash, with App's Undo. One entry a job
// however often this runs, and none for a job whose clusters are gone.
// `offered` collects the keys as they go up, and an aborted `signal` puts up
// no more, so the workspace that asked can take its entries with it.
export async function offerStopped(env, { signal = null, offered = [] } = {}) {
  let jobs = [];
  try { jobs = await env.findStopped(); } catch (_) { return offered; }
  if (signal?.aborted) return offered;
  const live = (jobs || []).filter((j) => env.isLive(j.target_board_id) && (j.root_board_ids || []).every((id) => env.isLive(id)));
  env.pruneHandles?.(live.map((j) => j.id));
  for (const job of live) {
    const key = `stopped-${job.id}`;
    if (env.has?.(key)) continue;
    const kept = await env.loadHandles?.(job.id);
    const handles = (kept?.handles || []).filter(Boolean);
    const canResume = handles.length > 0 && handles.every((h) => typeof h.requestPermission === 'function');
    const title = stoppedTitle(job.source_ref);
    const who = { ...(await env.who(job.target_board_id)) };
    if (signal?.aborted) return offered;
    const landed = Number(job.done?.files) || 0;
    const base = { source: `bulk_${job.source}`, board_id: job.target_board_id, n_files: Number(job.totals?.files) || 0 };
    let busy = false;
    const act = async (id) => {
      if (busy) return;
      busy = true;
      try {
        if (id === 'resume' && canResume) {
          // First, inside the click: the browser's prompt needs it.
          if (!(await askToRead(handles))) {
            env.toast({ type: 'info', message: `${title} can’t be read again without your permission. Drop it on ${who.targetName || 'its cluster'} again to bring the rest.`, ttl: 8000 });
            return;
          }
          const dirs = handles.filter((h) => h.kind === 'directory');
          const zips = (await Promise.all(handles.filter((h) => h.kind === 'file').map((h) => h.getFile().catch(() => null)))).filter(Boolean);
          await startBulkImport({
            ...(dirs.length ? { entries: dirs.map(entryOfHandle) } : {}), zips, askZips: false,
            boardId: job.target_board_id, canAttemptFiles: who.plan !== 'free', source: 'resume',
            resume: { jobId: job.id, key }, handles: handles.map((h) => Promise.resolve(h)),
          }, env);
        } else if (id === 'remove') {
          env.drop(key);
          try { await env.setJobStatus(job.id, 'cancelled'); } catch (_) { /* offered again on the next load */ }
          env.dropHandles?.(job.id);
          const topIds = (job.root_board_ids || []).filter(Boolean);
          if (topIds.length) await env.removeImport({ topIds, title });
          env.log(EV.IMPORT_JOB, { ...base, phase: 'removed', landed, stopped: true });
        }
      } finally { busy = false; }
    };
    env.put(key, {
      phase: 'stopped', title, canResume, landed, total: Number(job.totals?.files) || 0,
      targetName: who.targetName || null, act,
      stopped: { jobId: job.id, targetBoardId: job.target_board_id, source: job.source, tops: job.source_ref?.tops || [], zips: job.source_ref?.zips || [] },
    });
    offered.push(key);
    env.log(EV.IMPORT_JOB, { ...base, phase: 'stopped', status: job.status, landed, can_resume: canResume });
  }
  return offered;
}
