// Query validation. Only whitelisted params reach ccusage.

const DATE_RE = /^\d{8}$/;
const ALLOWED = new Set(['since', 'until', 'offline', 'scope']);
const SCOPES = new Set(['claude', 'all']);

export class ValidationError extends Error {}

// True if YYYYMMDD is a real calendar date.
export function isRealDate(s) {
  if (!DATE_RE.test(s)) return false;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d;
}

function oneValue(params, key) {
  const all = params.getAll(key);
  if (all.length > 1) {
    throw new ValidationError(`Duplicate parameter: ${key}`);
  }
  return all.length ? all[0] : undefined;
}

// Returns { since, until, offline, scope } or throws ValidationError.
export function parseQuery(params) {
  for (const key of params.keys()) {
    if (!ALLOWED.has(key)) {
      throw new ValidationError(`Unknown parameter: ${key}`);
    }
  }
  const since = oneValue(params, 'since');
  const until = oneValue(params, 'until');
  for (const [name, v] of [['since', since], ['until', until]]) {
    if (v !== undefined && !isRealDate(v)) {
      throw new ValidationError(`${name} must be a valid YYYYMMDD date`);
    }
  }
  if (since && until && since > until) {
    throw new ValidationError('since must not be after until');
  }

  const off = oneValue(params, 'offline');
  if (off !== undefined && off !== '0' && off !== '1') {
    throw new ValidationError('offline must be 0 or 1');
  }

  const scope = oneValue(params, 'scope') ?? 'claude';
  if (!SCOPES.has(scope)) {
    throw new ValidationError('scope must be claude or all');
  }

  return { since, until, offline: off !== '0', scope };
}
