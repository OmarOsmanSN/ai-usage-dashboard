// Dashboard UI: fetch, render overview, cards, charts and tables.

import {
  compact, full, percent, costLabel, toCsv,
} from './format.js';
import { splitPeak } from './peak.js';
import {
  REPORT_TZ, TOKEN_TYPES, activeBlock, lastNDays, modelTotals,
  tableRows, rowUnpriced, periodRange, summarize, weekOverview,
  blockProgress, lastBlock, reportToday, agentLabel, listAgents,
  listModels, filterRows,
} from './data.js';

const ENDPOINTS = ['daily', 'monthly', 'session', 'blocks', 'hourly'];

const state = {
  scope: 'all',
  agent: 'all',
  model: 'all',
  offline: true,
  data: {},
  errors: {},
  charts: {},
  rows: [],
  sort: { key: 'date', dir: -1 },
  period: 'today',
  day: '',
  loaded: false,
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const $ = (sel, root = document) => root.querySelector(sel);

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: REPORT_TZ, hour: '2-digit', minute: '2-digit',
});
const dayTimeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: REPORT_TZ, day: '2-digit', month: 'short',
  hour: '2-digit', minute: '2-digit',
});
const stampFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: REPORT_TZ, dateStyle: 'medium', timeStyle: 'medium',
});

// Element helper. Text only, never innerHTML with data.
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c !== null && c !== undefined) node.append(c);
  }
  return node;
}

// Compact number with the full value in a tooltip.
function num(n, tag = 'span') {
  const props = { title: full(n), text: compact(n) };
  if (tag !== 'span') props.class = 'num';
  return el(tag, props);
}

function cssVar(name) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name).trim();
}

function series(i) {
  return cssVar(`--series-${(i % 8) + 1}`);
}

// ---------- Data loading ----------

async function fetchJson(name) {
  const q = new URLSearchParams({
    scope: state.scope,
    offline: state.offline ? '1' : '0',
  });
  const res = await fetch(`/api/${name}?${q}`);
  let body = null;
  try {
    body = await res.json();
  } catch {
    // Fall through to the generic error below.
  }
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body;
}

function setLoading(on) {
  const btn = $('#refresh');
  btn.disabled = on;
  btn.textContent = on ? 'Loading…' : 'Refresh';
  if (on) {
    document.querySelectorAll(
      '.kpi .value, .mini, .chart-box, #peak-body, .table-wrap',
    ).forEach((n) => n.classList.add('skeleton'));
  }
}

async function load() {
  setLoading(true);
  const results = await Promise.allSettled(ENDPOINTS.map(fetchJson));
  state.data = {};
  state.errors = {};
  results.forEach((r, i) => {
    const name = ENDPOINTS[i];
    if (r.status === 'fulfilled') state.data[name] = r.value;
    else state.errors[name] = r.reason?.message || 'Request failed';
  });
  setLoading(false);
  state.loaded = true;
  render();
}

// ---------- Rendering ----------

function showError(card, message) {
  const p = $('.error', card);
  if (!p) return;
  p.hidden = !message;
  p.textContent = message ? `Could not load data: ${message}` : '';
}

function done(node) {
  node.classList.remove('skeleton');
}

function render() {
  const { blocks, hourly } = state.data;
  const raw = state.data.daily?.daily;
  renderFilterOptions(raw);
  const daily = viewRows('daily');
  const monthly = viewRows('monthly');
  const session = viewRows('session');
  const failed = Object.keys(state.errors);
  const banner = $('#banner');
  banner.hidden = failed.length === 0;
  banner.textContent = failed.length
    ? `Some data failed to load (${failed.join(', ')}). ` +
      'Other sections are still shown.'
    : '';

  const unpricedModels =
    state.data.daily?.totals?.unpricedModels ?? [];
  $('#updated').textContent =
    `Updated ${stampFmt.format(new Date())} · ` + filterLabel() +
    (unpricedModels.length
      ? ` · Unpriced: ${unpricedModels.join(', ')}` : '');

  renderOverview(daily);
  renderBlock(blocks?.blocks, unpricedModels);
  renderWeek(daily);
  renderDaily(daily);
  renderModels(daily);
  renderMonthly(monthly);
  renderPeak(hourly?.blocks, unpricedModels);
  state.rows = daily ? tableRows(daily) : [];
  renderTable();
  renderSessions(session);
}

// Report rows for one endpoint with the agent/model filter applied.
function viewRows(name) {
  const rows = state.data[name]?.[name];
  if (!rows) return undefined;
  return filterRows(rows, { agent: state.agent, model: state.model });
}

