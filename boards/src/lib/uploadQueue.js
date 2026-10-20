// Runs tasks a few at a time, in the order they were queued. Message uploads
// share one queue, so dropping ten photos starts three and the rest follow as
// those land, wherever in the app they were dropped. A task that throws
// settles its own promise and the queue moves on.

export function createTaskQueue(limit = 3) {
  const waiting = [];
  let running = 0;
  const next = () => {
    while (running < limit && waiting.length) {
      const { task, resolve, reject } = waiting.shift();
      running += 1;
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => { running -= 1; next(); });
    }
  };
  return {
    run(task) {
      return new Promise((resolve, reject) => { waiting.push({ task, resolve, reject }); next(); });
    },
    get running() { return running; },
    get waiting() { return waiting.length; },
  };
}

export const UPLOAD_CONCURRENCY = 3;
export const uploadQueue = createTaskQueue(UPLOAD_CONCURRENCY);
