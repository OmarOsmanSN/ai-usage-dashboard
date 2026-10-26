// Peak-hour tagging for 5h blocks.
// Peak = block start on Mon-Fri, 05:00 <= hour < 11:00 in
// America/Los_Angeles. Intl handles PST/PDT switches.

const PEAK_TZ = 'America/Los_Angeles';
const PEAK_START = 5;
const PEAK_END = 11;
const WEEKDAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: PEAK_TZ,
  weekday: 'short',
  hour: '2-digit',
  hourCycle: 'h23',
});

export function isPeak(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return false;
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value]),
  );
  const hour = Number(parts.hour);
  return WEEKDAYS.has(parts.weekday) &&
    hour >= PEAK_START && hour < PEAK_END;
}

function emptyBucket() {
  return {
    blocks: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0,
    cacheCreationTokens: 0, cacheReadTokens: 0, cost: 0,
    unpriced: false,
  };
}

// Splits non-gap blocks into peak/off-peak totals.
// unpricedModels marks buckets whose cost excludes some usage.
export function splitPeak(blocks, unpricedModels = []) {
  const unpriced = new Set(unpricedModels);
  const out = { peak: emptyBucket(), offPeak: emptyBucket() };
  for (const b of blocks) {
    if (!b || b.isGap) continue;
    const bucket = isPeak(b.startTime) ? out.peak : out.offPeak;
    const tc = b.tokenCounts ?? {};
    bucket.blocks += 1;
    bucket.totalTokens += b.totalTokens || 0;
    bucket.inputTokens += tc.inputTokens || 0;
    bucket.outputTokens += tc.outputTokens || 0;
    bucket.cacheCreationTokens += tc.cacheCreationInputTokens || 0;
    bucket.cacheReadTokens += tc.cacheReadInputTokens || 0;
    bucket.cost += b.costUSD || 0;
    if ((b.models ?? []).some((m) => unpriced.has(m))) {
      bucket.unpriced = true;
    }
  }
  return out;
}
