// Pure data shaping for the dashboard. No DOM access here.

export const REPORT_TZ = 'Europe/Stockholm';

export const TOKEN_TYPES = [
  { key: 'inputTokens', label: 'Input' },
  { key: 'outputTokens', label: 'Output' },
  { key: 'cacheCreationTokens', label: 'Cache write' },
  { key: 'cacheReadTokens', label: 'Cache read' },
];

const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: REPORT_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

// Today as YYYY-MM-DD in the report timezone.
export function reportToday(now = new Date()) {
  return dayFmt.format(now);
}

function sumTokens(obj) {
  return TOKEN_TYPES.reduce((s, t) => s + (obj[t.key] || 0), 0);
}

export function rowUnpriced(row) {
  return (row.modelBreakdowns ?? []).some((m) => m.missingPricing);
}

// Day of week for YYYY-MM-DD, Monday = 0.
function mondayIndex(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

// Inclusive date range for a named period in the report timezone.
// kind: 'today' | 'week' (Mon-Sun) | 'month' | 'day' (uses `day`).
export function periodRange(kind, now = new Date(), day = '') {
  const today = reportToday(now);
  if (kind === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return { from: day, to: day, label: day };
  }
  if (kind === 'all') {
    return { from: '0000-01-01', to: '9999-12-31', label: 'All time' };
  }
  if (kind === 'week') {
    const from = shiftDay(today, -mondayIndex(today));
    return { from, to: shiftDay(from, 6), label: `Week of ${from}` };
  }
  if (kind === 'month') {
    const from = `${today.slice(0, 7)}-01`;
    const [y, m] = today.split('-').map(Number);
    const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    return { from, to, label: today.slice(0, 7) };
  }
  return { from: today, to: today, label: `Today ${today}` };
}

// Token and cost totals for daily rows within [from, to].
export function summarize(daily, from, to) {
  const k = {
    days: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0,
    cacheCreationTokens: 0, cacheReadTokens: 0, cost: 0,
    unpriced: false, models: new Set(),
  };
  for (const r of daily) {
    if (r.period < from || r.period > to) continue;
    k.days += 1;
    k.totalTokens += r.totalTokens || 0;
    for (const t of TOKEN_TYPES) k[t.key] += r[t.key] || 0;
    k.cost += r.totalCost || 0;
    if (rowUnpriced(r)) k.unpriced = true;
    for (const m of r.modelsUsed ?? []) k.models.add(m);
  }
  const all = sumTokens(k);
  k.cacheReadShare = all > 0 ? k.cacheReadTokens / all : NaN;
  k.outputShare = all > 0 ? k.outputTokens / all : NaN;
  return k;
}

// Mon-Sun of this week, plus last week's total up to the same weekday.
export function weekOverview(daily, now = new Date()) {
  const { from } = periodRange('week', now);
  const today = reportToday(now);
  const byDate = new Map(daily.map((r) => [r.period, r]));
  const days = [];
  for (let i = 0; i < 7; i++) {
    const date = shiftDay(from, i);
    const r = byDate.get(date);
    days.push({ date, totalTokens: r?.totalTokens || 0,
      future: date > today });
  }
  const prevFrom = shiftDay(from, -7);
  const prevTo = shiftDay(today, -7);
  return {
    days,
    current: summarize(daily, from, today),
    previous: summarize(daily, prevFrom, prevTo),
  };
}

export function activeBlock(blocks) {
  return blocks.find((b) => b.isActive && !b.isGap) ?? null;
}

// Elapsed share and minutes left for a block at `now`.
export function blockProgress(block, now = new Date()) {
  const start = new Date(block.startTime).getTime();
  const end = new Date(block.endTime).getTime();
  const t = now.getTime();
  const span = end - start;
  const elapsed = span > 0 ? Math.min(1, Math.max(0, (t - start) / span))
    : 0;
  return { elapsed, minutesLeft: Math.max(0, Math.round((end - t) / 6e4)) };
}

// The most recent non-gap block that has ended.
export function lastBlock(blocks) {
  const done = blocks.filter((b) => !b.isGap && !b.isActive);
  return done.length ? done[done.length - 1] : null;
}

function shiftDay(ymd, delta) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

// One entry per day for the last `days` days, zero-filled.
export function lastNDays(daily, days = 30, now = new Date()) {
  const byDate = new Map(daily.map((r) => [r.period, r]));
  const today = reportToday(now);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = shiftDay(today, -i);
    const r = byDate.get(date) ?? {};
    const entry = { date };
    for (const t of TOKEN_TYPES) entry[t.key] = r[t.key] || 0;
    out.push(entry);
  }
  return out;
}

