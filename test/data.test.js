import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lastNDays, modelTotals, tableRows, reportToday, periodRange,
  summarize, weekOverview, blockProgress, filterRow, filterRows,
  listAgents, listModels,
} from '../public/data.js';

const now = new Date('2026-10-23T10:00:00Z');
const row = (period, extra = {}) => ({
  period, inputTokens: 1, outputTokens: 2, cacheCreationTokens: 3,
  cacheReadTokens: 4, totalTokens: 10, totalCost: 1,
  modelBreakdowns: [{ modelName: 'm1', inputTokens: 1, outputTokens: 2,
    cacheCreationTokens: 3, cacheReadTokens: 4, cost: 1 }],
  ...extra,
});

test('reportToday uses Stockholm date', () => {
  // 23:30Z on Oct 31 is already Nov 1 in Stockholm (CET).
  assert.equal(reportToday(new Date('2026-10-31T23:30:00Z')),
    '2026-11-01');
});

test('periodRange: today, week (Mon-Sun), month, day', () => {
  // 2026-10-23 is a Friday.
  assert.deepEqual(periodRange('today', now),
    { from: '2026-10-23', to: '2026-10-23', label: 'Today 2026-10-23' });
  const w = periodRange('week', now);
  assert.equal(w.from, '2026-10-19');
  assert.equal(w.to, '2026-10-25');
  const m = periodRange('month', now);
  assert.equal(m.from, '2026-10-01');
  assert.equal(m.to, '2026-10-31');
  assert.equal(periodRange('day', now, '2026-09-02').from, '2026-09-02');
  const all = periodRange('all', now);
  assert.equal(all.from <= '2000-01-01' && all.to >= '2100-01-01', true);
  // Invalid day falls back to today.
  assert.equal(periodRange('day', now, 'bad').from, '2026-10-23');
});

test('summarize sums the range only and flags unpriced', () => {
  const k = summarize([row('2026-10-01'), row('2026-09-30')],
    '2026-10-01', '2026-10-31');
  assert.equal(k.totalTokens, 10);
  assert.equal(k.cacheReadShare, 0.4);
  assert.equal(k.unpriced, false);
  const u = summarize([row('2026-10-02', {
    modelBreakdowns: [{ modelName: 'x', missingPricing: true }],
  })], '2026-10-01', '2026-10-31');
  assert.equal(u.unpriced, true);
});

test('weekOverview compares with last week to the same weekday', () => {
  const w = weekOverview([
    row('2026-10-20'), row('2026-10-23'),
    row('2026-10-13'), row('2026-10-17'),
  ], now);
  assert.equal(w.days.length, 7);
  assert.equal(w.days[0].date, '2026-10-19');
  assert.equal(w.days[6].future, true);
  assert.equal(w.current.totalTokens, 20);
  // 10-17 (Sat) is after the same weekday (Fri 10-16), so excluded.
  assert.equal(w.previous.totalTokens, 10);
});

test('blockProgress clamps and counts minutes left', () => {
  const b = { startTime: '2026-10-23T08:00:00Z',
    endTime: '2026-10-23T13:00:00Z' };
  const p = blockProgress(b, new Date('2026-10-23T10:30:00Z'));
  assert.equal(p.elapsed, 0.5);
  assert.equal(p.minutesLeft, 150);
  assert.equal(blockProgress(b, new Date('2026-10-24T00:00:00Z'))
    .elapsed, 1);
});

test('lastNDays zero-fills and ends today', () => {
  const d = lastNDays([row('2026-10-20')], 30, now);
  assert.equal(d.length, 30);
  assert.equal(d.at(-1).date, '2026-10-23');
  assert.equal(d[0].date, '2026-09-24');
  assert.equal(d.find((x) => x.date === '2026-10-20').outputTokens, 2);
});

test('modelTotals folds tail into Other', () => {
  const rows = [1, 2, 3].map((i) => row('2026-10-01', {
    modelBreakdowns: [{ modelName: `m${i}`, outputTokens: i }],
  }));
  const t = modelTotals(rows, 2);
  assert.deepEqual(t.map((x) => x.model), ['m3', 'Other']);
  assert.equal(t[1].tokens, 3);
});

test('tableRows flattens per model', () => {
  const t = tableRows([row('2026-10-01')]);
  assert.equal(t[0].totalTokens, 10);
  assert.equal(t[0].model, 'm1');
});

test('filterRow by agent and model recomputes totals', () => {
  const mb = (modelName, n, extra = {}) => ({ modelName,
    inputTokens: n, outputTokens: n, cacheCreationTokens: n,
    cacheReadTokens: n, cost: n, ...extra });
  const r = {
    period: '2026-10-01', agents: [
      { agent: 'claude', modelBreakdowns: [mb('opus', 1), mb('sonnet', 2)] },
      { agent: 'codex', modelBreakdowns: [mb('gpt', 10,
        { missingPricing: true })] },
    ],
  };
  assert.deepEqual(listAgents([r]), ['claude', 'codex']);
  assert.deepEqual(listModels([r], 'claude'), ['opus', 'sonnet']);

  const c = filterRow(r, { agent: 'claude' });
  assert.equal(c.totalTokens, 12);
  assert.equal(c.totalCost, 3);
  assert.deepEqual(c.agents.map((g) => g.agent), ['claude']);

  const g = filterRow(r, { model: 'gpt' });
  assert.equal(g.totalTokens, 40);
  assert.equal(g.modelBreakdowns[0].missingPricing, true);

  assert.equal(filterRow(r, { agent: 'claude', model: 'gpt' }), null);
  assert.equal(filterRows([r], { agent: 'qwen' }).length, 0);
  // Session rows carry a single agent field.
  const s = { period: 'id', agent: 'codex',
    modelBreakdowns: [mb('gpt', 1)] };
  assert.equal(filterRow(s, { agent: 'claude' }), null);
  assert.equal(filterRow(s, { agent: 'codex' }).totalTokens, 4);
});

test('tableRows includes the agent per row', () => {
  const t = tableRows([{ period: '2026-10-01', agents: [
    { agent: 'codex', modelBreakdowns: [{ modelName: 'gpt',
      outputTokens: 5 }] }] }]);
  assert.equal(t[0].agent, 'codex');
  assert.equal(t[0].totalTokens, 5);
});
