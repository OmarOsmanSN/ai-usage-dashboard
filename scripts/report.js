// Terminal usage report: today, this week, this month, 5h block.
// Usage: npm run report [-- --day YYYY-MM-DD] [--agent NAME]
//   [--model NAME] [--online]

import { getReport } from '../lib/ccusage.js';
import {
  periodRange, summarize, activeBlock, blockProgress, filterRows,
  listAgents, listModels, agentLabel,
} from '../public/data.js';
import { full, percent, costLabel } from '../public/format.js';

const USAGE = 'Usage: npm run report -- [--day YYYY-MM-DD] ' +
  '[--agent NAME] [--model NAME] [--online]\n' +
  '  --agent: claude, codex, copilot, qwen, ... (default: all)\n' +
  '  --model: e.g. claude-opus-5-5 (default: all)';
const NAME_RE = /^[\w.:-]{1,80}$/;

function parseArgs(argv) {
  const opts = { day: '', agent: 'all', model: 'all', offline: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '--agent' || a === '--model') &&
      NAME_RE.test(argv[i + 1] ?? '')) {
      opts[a.slice(2)] = argv[++i];
    } else if (a === '--online') opts.offline = false;
    else if (a === '--day' && /^\d{4}-\d{2}-\d{2}$/.test(argv[i + 1])) {
      opts.day = argv[++i];
    } else if (a === '--help' || a === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else {
      console.error(`Unknown or invalid argument: ${a}\n${USAGE}`);
      process.exit(2);
    }
  }
  return opts;
}

const COLS = ['Period', 'Total', 'Input', 'Output', 'Cache write',
  'Cache read', 'Cache %', 'Est. cost'];

function row(label, k) {
  return [label, full(k.totalTokens), full(k.inputTokens),
    full(k.outputTokens), full(k.cacheCreationTokens),
    full(k.cacheReadTokens), percent(k.cacheReadShare),
    costLabel(k.cost, k.unpriced)];
}

function printTable(rows) {
  const all = [COLS, ...rows];
  const widths = COLS.map((_, c) =>
    Math.max(...all.map((r) => r[c].length)));
  const line = (r) => r.map((v, c) =>
    (c === 0 ? v.padEnd(widths[c]) : v.padStart(widths[c]))).join('  ');
  console.log(line(COLS));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(line(r));
}

const time = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit',
});

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const q = { scope: 'all', offline: opts.offline };
  const [daily, blocks] = await Promise.all([
    getReport('daily', q), getReport('blocks', q),
  ]);
  const filter = { agent: opts.agent, model: opts.model };
  if (opts.agent !== 'all' &&
    !listAgents(daily.daily).includes(opts.agent)) {
    console.error(`No data for agent "${opts.agent}". Available: ` +
      listAgents(daily.daily).join(', '));
    process.exit(2);
  }
  if (opts.model !== 'all' &&
    !listModels(daily.daily, opts.agent).includes(opts.model)) {
    console.error(`No data for model "${opts.model}". Available: ` +
      listModels(daily.daily, opts.agent).join(', '));
    process.exit(2);
  }
  const rows = filterRows(daily.daily, filter);
  const kinds = [['Today', 'today'], ['This week', 'week'],
    ['This month', 'month'], ['All time', 'all']];
  if (opts.day) kinds.push([opts.day, 'day']);
  const table = kinds.map(([label, kind]) => {
    const r = periodRange(kind, new Date(), opts.day);
    return row(label, summarize(rows, r.from, r.to));
  });

  const who = (opts.agent === 'all' ? 'All agents'
    : agentLabel(opts.agent)) +
    (opts.model === 'all' ? '' : `, ${opts.model}`);
  console.log(`\nUsage: ${who} (Europe/Stockholm)\n`);
  printTable(table);

  const b = activeBlock(blocks.blocks);
  console.log('\n5-hour block (Claude Code):');
  if (!b) {
    console.log('  Idle (no active block)');
  } else {
    const p = blockProgress(b);
    console.log(`  Active ${time.format(new Date(b.startTime))}–` +
      `${time.format(new Date(b.endTime))}, ` +
      `${Math.round(p.elapsed * 100)}% elapsed, ` +
      `${p.minutesLeft} min left`);
    console.log(`  Tokens ${full(b.totalTokens)}, ` +
      `cost ~$${(b.costUSD || 0).toFixed(2)}`);
  }
  const unpriced = daily.totals?.unpricedModels ?? [];
  if (unpriced.length) {
    console.log(`\nUnpriced models (try --online): ${unpriced.join(', ')}`);
  }
  console.log('\nCosts are API-equivalent estimates, not your bill.\n');
}

main().catch((err) => {
  console.error(`Report failed: ${err.message}`);
  process.exit(1);
});