function filterLabel() {
  const agent = state.agent === 'all'
    ? 'All agents' : agentLabel(state.agent);
  return state.model === 'all' ? agent : `${agent} · ${state.model}`;
}

function fillSelect(select, allText, values, label = (v) => v) {
  select.replaceChildren(el('option', { value: 'all', text: allText }),
    ...values.map((v) => el('option', { value: v, text: label(v) })));
}

function renderFilterOptions(raw) {
  const rows = raw ?? [];
  const agents = listAgents(rows);
  if (state.agent !== 'all' && !agents.includes(state.agent)) {
    state.agent = 'all';
  }
  const models = listModels(rows, state.agent);
  if (state.model !== 'all' && !models.includes(state.model)) {
    state.model = 'all';
  }
  fillSelect($('#g-agent'), 'All agents', agents, agentLabel);
  fillSelect($('#g-model'), 'All models', models);
  $('#g-agent').value = state.agent;
  $('#g-model').value = state.model;
}

function setKpi(id, value, sub) {
  const card = $(id);
  const v = $('.value', card);
  done(v);
  v.replaceChildren(value);
  if (sub !== undefined) $('.sub', card).replaceChildren(sub);
}

function swatch(color) {
  const sw = el('span', { class: 'swatch' });
  sw.style.background = color;
  return sw;
}

