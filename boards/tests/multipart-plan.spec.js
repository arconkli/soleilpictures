// Unit tests for the multipart part-planning math (lib/multipartPlan.js). The
// module is pure and dependency-free, so it runs straight in the Playwright Node
// process: no page, no DOM, no R2.

import { expect, test } from '@playwright/test';
import { planParts, computePartSize, MPU_MIN_PART } from '../src/lib/multipartPlan.js';

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

test('empty / non-positive inputs yield no parts', () => {
  expect(planParts(0, MPU_MIN_PART)).toEqual([]);
  expect(planParts(-5, MPU_MIN_PART)).toEqual([]);
  expect(planParts(100, 0)).toEqual([]);
});

test('parts tile the file exactly with no gaps or overlap', () => {
  const total = 100 * MiB + 12345;     // deliberately not a multiple of partSize
  const ps = computePartSize(total);
  const parts = planParts(total, ps);
  // contiguous + covering
  expect(parts[0].start).toBe(0);
  expect(parts[parts.length - 1].end).toBe(total);
  for (let i = 1; i < parts.length; i++) expect(parts[i].start).toBe(parts[i - 1].end);
  // sizes sum to the whole file
  const sum = parts.reduce((a, p) => a + (p.end - p.start), 0);
  expect(sum).toBe(total);
  // partNumbers are 1..N ascending (S3 requirement)
  parts.forEach((p, i) => expect(p.partNumber).toBe(i + 1));
});

test('all parts except the last are exactly partSize', () => {
  const total = 50 * MiB;
  const ps = computePartSize(total);
  const parts = planParts(total, ps);
  for (let i = 0; i < parts.length - 1; i++) expect(parts[i].end - parts[i].start).toBe(ps);
  expect(parts[parts.length - 1].end - parts[parts.length - 1].start).toBeLessThanOrEqual(ps);
});

test('part count stays under the 10000-part S3 cap across sizes (incl. 100GB)', () => {
  for (const total of [1, 5 * MiB, 8 * MiB, 1 * GiB, 5 * GiB, 100 * GiB]) {
    const ps = computePartSize(total);
    const parts = planParts(total, ps);
    expect(parts.length).toBeLessThanOrEqual(10000);
    expect(parts.reduce((a, p) => a + (p.end - p.start), 0)).toBe(total);
  }
});

test('small files use a single part at the 8 MiB floor', () => {
  expect(computePartSize(1)).toBe(MPU_MIN_PART);
  expect(computePartSize(5 * MiB)).toBe(MPU_MIN_PART);
  expect(planParts(5 * MiB, computePartSize(5 * MiB)).length).toBe(1);
});

test('part size scales up only when needed to stay under the cap', () => {
  // ~72GB is the threshold where 8 MiB parts would exceed the target divisor.
  expect(computePartSize(1 * GiB)).toBe(MPU_MIN_PART);   // 128 parts — floor is fine
  expect(computePartSize(100 * GiB)).toBeGreaterThan(MPU_MIN_PART);
});
