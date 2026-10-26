import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildArgs, normalize, getReport, clearCache,
} from '../lib/ccusage.js';

const opts = { offline: true, scope: 'claude' };

test('buildArgs uses fixed flags and claude subcommand', () => {
  const a = buildArgs('daily', { ...opts, since: '20260101' });
  assert.match(a[0], /ccusage[\\/]src[\\/]cli\.js$/);
  assert.deepEqual(a.slice(1), [
    'claude', 'daily', '--breakdown', '--json',
    '--timezone', 'Europe/Stockholm', '--offline',
    '--since', '20260101',
  ]);
});

test('buildArgs all scope and online pricing', () => {
  const a = buildArgs('blocks', { offline: false, scope: 'all' });
  assert.deepEqual(a.slice(1), [
    'blocks', '--json', '--timezone', 'Europe/Stockholm',
    '--no-offline',
  ]);
});

test('hourly uses 1-hour blocks and normalizes to blocks', () => {
  const a = buildArgs('hourly', opts);
  assert.deepEqual(a.slice(1, 5),
    ['claude', 'blocks', '--session-length', '1']);
  assert.deepEqual(normalize('hourly', { blocks: [{ id: 'x' }] }),
    { blocks: [{ id: 'x' }] });
});

test('all scope adds --by-agent to breakdown reports', () => {
  const a = buildArgs('monthly', { offline: true, scope: 'all' });
  assert.equal(a.includes('--by-agent'), true);
  assert.equal(buildArgs('monthly', opts).includes('--by-agent'), false);
});

test('buildArgs rejects unknown commands', () => {
  assert.throws(() => buildArgs('statusline', opts));
  assert.throws(() => buildArgs('__proto__', opts));
});

test('normalize maps claude fields to period', () => {
  const d = normalize('daily', { daily: [{ date: '2026-10-01' }] });
  assert.equal(d.daily[0].period, '2026-10-01');
  assert.deepEqual(d.daily[0].modelBreakdowns, []);
  const m = normalize('monthly', { monthly: [{ month: '2026-10' }] });
  assert.equal(m.monthly[0].period, '2026-10');
  const s = normalize('session', { sessions: [{ sessionId: 'abc' }] });
  assert.equal(s.session[0].period, 'abc');
  const u = normalize('session', { session: [{ period: 'x' }] });
  assert.equal(u.session[0].period, 'x');
});

test('cache shares in-flight runs and skips failures', async () => {
  clearCache();
  let calls = 0;
  const run = async () => { calls++; return { blocks: [] }; };
  await Promise.all([
    getReport('blocks', opts, run), getReport('blocks', opts, run),
  ]);
  assert.equal(calls, 1);

  let fails = 0;
  const bad = async () => { fails++; throw new Error('x'); };
  const o2 = { ...opts, since: '20260101' };
  await assert.rejects(getReport('blocks', o2, bad));
  await assert.rejects(getReport('blocks', o2, bad));
  assert.equal(fails, 2);
});
