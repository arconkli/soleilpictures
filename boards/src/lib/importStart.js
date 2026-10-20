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
//   who(boardId) → { own, plan, ownerName, workspaceName, targetName,
//                    trialOffer, addon, interval, firstPayment, tier }
//   makeDeps({ targetBoardId, canAttemptFiles, source, sourceRef, placeTops })
//   ask(model) → 'cancel' | 'fit' | 'all'           the question (askCopy)
//   upgrade(offer, { stoppedBy })                    the cap wall, the storage
//                                                    gate or extra storage
//   hold({ key, boardId, limit, count, bytes, quota }) → id · unhold(id)
//   openBoard(id) · removeImport({ topIds, title })
//   wake(fn) → off                                   focus, billing changes
//   every(ms, fn) → off · log(name, props) · toast(t) · now()
//   clusterCost
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
import { askCopy } from './importCopy.js';
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
function firstName(input) {
  const e = input.entries?.[0];
  if (e?.name) return input.entries.length > 1 ? `${input.entries.length} folders` : e.name;
  const p = input.pickedFiles?.[0]?.webkitRelativePath;
  if (p) return p.split('/')[0];
  return input.title || 'Folder';
}

export async function startBulkImport(input, env) {
  const key = env.newKey();
  const source = input.source || 'drop';
  const reader = new AbortController();
  let title = firstName(input);
  const started = env.now();
  let stopped = false;
  // Cancel before the job exists: the tray lets go at once, and the flow
  // stops at its next step (the walk aborts; a queued one never takes its turn).
  const act = (id) => { if (id === 'cancel') { stopped = true; reader.abort(); env.drop(key); } };
  env.put(key, { phase: 'reading', title, source, reading: { files: 0, folders: 0, bytes: 0 }, act });

  // 1. Read the folder.
  let walked;
  try {
    const onProgress = ({ files = 0, clusters = 0 } = {}) => env.put(key, { reading: { files, folders: clusters, bytes: 0 } });
    walked = input.walked || (input.entries
      ? await env.walk(input.entries, { signal: reader.signal, onProgress })
      : await env.walkPicked(input.pickedFiles || [], { onProgress }));
  } catch (e) {
    env.drop(key);
    env.toast({ type: 'error', message: `The folder could not be read: ${e?.message || e}`, ttl: 8000 });
    return { loose: [], key: null };
  }
  const loose = Array.from(walked?.root?.files || []);
  if (stopped) { env.drop(key); return { loose: [], key: null }; }
  const tree = combineTrees([treeFromWalk(walked)]);
  const tops = tree.root.dirs;
  if (!tops.length) { env.drop(key); return { loose, key: null }; }
  title = tops.length === 1 ? tops[0].name : `${tops.length} folders`;
  env.put(key, { phase: 'queued', title, reading: { files: walked.files || 0, folders: walked.clusters || 0, bytes: 0 } });

  // 2. Its turn: one question and one running job at a time.
  const turn = takeLane();
  await turn.ready;
  if (stopped) { turn.free(); env.drop(key); return { loose, key: null }; }

  let job = null;
  try {
    const who = { ...(await env.who(input.boardId)) };
    const placeTops = input.placeTops || null;
    const deps = env.makeDeps({
      targetBoardId: input.boardId, canAttemptFiles: input.canAttemptFiles, source,
      sourceRef: { tops: tops.map((d) => d.name).slice(0, 50) }, placeTops,
    });

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

    // 4. Ask, when part of it would wait.
    let choice = 'fit';
    let model = null;
    if (plan.waiting.length) {
      env.put(key, { phase: 'asking' });
      model = askCopy({
        title, source: input.source === 'zip' ? 'zip' : 'folder', tops: tops.length,
        folders: walked.clusters || plan.clusters.length,
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
    const onChange = (snap) => {
      if (removed) return;   // the tray let it go; a late snapshot must not bring it back
      env.put(key, { snap });
      if (snap.status === lastStatus) return;
      const was = lastStatus;
      lastStatus = snap.status;
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

    job = createImportJob({ plan, title, deps, clusterCost: env.clusterCost, onChange });
    const tray = {
      pause: () => job.pause(),
      resume: () => job.resume(),
      cancel: () => job.cancel(),
      retry: () => job.retryFailed(),
      upgrade: () => { hold(job.state.waitingReason); env.upgrade(who.trialOffer ? 'trial' : 'upgrade', { stoppedBy: job.state.waitingReason }); },
      addon: () => { hold(job.state.waitingReason); env.upgrade('addon', { stoppedBy: 'storage' }); },
      open: () => { const top = job.state.tops.find((t) => t.boardId); if (top) env.openBoard(top.boardId); },
      // Closed when finished: let go of the job (and its files) with the entry.
      close: () => { removed = true; watch(false); unhold(); controllers.delete(key); env.drop(key); },
      remove: async () => {
        const topIds = job.state.tops.map((t) => t.boardId).filter(Boolean);
        removed = true;
        if (['idle', 'creating', 'running', 'paused', 'waiting'].includes(job.state.status)) await job.cancel();
        unhold();
        watch(false);
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
    env.log(EV.IMPORT_JOB, { ...base, phase: 'start', choice, fit: plan.fit.length, waiting: plan.waiting.length });
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