function pressOnly(selector, attr, value) {
  for (const b of document.querySelectorAll(selector)) {
    b.setAttribute('aria-pressed', String(b.getAttribute(attr) === value));
  }
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function renderOverview(daily) {
  const card = $('#overview');
  showError(card, state.errors.daily);
  pressOnly('[data-period]', 'data-period', state.period);
  const breakdown = $('#ov-breakdown');
  breakdown.replaceChildren();
  if (!daily) {
    for (const id of ['#kpi-total', '#kpi-output', '#kpi-cache',
      '#kpi-cost']) {
      setKpi(id, '—', 'No data');
    }
    return;
  }
  const r = periodRange(state.period, new Date(), state.day);
  const dates = daily.map((d) => d.period).sort();
  $('#ov-range').textContent = state.period === 'all'
    ? (dates.length
      ? `All time · ${dates[0]} → ${dates.at(-1)}` : 'All time')
    : (r.from === r.to ? r.from : `${r.from} → ${r.to}`);
  const k = summarize(daily, r.from, r.to);

  setKpi('#kpi-total', num(k.totalTokens), k.days
    ? `${plural(k.days, 'active day')} · ${plural(k.models.size, 'model')}`
    : 'No usage in this period');
  setKpi('#kpi-output', num(k.outputTokens),
    `${percent(k.outputShare)} of all tokens`);
  setKpi('#kpi-cache', percent(k.cacheReadShare),
    el('span', {}, num(k.cacheReadTokens), ' cache-read tokens'));
  setKpi('#kpi-cost', el('span', {
    text: costLabel(k.cost, k.unpriced),
    title: k.unpriced
      ? 'Some models have no price data; total excludes them' : '',
  }));

  if (!k.totalTokens) return;
  const bar = el('div', { class: 'stack-bar', role: 'img',
    'aria-label': 'Token mix by type' });
  const legend = el('div', { class: 'legend-row' });
  TOKEN_TYPES.forEach((t, i) => {
    const v = k[t.key];
    if (v > 0) {
      const seg = el('span', { title: `${t.label}: ${full(v)}` });
      seg.style.flex = String(v);
      seg.style.minWidth = '3px';
      seg.style.background = series(i);
      bar.append(seg);
    }
    legend.append(el('span', {}, swatch(series(i)), t.label,
      el('b', { text: full(v) })));
  });
  breakdown.append(bar, legend);
}

function stat(label, value) {
  return el('div', {}, el('dt', { text: label }), el('dd', {}, value));
}

function hoursMinutes(mins) {
  const h = Math.floor(mins / 60);
  return h ? `${h}h ${mins % 60}m` : `${mins}m`;
}

function blockUnpriced(b, unpricedModels) {
  return (b.models ?? []).some((m) => unpricedModels.includes(m));
}

function renderBlock(blocks, unpricedModels) {
  const card = $('#block-card');
  const body = $('#block-body');
  done(body);
  showError(card, state.errors.blocks);
  body.replaceChildren();
  if (!blocks) return;

  const b = activeBlock(blocks);
  if (!b) {
    body.append(
      el('div', { class: 'headline' }, el('span', { class: 'big' },
        el('span', { class: 'status-dot' }), 'Idle')),
      el('p', { class: 'muted',
        text: 'No active block. The next Claude Code message ' +
          'starts a new 5-hour block.' }));
    const last = lastBlock(blocks);
    if (last) {
      const end = last.actualEndTime ?? last.endTime;
      body.append(
        el('p', { class: 'muted', text: 'Last block: ' +
          `${dayTimeFmt.format(new Date(last.startTime))} – ` +
          timeFmt.format(new Date(end)) }),
        el('dl', { class: 'stats' },
          stat('Tokens', num(last.totalTokens)),
          stat('Output', num(last.tokenCounts?.outputTokens)),
          stat('Est. cost', costLabel(last.costUSD,
            blockUnpriced(last, unpricedModels)))));
    }
    return;
  }

  const p = blockProgress(b);
  const pct = Math.round(p.elapsed * 100);
  const fill = el('span');
  fill.style.width = `${pct}%`;
  const bar = el('div', { class: 'progress', role: 'progressbar',
    'aria-label': 'Block time elapsed', 'aria-valuemin': '0',
    'aria-valuemax': '100', 'aria-valuenow': String(pct) }, fill);
  body.append(
    el('div', { class: 'headline' },
      el('span', { class: 'big' },
        el('span', { class: 'status-dot on' }), 'Active'),
      el('span', { class: 'muted', text:
        `${timeFmt.format(new Date(b.startTime))} – ` +
        timeFmt.format(new Date(b.endTime)) })),
    el('div', {}, bar, el('div', { class: 'progress-label' },
      el('span', { text: `${pct}% of 5h elapsed` }),
      el('span', { text: `${hoursMinutes(p.minutesLeft)} left` }))),
    el('dl', { class: 'stats' },
      stat('Tokens', num(b.totalTokens)),
      stat('Output', num(b.tokenCounts?.outputTokens)),
      stat('Est. cost', costLabel(b.costUSD,
        blockUnpriced(b, unpricedModels))),
      stat('Burn rate', b.burnRate
        ? `${compact(b.burnRate.tokensPerMinute)}/min` : '—'),
      stat('Projected', b.projection?.totalTokens
        ? num(b.projection.totalTokens) : '—')));
}

function renderWeek(daily) {
  const card = $('#week-card');
  const body = $('#week-body');
  done(body);
  showError(card, state.errors.daily);
  body.replaceChildren();
  if (!daily) return;

  const w = weekOverview(daily);
  const today = reportToday();
  const cur = w.current.totalTokens;
  const prev = w.previous.totalTokens;
  const delta = prev > 0 ? (cur - prev) / prev : NaN;
  const deltaText = Number.isFinite(delta)
    ? `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(0)}% vs last week`
    : 'No usage last week';

  const max = Math.max(1, ...w.days.map((d) => d.totalTokens));
  const bars = el('div', { class: 'week-bars' });
  w.days.forEach((d, i) => {
    const bar = el('span', { class: 'bar' });
    bar.style.height = `${(d.totalTokens / max) * 80}%`;
    const cls = ['col', d.future ? 'future' : '',
      d.date === today ? 'today' : ''].join(' ').trim();
    bars.append(el('div', { class: cls,
      title: `${d.date}: ${full(d.totalTokens)} tokens` },
    el('span', { text: d.totalTokens ? compact(d.totalTokens) : '' }),
    bar, el('span', { text: WEEKDAYS[i] })));
  });

  body.append(
    el('div', { class: 'headline' },
      el('span', { class: 'big' }, num(cur)),
      el('span', { class: 'muted', text: 'tokens' }),
      el('span', { class: 'delta', text: deltaText,
        title: `Last week to the same weekday: ${full(prev)}` })),
    bars,
    el('dl', { class: 'stats' },
      stat('Output', num(w.current.outputTokens)),
      stat('Est. cost', costLabel(w.current.cost, w.current.unpriced)),
      stat('Active days', `${w.current.days} / 7`),
      stat('Cache read', percent(w.current.cacheReadShare))));
}

function baseOptions() {
  const grid = cssVar('--grid');
  const muted = cssVar('--muted');
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        position: 'bottom',
        labels: { color: cssVar('--text-2'), boxWidth: 10, boxHeight: 10,
          useBorderRadius: true, borderRadius: 3 },
      },
      tooltip: {
        callbacks: {
          label: (c) => ` ${c.dataset.label}: ${full(c.parsed.y)}`,
        },
      },
    },
    scales: {
      x: {
        stacked: true,
        grid: { display: false },
        border: { color: cssVar('--axis') },
        ticks: { color: muted, maxRotation: 0, autoSkipPadding: 12 },
      },
      y: {
        stacked: true,
        grid: { color: grid },
        border: { display: false },
        ticks: { color: muted, callback: (v) => compact(v) },
      },
    },
  };
}

