// Number, money and CSV formatting helpers.

const FULL = new Intl.NumberFormat('en-US');
const USD = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 2,
});

// 1234 -> "1.2k", 3400000 -> "3.4M".
export function compact(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  const units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'k']];
  for (const [size, suffix] of units) {
    if (abs >= size) {
      const x = v / size;
      const s = Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1);
      return s.replace(/\.0$/, '') + suffix;
    }
  }
  return String(Math.round(v));
}

export function full(n) {
  return FULL.format(Math.round(Number(n) || 0));
}

export function usd(n) {
  return USD.format(Number(n) || 0);
}

export function percent(ratio) {
  if (!Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(1)}%`;
}

// Cost label: never shows "$0" for unpriced usage.
export function costLabel(cost, unpriced) {
  if (unpriced && !(cost > 0)) return 'Unpriced';
  if (unpriced) return `${usd(cost)} + unpriced`;
  return usd(cost);
}

// Escape one CSV cell. Prefixes formula triggers to block
// spreadsheet formula injection.
export function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(header, rows) {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(','));
  return lines.join('\r\n') + '\r\n';
}
