// A file the converter makes no view of, and why (the view record's reason).
// Shared by view.js and zipJob.js, so a refusal from either is told apart from
// a failure the same way.
export class Refused extends Error {
  constructor(reason, message = reason) {
    super(message);
    this.reason = reason;
  }
}