function drawChart(key, canvasId, config) {
  state.charts[key]?.destroy();
  delete state.charts[key];
  const canvas = $(canvasId);
  if (typeof window.Chart !== 'function') {
    showError(canvas.closest('.card'), 'chart library failed to load');
    return;
  }
  state.charts[key] = new window.Chart(canvas, config);
}

function renderDaily(daily) {
  const card = $('#daily-card');
  done($('.chart-box', card));
  showError(card, state.errors.daily);
  if (!daily) return;
  const days = lastNDays(daily, 30);
  const surface = cssVar('--surface');
  drawChart('daily', '#daily-chart', {
    type: 'bar',
    data: {
      labels: days.map((d) => d.date.slice(5)),
      datasets: TOKEN_TYPES.map((t, i) => ({
        label: t.label,
        data: days.map((d) => d[t.key]),
        backgroundColor: series(i),
        borderColor: surface,
        borderWidth: { top: 2 },
        borderSkipped: 'bottom',
        borderRadius: 3,
        maxBarThickness: 22,
      })),
    },
    options: baseOptions(),
  });
}

function renderModels(daily) {
  const card = $('#model-card');
  done($('.chart-box', card));
  showError(card, state.errors.daily);
  if (!daily) return;
  const totals = modelTotals(daily, 7);
  const sum = totals.reduce((s, m) => s + m.tokens, 0);
  $('#model-sub').textContent = `All time · ${compact(sum)} tokens`;
  drawChart('models', '#model-chart', {
    type: 'doughnut',
    data: {
      labels: totals.map((m) => m.model),
      datasets: [{
        data: totals.map((m) => m.tokens),
        backgroundColor: totals.map((_, i) => series(i)),
        borderColor: cssVar('--surface'),
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: cssVar('--text-2'), boxWidth: 10,
            boxHeight: 10, useBorderRadius: true, borderRadius: 3 },
        },
        tooltip: {
          callbacks: {
            label: (c) => ` ${c.label}: ${full(c.parsed)} ` +
              `(${percent(sum ? c.parsed / sum : NaN)})`,
          },
        },
      },
    },
  });
}

function renderMonthly(monthly) {
  const card = $('#monthly-card');
  done($('.chart-box', card));
  showError(card, state.errors.monthly);
  if (!monthly) return;
  const rows = [...monthly].sort((a, b) =>
    a.period.localeCompare(b.period));
  const opts = baseOptions();
  opts.plugins.legend.display = false;
  opts.plugins.tooltip.callbacks = {
    label: (c) => ` Tokens: ${full(c.parsed.y)}`,
    afterLabel: (c) => {
      const r = rows[c.dataIndex];
      return ` Cost: ${costLabel(r.totalCost, rowUnpriced(r))}`;
    },
  };
  drawChart('monthly', '#monthly-chart', {
    type: 'bar',
    data: {
      labels: rows.map((r) => r.period),
      datasets: [{
        label: 'Total tokens',
        data: rows.map((r) => r.totalTokens),
        backgroundColor: series(0),
        borderRadius: 4,
        borderSkipped: 'bottom',
        maxBarThickness: 48,
      }],
    },
    options: opts,
  });
}

function peakColumn(title, color, b) {
  const dl = el('dl', {},
    el('dt', { text: 'Active hours' }),
    el('dd', { text: full(b.blocks) }),
    el('dt', { text: 'Total tokens' }), num(b.totalTokens, 'dd'),
    el('dt', { text: 'Output tokens' }), num(b.outputTokens, 'dd'),
    el('dt', { text: 'Cache read' }), num(b.cacheReadTokens, 'dd'),
    el('dt', { text: 'Est. cost' }),
    el('dd', { text: costLabel(b.cost, b.unpriced) }),
    el('dt', { text: 'Avg / hour' }),
    num(b.blocks ? b.totalTokens / b.blocks : 0, 'dd'),
  );
  const sw = el('span', { class: 'swatch' });
  sw.style.background = color;
  return el('div', { class: 'peak-col' },
    el('h3', {}, sw, title), dl);
}

