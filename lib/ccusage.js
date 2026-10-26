// Runs the pinned ccusage CLI and caches parsed JSON results.

import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CLI_PATH = require.resolve('ccusage/src/cli.js');

const TIMEZONE = 'Europe/Stockholm';
const TIMEOUT_MS = 30_000;
const CACHE_TTL_MS = 60_000;
const MAX_BUFFER = 64 * 1024 * 1024;

// Whitelist: endpoint name -> fixed ccusage args and result key.
// "claude" scope uses the Claude Code subcommands; "all" uses the
// unified multi-agent reports.
export const COMMANDS = {
  daily: { sub: ['daily', '--breakdown'], key: 'daily' },
  monthly: { sub: ['monthly', '--breakdown'], key: 'monthly' },
  session: { sub: ['session', '--breakdown'], key: 'session' },
  blocks: { sub: ['blocks'], key: 'blocks' },
  // 1-hour blocks: each one sits inside a single clock hour, which
  // gives exact peak/off-peak attribution.
  hourly: { sub: ['blocks', '--session-length', '1'], key: 'blocks' },
};

export class CcusageError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

export function buildArgs(name, { since, until, offline, scope }) {
  const cmd = COMMANDS[name];
  if (!cmd) throw new CcusageError('Unknown command', 404);
  const args = [CLI_PATH];
  if (scope === 'claude') args.push('claude');
  args.push(...cmd.sub, '--json', '--timezone', TIMEZONE);
  // Unified reports: add per-agent rows so the UI can filter by agent.
  if (scope === 'all' && cmd.sub.includes('--breakdown')) {
    args.push('--by-agent');
  }
  args.push(offline ? '--offline' : '--no-offline');
  if (since) args.push('--since', since);
  if (until) args.push('--until', until);
  return args;
}

// Map Claude-subcommand field names to the unified "period" shape.
const PERIOD_FIELDS = ['period', 'date', 'month', 'sessionId'];
const ARRAY_KEYS = { daily: 'daily', monthly: 'monthly',
  session: 'sessions' };

export function normalize(name, data) {
  if (COMMANDS[name]?.key === 'blocks') {
    return { blocks: Array.isArray(data.blocks) ? data.blocks : [] };
  }
  const rows = data[name] ?? data[ARRAY_KEYS[name]] ?? [];
  const out = rows.map((row) => {
    const field = PERIOD_FIELDS.find((f) => row[f] !== undefined);
    const r = { ...row, period: field ? String(row[field]) : '' };
    r.modelsUsed = Array.isArray(row.modelsUsed) ? row.modelsUsed : [];
    r.modelBreakdowns = Array.isArray(row.modelBreakdowns)
      ? row.modelBreakdowns : [];
    return r;
  });
  return { [name]: out, totals: data.totals ?? {} };
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, args, {
      timeout: TIMEOUT_MS,
      killSignal: 'SIGKILL',
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    }, (err, stdout) => {
      if (err) {
        if (err.killed || err.signal) {
          reject(new CcusageError('ccusage timed out', 504));
        } else {
          reject(new CcusageError('ccusage failed to run'));
        }
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new CcusageError('ccusage returned invalid JSON'));
      }
    });
  });
}

// key -> { at, promise }. Stores in-flight promises so parallel
// requests share a single child process.
const cache = new Map();

export async function getReport(name, opts, run = runCli) {
  const args = buildArgs(name, opts);
  const key = args.slice(1).join('\u0000');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.promise;

  const promise = run(args).then((data) => normalize(name, data));
  cache.set(key, { at: Date.now(), promise });
  // Do not cache failures.
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  return promise;
}

export function clearCache() {
  cache.clear();
}
