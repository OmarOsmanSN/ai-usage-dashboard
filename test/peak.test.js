import test from 'node:test';
import assert from 'node:assert/strict';
import { isPeak, splitPeak } from '../public/peak.js';

test('peak window in Pacific time, weekdays only', () => {
  // Wed 2026-10-21 05:00 PDT = 12:00Z.
  assert.equal(isPeak('2026-10-21T12:00:00Z'), true);
  assert.equal(isPeak('2026-10-21T11:59:00Z'), false);
  assert.equal(isPeak('2026-10-21T17:59:00Z'), true);
  assert.equal(isPeak('2026-10-21T18:00:00Z'), false);
  // Sat 2026-10-24 06:00 PDT.
  assert.equal(isPeak('2026-10-24T13:00:00Z'), false);
});

test('DST: same UTC hour flips across the switch', () => {
  // Fri 2026-03-06 (PST, UTC-8): 12:00Z is 04:00, off-peak.
  assert.equal(isPeak('2026-03-06T12:00:00Z'), false);
  // Mon 2026-03-09 (PDT, UTC-7): 12:00Z is 05:00, peak.
  assert.equal(isPeak('2026-03-09T12:00:00Z'), true);
  // Mon 2026-11-02 (PST again): 12:00Z is 04:00, off-peak.
  assert.equal(isPeak('2026-11-02T12:00:00Z'), false);
  assert.equal(isPeak('2026-11-02T13:00:00Z'), true);
});

test('splitPeak excludes gaps and flags unpriced', () => {
  const blk = (startTime, extra = {}) => ({
    startTime, isGap: false, totalTokens: 10, costUSD: 1,
    models: ['a'], tokenCounts: { outputTokens: 2 }, ...extra,
  });
  const r = splitPeak([
    blk('2026-10-21T12:00:00Z'),
    blk('2026-10-24T12:00:00Z', { models: ['x'] }),
    blk('2026-10-21T13:00:00Z', { isGap: true }),
  ], ['x']);
  assert.equal(r.peak.blocks, 1);
  assert.equal(r.offPeak.blocks, 1);
  assert.equal(r.peak.unpriced, false);
  assert.equal(r.offPeak.unpriced, true);
  assert.equal(r.peak.outputTokens, 2);
});