function renderPeak(blocks, unpricedModels) {
  const card = $('#peak-card');
  const body = $('#peak-body');
  done(body);
  showError(card, state.errors.hourly);
  body.replaceChildren();
  if (!blocks) return;
  const { peak, offPeak } = splitPeak(blocks, unpricedModels);
  const c1 = series(1);
  const c2 = series(0);
  const total = peak.totalTokens + offPeak.totalTokens;

  const bar = el('div', { class: 'share-bar' });
  for (const [v, c] of [[peak.totalTokens, c1],
    [offPeak.totalTokens, c2]]) {
    if (!v) continue;
    const seg = el('span', { title: full(v) });
    seg.style.flex = String(v);
    seg.style.background = c;
    bar.append(seg);
  }
  const share = el('div', { class: 'share' },
    el('h2', { text: 'Share of tokens' }),
    bar,
    el('div', { class: 'share-legend' },
      el('span', { text: `Peak ${percent(peak.totalTokens / total)}` }),
      el('span', {
        text: `Off-peak ${percent(offPeak.totalTokens / total)}`,
      })));

  body.append(
    peakColumn('Peak', c1, peak),
    peakColumn('Off-peak', c2, offPeak),
    share,
  );
}

// ---------- Detail table ----------

const COLUMNS = [
  { key: 'date', label: 'Date' },
  { key: 'agent', label: 'Agent' },
  { key: 'model', label: 'Model' },
  { key: 'inputTokens', label: 'Input', num: true },
  { key: 'outputTokens', label: 'Output', num: true },
  { key: 'cacheCreationTokens', label: 'Cache write', num: true },
  { key: 'cacheReadTokens', label: 'Cache read', num: true },
  { key: 'totalTokens', label: 'Total', num: true },
  { key: 'cost', label: 'Cost', num: true },
];

function filteredRows() {
  const from = $('#f-from').value;
  const to = $('#f-to').value;
  const { key, dir } = state.sort;
  return state.rows
    .filter((r) => (!from || r.date >= from) && (!to || r.date <= to))
    .sort((a, b) => {
      const x = a[key];
      const y = b[key];
      const c = typeof x === 'number' ? x - y : String(x).localeCompare(y);
      return c * dir || b.date.localeCompare(a.date);
    });
}

function renderHead() {
  const tr = $('#detail thead tr');
  tr.replaceChildren(...COLUMNS.map((col) => {
    const th = el('th', { class: col.num ? 'num' : '', scope: 'col' });
    if (state.sort.key === col.key) {
      th.setAttribute('aria-sort',
        state.sort.dir === 1 ? 'ascending' : 'descending');
    }
    const btn = el('button', { type: 'button', text: col.label });
    btn.addEventListener('click', () => {
      state.sort = state.sort.key === col.key
        ? { key: col.key, dir: -state.sort.dir }
        : { key: col.key, dir: col.num ? -1 : 1 };
      renderTable();
    });
    th.append(btn);
    return th;
  }));
}

function costCell(cost, unpriced) {
  const td = el('td', { class: 'num' });
  if (unpriced && !(cost > 0)) {
    td.append(el('span', { class: 'tag', text: 'Unpriced' }));
  } else {
    td.textContent = costLabel(cost, unpriced);
  }
  return td;
}

function renderTable() {
  const card = $('#table-card');
  done($('#table-wrap'));
  showError(card, state.errors.daily);
  renderHead();
  const rows = filteredRows();
  $('#table-count').textContent =
    `${rows.length} row${rows.length === 1 ? '' : 's'}`;

  const tbody = $('#detail tbody');
  if (!rows.length) {
    tbody.replaceChildren(el('tr', {}, el('td', {
      class: 'empty', colspan: String(COLUMNS.length),
      text: 'No rows match the filters',
    })));
  } else {
    tbody.replaceChildren(...rows.map((r) => el('tr', {},
      el('td', { text: r.date }),
      el('td', { text: agentLabel(r.agent) }),
      el('td', { class: 'mono', text: r.model }),
      num(r.inputTokens, 'td'),
      num(r.outputTokens, 'td'),
      num(r.cacheCreationTokens, 'td'),
      num(r.cacheReadTokens, 'td'),
      num(r.totalTokens, 'td'),
      costCell(r.cost, r.unpriced),
    )));
  }

  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  const anyUnpriced = rows.some((r) => r.unpriced);
  const foot = el('tr', {},
    el('td', { text: 'Total' }), el('td'), el('td'),
    ...COLUMNS.slice(3, 8).map((c) => num(sum(c.key), 'td')),
    costCell(sum('cost'), anyUnpriced));
  $('#detail tfoot').replaceChildren(rows.length ? foot : '');
}

