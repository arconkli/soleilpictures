// Pure-logic tests for the shared file-ingest routing (lib/fileIngest.js) —
// the single source of truth for canvas + list drop classification.
import { expect, test } from '@playwright/test';
import { classifyDropFile, sizeBucket, FREE_VIDEO_CAP } from '../src/lib/fileIngest.js';

const f = (name, type, size = 1000) => ({ name, type, size });

test.describe('classifyDropFile', () => {
  test('images always route as image cards, regardless of paid state', () => {
    expect(classifyDropFile(f('a.png', 'image/png'), { canAttemptFiles: false }).route).toBe('image');
    expect(classifyDropFile(f('a.heic', 'image/heic'), { canAttemptFiles: false }).route).toBe('image');
  });

  test('empty-MIME HEIC/HEIF falls back on the extension (camera-roll photos stay free)', () => {
    // Some pickers surface iPhone photos with an empty type — without the
    // extension guard they became paid-gated generic file cards.
    expect(classifyDropFile(f('IMG_0042.HEIC', ''), { canAttemptFiles: false }).route).toBe('image');
    expect(classifyDropFile(f('IMG_0042.heif', ''), { canAttemptFiles: false }).route).toBe('image');
    // An unknown empty-MIME extension still hard-blocks for free owners.
    expect(classifyDropFile(f('archive.zip', ''), { canAttemptFiles: false }).route).toBe('blocked');
  });

  test('over-cap media routes to multipart for paid, blocked for free owners', () => {
    const big = f('clip.mp4', 'video/mp4', FREE_VIDEO_CAP + 1);
    expect(classifyDropFile(big, { canAttemptFiles: true }).route).toBe('largeMedia');
    expect(classifyDropFile(big, { canAttemptFiles: false }).route).toBe('blocked');
  });
});

test.describe('sizeBucket', () => {
  test('buckets bytes into low-cardinality analytics ranges', () => {
    const MB = 1024 * 1024;
    expect(sizeBucket(0)).toBe('lt_10mb');
    expect(sizeBucket(9 * MB)).toBe('lt_10mb');
    expect(sizeBucket(10 * MB)).toBe('10_50mb');
    expect(sizeBucket(199 * MB)).toBe('50_200mb');
    expect(sizeBucket(500 * MB)).toBe('200mb_1gb');
    expect(sizeBucket(2048 * MB)).toBe('gt_1gb');
  });
});
