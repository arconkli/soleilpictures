// Runs tasks a few at a time, in the order they were queued. Message uploads
// share one queue, so dropping ten photos starts three and the rest follow as
// those land, wherever in the app they were dropped. A task that throws
// settles its own promise and the queue moves on.

export function createTaskQueue(limit = 3) {
  const waiting = [];
  let running = 0;
  const next = () => {
    while (running < limit && waiting.length) {
      const { task, resolve, reject, onAbort, signal } = waiting.shift();
      if (onAbort) signal.removeEventListener('abort', onAbort);
      running += 1;
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => { running -= 1; next(); });
    }
  };
  return {
    // An optional abort signal lets a caller that gives up while still waiting
    // for a slot leave the line at once; once the task starts, the queue no
    // longer listens to it (the task watches its own signal).
    run(task, { signal } = {}) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(new Error('aborted')); return; }
        const entry = { task, resolve, reject, onAbort: null, signal };
        if (signal) {
          entry.onAbort = () => {
            const i = waiting.indexOf(entry);
            if (i >= 0) waiting.splice(i, 1);
            reject(new Error('aborted'));
          };
          signal.addEventListener('abort', entry.onAbort, { once: true });
        }
        waiting.push(entry);
        next();
      });
    },
    get running() { return running; },
    get waiting() { return waiting.length; },
  };
}

export const UPLOAD_CONCURRENCY = 3;
export const uploadQueue = createTaskQueue(UPLOAD_CONCURRENCY);