function exportCsv() {
  const rows = filteredRows();
  const header = [...COLUMNS.map((c) => c.label), 'Unpriced'];
  const body = rows.map((r) => [
    ...COLUMNS.map((c) => {
      if (c.key === 'agent') return agentLabel(r.agent);
      if (c.key !== 'cost') return r[c.key];
      return r.unpriced && !(r.cost > 0) ? '' : r.cost.toFixed(4);
    }),
    r.unpriced ? 'yes' : 'no',
  ]);
  const blob = new Blob([toCsv(header, body)],
    { type: 'text/csv;charset=utf-8' });
  const a = el('a', {
    href: URL.createObjectURL(blob),
    download: 'usage-' +
      `${new Date().toISOString().slice(0, 10)}.csv`,
  });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- Sessions ----------

function renderSessions(sessions) {
  const card = $('#session-card');
  done($('.table-wrap', card));
  showError(card, state.errors.session);
  const tbody = $('#sessions tbody');
  if (!sessions) {
    tbody.replaceChildren();
    return;
  }
  const top = [...sessions]
    .sort((a, b) => (b.totalTokens || 0) - (a.totalTokens || 0))
    .slice(0, 10);
  tbody.replaceChildren(...top.map((s) => {
    const last = s.lastActivity ?? s.metadata?.lastActivity ?? '';
    const where = s.projectPath ?? agentLabel(s.agent ?? 'claude');
    return el('tr', {},
      el('td', { class: 'mono', title: s.period,
        text: s.period.slice(0, 8) }),
      el('td', { text: where }),
      el('td', { text: String(last).slice(0, 10) }),
      num(s.totalTokens, 'td'),
      costCell(s.totalCost, rowUnpriced(s)));
  }));
}

// ---------- Wiring ----------

function applyTheme(choice, save = true) {
  const root = document.documentElement;
  if (choice === 'light' || choice === 'dark') root.dataset.theme = choice;
  else delete root.dataset.theme;
  if (save) {
    try {
      if (choice === 'auto') localStorage.removeItem('theme');
      else localStorage.setItem('theme', choice);
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
  }
  pressOnly('[data-theme-choice]', 'data-theme-choice', choice);
  if (state.loaded) render();
}

function init() {
  applyTheme(document.documentElement.dataset.theme ?? 'auto', false);
  for (const btn of document.querySelectorAll('[data-theme-choice]')) {
    btn.addEventListener('click', () =>
      applyTheme(btn.dataset.themeChoice));
  }
  const dayInput = $('#ov-day');
  dayInput.max = reportToday();
  for (const btn of document.querySelectorAll('[data-period]')) {
    btn.addEventListener('click', () => {
      state.period = btn.dataset.period;
      if (state.period === 'day') {
        if (!dayInput.value) dayInput.value = reportToday();
        state.day = dayInput.value;
        dayInput.focus();
      }
      renderOverview(viewRows('daily'));
    });
  }
  dayInput.addEventListener('change', () => {
    if (!dayInput.value) return;
    state.period = 'day';
    state.day = dayInput.value;
    renderOverview(viewRows('daily'));
  });
  $('#refresh').addEventListener('click', load);
  $('#pricing').addEventListener('change', (e) => {
    state.offline = e.target.value === '1';
    load();
  });
  // Agent/model filters work on loaded data; no refetch needed.
  $('#g-agent').addEventListener('change', (e) => {
    state.agent = e.target.value;
    state.model = 'all';
    if (state.loaded) render();
  });
  $('#g-model').addEventListener('change', (e) => {
    state.model = e.target.value;
    if (state.loaded) render();
  });
  for (const id of ['#f-from', '#f-to']) {
    $(id).addEventListener('input', renderTable);
  }
  $('#f-reset').addEventListener('click', () => {
    $('#f-from').value = '';
    $('#f-to').value = '';
    renderTable();
  });
  $('#csv').addEventListener('click', exportCsv);

  // Re-render charts with the new palette on theme change.
  matchMedia('(prefers-color-scheme: dark)').addEventListener(
    'change', () => {
      if (state.loaded && !document.documentElement.dataset.theme) {
        render();
      }
    });

  load();
}

init();
