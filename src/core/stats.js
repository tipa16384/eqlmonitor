'use strict';

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

function sum(values) { return values.reduce((a, b) => a + b, 0); }

function unionDurationMs(intervals) {
  if (!intervals.length) return 0;
  const sorted = intervals.map((x) => [...x]).sort((a, b) => a[0] - b[0]);
  let [start, end] = sorted[0];
  let total = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    const [s, e] = sorted[i];
    if (s <= end) end = Math.max(end, e);
    else { total += end - start; start = s; end = e; }
  }
  return total + (end - start);
}

module.exports = { median, percentile, sum, unionDurationMs };
