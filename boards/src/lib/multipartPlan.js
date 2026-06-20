// Pure multipart-planning math for the "upload any file type" feature. Kept
// dependency-free (no supabase/DOM imports) so it unit-tests straight in the
// Playwright Node process — see tests/multipart-plan.spec.js.
//
// The CLIENT always uploads using the partSize the PARTY returns from
// /mpu/create; computePartSize here exists for tests + as documentation of the
// agreed formula and MUST stay in sync with party/upload.ts's copy.

const MiB = 1024 * 1024;
export const MPU_MIN_PART = 8 * MiB;        // R2/S3 floor is 5 MiB; 8 keeps part count sane
export const MPU_MAX_PARTS_TARGET = 9000;   // < 10000 hard cap, leaves headroom

// Part size grows with file size so part count stays under the 10000-part cap;
// floored at 8 MiB and rounded up to a whole MiB so client + server agree.
export function computePartSize(totalBytes) {
  const raw = Math.max(MPU_MIN_PART, Math.ceil((totalBytes || 0) / MPU_MAX_PARTS_TARGET));
  return Math.ceil(raw / MiB) * MiB;
}

// Split a file into [{ partNumber, start, end }] using a given part size.
export function planParts(totalBytes, partSize) {
  const parts = [];
  if (!(totalBytes > 0) || !(partSize > 0)) return parts;
  let n = 1;
  for (let start = 0; start < totalBytes; start += partSize) {
    parts.push({ partNumber: n++, start, end: Math.min(start + partSize, totalBytes) });
  }
  return parts;
}
