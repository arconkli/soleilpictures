// Tiny awaitable concurrency limiter (p-limit style).
//
// Unlike backfillGate's fire-and-forget runGated, limit() returns a promise
// that resolves (or rejects) with the task's result, so a caller can `await`
// each task while bounding how many run at once. The motivating case: a
// multi-file image drop. Firing every optimistic decode at once made a 20-photo
// drop decode all 20 full-resolution images simultaneously — enough to blow past
// iOS Safari's per-tab memory ceiling and freeze the canvas. Routing each decode
// through a limiter keeps at most N in flight.

export function makeLimiter(max) {
  const cap = Math.max(1, max | 0);
  let active = 0;
  const queue = [];
  const pump = () => {
    if (active >= cap) return;
    const job = queue.shift();
    if (!job) return;
    active++;
    Promise.resolve()
      .then(job.task)
      .then(job.resolve, job.reject)
      .finally(() => { active--; pump(); });
  };
  return function limit(task) {
    return new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      pump();
    });
  };
}
