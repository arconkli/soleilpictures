// workerErrors.js — the Worker's rows (serverErrors.js): source 'worker', and
// the build that wrote them as the release, so Admin, Errors can say which
// deploy a server failure started on.

import { BUILD_SHA } from './buildInfo.js';
import { reportServerError, watchJob } from './serverErrors.js';

// A guard hands the door what it caught (worker.handleFetch records it).
export { answeredWith, answerOf } from './serverErrors.js';

export function reportWorkerError(env, ctx, info) {
  return reportServerError(env, ctx, { source: 'worker', release: BUILD_SHA, ...info });
}

// A scheduled job, watched (watchJob): a rejection is recorded, then thrown on.
export function watchWorkerJob(env, ctx, job, promise) {
  return watchJob(env, ctx, job, promise, { release: BUILD_SHA });
}

// A job's own catch, for a failure it swallows so the rest of its run goes on.
// The job awaits it: nothing else keeps the write alive past the job's end
// (it never rejects, and gives up after five seconds).
export function jobFailed(env, job, error, phase) {
  return reportWorkerError(env, null, { kind: 'job', job, error, phase });
}
