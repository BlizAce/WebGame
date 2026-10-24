/**
 * Shared duration formatting for countdowns and elapsed-time labels.
 *
 * Pages previously carried their own `m:ss` helper, which broke down whenever a
 * turn or pulse interval exceeded an hour (settings allows turns up to hours
 * long) and rendered as "73:12". These helpers are total: every input, including
 * NaN/Infinity/negatives, produces something readable.
 */

/** "45s" · "12:07" · "1:04:19" — largest whole unit first, no leading zeros. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  const total = Math.max(0, Math.ceil(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  if (minutes > 0) {
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }
  return `${seconds}s`;
}

/**
 * Compact duration for tight HUD rows: "48s", "12m", "3h", "2d".
 * Deliberately drops seconds past a minute so a row never changes width mid-read.
 */
export function formatDurationShort(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  const total = Math.max(0, Math.ceil(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** "just now" · "7m ago" · "3h ago" — for timestamps in logs and headers. */
export function formatAgo(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 45_000) return "just now";
  return `${formatDurationShort(ms)} ago`;
}
