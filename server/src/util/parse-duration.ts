// Minimal duration parser for env vars like HISTORY_RETENTION. Accepts a
// bare millisecond integer ("604800000") or a suffixed shorthand
// ("7d", "12h", "30m", "45s"). Falls back to the given default on any
// malformed input rather than throwing at boot.
const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

const DURATION_RE = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/;

export function parseDurationMs(value: string, fallbackMs = 7 * 86_400_000): number {
  const trimmed = value.trim();

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  const match = DURATION_RE.exec(trimmed);
  if (match) {
    const [, amount, unit] = match;
    const unitMs = UNIT_MS[unit as string];
    if (amount !== undefined && unitMs !== undefined) {
      return Number(amount) * unitMs;
    }
  }

  return fallbackMs;
}
