import test from 'node:test';
import assert from 'node:assert/strict';
import { compact, costLabel, csvCell, toCsv } from '../public/format.js';

test('compact numbers', () => {
  assert.equal(compact(999), '999');
  assert.equal(compact(1234), '1.2k');
  assert.equal(compact(3_400_000), '3.4M');
  assert.equal(compact(2_000_000), '2M');
  assert.equal(compact(3.47e9), '3.5B');
});

test('cost labels never show $0 for unpriced', () => {
  assert.equal(costLabel(0, true), 'Unpriced');
  assert.equal(costLabel(12.5, true), '$12.50 + unpriced');
  assert.equal(costLabel(0, false), '$0.00');
});

test('csv escaping and formula injection', () => {
  assert.equal(csvCell('=SUM(A1)'), '\'=SUM(A1)');
  assert.equal(csvCell('-1+2'), '\'-1+2');
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  assert.equal(csvCell(5), '5');
  assert.equal(toCsv(['h'], [['x']]), 'h\r\nx\r\n');
});
