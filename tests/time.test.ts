// Unit tests for shared UI formatting, run with node --test (no new deps).
import assert from "node:assert/strict";
import { formatDuration, formatDurationShort, formatAgo } from "../src/lib/ui/time.ts";

let pass = 0;
const t = (name: string, fn: () => void) => {
  try { fn(); pass++; }
  catch (e) { console.error(`FAIL ${name}: ${(e as Error).message}`); process.exitCode = 1; }
};

t("formatDuration seconds", () => assert.equal(formatDuration(45_000), "45s"));
t("formatDuration minutes", () => assert.equal(formatDuration(65_000), "1:05"));
t("formatDuration pads seconds", () => assert.equal(formatDuration(600_000 + 9_000), "10:09"));
// The bug this replaced rendered 73 minutes as "73:12".
t("formatDuration hours (regression)", () =>
  assert.equal(formatDuration((2 * 3600 + 3 * 60 + 4) * 1000), "2:03:04"));
t("formatDuration clamps negatives", () => assert.equal(formatDuration(-5000), "0s"));
t("formatDuration NaN", () => assert.equal(formatDuration(NaN), "—"));
t("formatDuration Infinity", () => assert.equal(formatDuration(Infinity), "—"));

t("formatDurationShort tiers", () => {
  // Values floor rather than round so a row never shows "2m" before it has run.
  assert.equal(formatDurationShort(30_000), "30s");
  assert.equal(formatDurationShort(59_000), "59s");
  assert.equal(formatDurationShort(90_000), "1m");
  assert.equal(formatDurationShort(3 * 3600_000), "3h");
  assert.equal(formatDurationShort(3 * 86400_000), "3d");
});

t("formatAgo", () => {
  assert.equal(formatAgo(10_000), "just now");
  assert.equal(formatAgo(7 * 60_000), "7m ago");
  assert.equal(formatAgo(-1), "—");
});

console.log(`time.ts: ${pass} assertions passed`);