// Total tokens per model, largest first. Tail folds into "Other".
export function modelTotals(daily, maxSlices = 7) {
  const map = new Map();
  for (const r of daily) {
    for (const m of r.modelBreakdowns ?? []) {
      map.set(m.modelName, (map.get(m.modelName) || 0) + sumTokens(m));
    }
  }
  const sorted = [...map].map(([model, tokens]) => ({ model, tokens }))
    .sort((a, b) => b.tokens - a.tokens);
  if (sorted.length <= maxSlices) return sorted;
  const head = sorted.slice(0, maxSlices - 1);
  const rest = sorted.slice(maxSlices - 1)
    .reduce((s, x) => s + x.tokens, 0);
  return [...head, { model: 'Other', tokens: rest }];
}

// Flat per-day-per-model rows for the detail table.
export function tableRows(daily) {
  const rows = [];
  for (const r of daily) {
    for (const g of agentGroups(r)) {
      for (const m of g.modelBreakdowns ?? []) {
        rows.push(tableRow(r.period, g.agent, m));
      }
    }
  }
  return rows;
}

function tableRow(date, agent, m) {
  return {
    date,
    agent,
    model: m.modelName,
    inputTokens: m.inputTokens || 0,
    outputTokens: m.outputTokens || 0,
    cacheCreationTokens: m.cacheCreationTokens || 0,
    cacheReadTokens: m.cacheReadTokens || 0,
    totalTokens: sumTokens(m),
    cost: m.cost || 0,
    unpriced: Boolean(m.missingPricing),
  };
}

// ---------- Agent and model filters ----------

const AGENT_LABELS = {
  claude: 'Claude Code',
  codex: 'Codex',
  copilot: 'GitHub Copilot',
  qwen: 'Qwen',
  gemini: 'Gemini CLI',
};

export function agentLabel(agent) {
  return AGENT_LABELS[agent] ?? agent;
}

// Per-agent groups of a row. Claude-only rows have no agent info.
function agentGroups(row) {
  if (Array.isArray(row.agents)) return row.agents;
  const agent = row.agent && row.agent !== 'all' ? row.agent : 'claude';
  return [{ agent, modelBreakdowns: row.modelBreakdowns ?? [] }];
}

export function listAgents(rows) {
  const set = new Set();
  for (const r of rows) for (const g of agentGroups(r)) set.add(g.agent);
  return [...set].sort();
}

export function listModels(rows, agent = 'all') {
  const set = new Set();
  for (const r of rows) {
    for (const g of agentGroups(r)) {
      if (agent !== 'all' && g.agent !== agent) continue;
      for (const m of g.modelBreakdowns ?? []) set.add(m.modelName);
    }
  }
  return [...set].sort();
}

// Restricts a row to one agent and/or model. Totals are recomputed
// from the remaining model breakdowns. Returns null if nothing is left.
export function filterRow(row, { agent = 'all', model = 'all' } = {}) {
  if (agent === 'all' && model === 'all') return row;
  const keepModel = (m) => model === 'all' || m.modelName === model;
  const groups = agentGroups(row)
    .filter((g) => agent === 'all' || g.agent === agent)
    .map((g) => ({ ...g,
      modelBreakdowns: (g.modelBreakdowns ?? []).filter(keepModel) }))
    .filter((g) => g.modelBreakdowns.length);
  if (!groups.length) return null;

  // Top-level breakdowns: merge per model across the kept agents.
  const merged = new Map();
  for (const g of groups) {
    for (const m of g.modelBreakdowns) {
      const t = merged.get(m.modelName) ?? { modelName: m.modelName,
        inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0,
        cacheReadTokens: 0, cost: 0 };
      for (const k of TOKEN_TYPES) t[k.key] += m[k.key] || 0;
      t.cost += m.cost || 0;
      if (m.missingPricing) t.missingPricing = true;
      merged.set(m.modelName, t);
    }
  }
  const mbs = [...merged.values()];
  const out = { ...row, agents: groups, modelBreakdowns: mbs,
    modelsUsed: mbs.map((m) => m.modelName) };
  for (const k of TOKEN_TYPES) {
    out[k.key] = mbs.reduce((s, m) => s + m[k.key], 0);
  }
  out.totalTokens = sumTokens(out);
  out.totalCost = mbs.reduce((s, m) => s + m.cost, 0);
  return out;
}

export function filterRows(rows, filter) {
  return rows.map((r) => filterRow(r, filter)).filter(Boolean);
}
