import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, isRealDate, ValidationError } from
  '../lib/validate.js';

const q = (s) => parseQuery(new URLSearchParams(s));

test('defaults: offline on, claude scope', () => {
  assert.deepEqual(q(''), {
    since: undefined, until: undefined, offline: true, scope: 'claude',
  });
});

test('accepts valid dates and toggles', () => {
  const r = q('since=20260101&until=20261231&offline=0&scope=all');
  assert.equal(r.since, '20260101');
  assert.equal(r.offline, false);
  assert.equal(r.scope, 'all');
});

test('rejects bad input', () => {
  for (const s of [
    'since=2026-01-01', 'since=20261301', 'since=20260230',
    'since=20260102&until=20260101', 'offline=yes', 'scope=codex',
    'foo=1', 'since=20260101&since=20260102', 'until=--json',
  ]) {
    assert.throws(() => q(s), ValidationError, s);
  }
});

test('isRealDate handles leap years', () => {
  assert.equal(isRealDate('20240229'), true);
  assert.equal(isRealDate('20250229'), false);
});
