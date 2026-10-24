// Unit tests for the toast store: collapse, cap, dismiss. Run with `npm test`.
import assert from "node:assert/strict";
import {
  clearToasts,
  dismissToast,
  getToasts,
  pushToast,
} from "../src/lib/ui/toast.ts";

let pass = 0;
const t = (name: string, fn: () => void) => {
  try {
    fn();
    pass++;
  } catch (e) {
    console.error(`FAIL ${name}: ${(e as Error).message}`);
    process.exitCode = 1;
  }
};

t("push appends and returns an id", () => {
  clearToasts();
  const id = pushToast({ title: "Alpha" });
  const all = getToasts();
  assert.equal(all.length, 1);
  assert.equal(all[0]!.title, "Alpha");
  assert.equal(all[0]!.kind, "info", "defaults to info");
  assert.ok(Number.isFinite(id));
});

t("newest toast sorts first", () => {
  clearToasts();
  pushToast({ title: "First" });
  pushToast({ title: "Second" });
  assert.equal(getToasts()[0]!.title, "Second");
});

t("repeated identical title+kind collapses instead of stacking", () => {
  clearToasts();
  pushToast({ kind: "warn", title: "Raided" });
  pushToast({ kind: "warn", title: "Raided" });
  pushToast({ kind: "warn", title: "Raided" });
  assert.equal(getToasts().length, 1, "spam must not fill the stack");
});

t("same title with a different kind stays separate", () => {
  clearToasts();
  pushToast({ kind: "success", title: "Attack" });
  pushToast({ kind: "danger", title: "Attack" });
  assert.equal(getToasts().length, 2);
});

t("stack is capped so it can never cover the screen", () => {
  clearToasts();
  for (let i = 0; i < 12; i++) pushToast({ title: `T${i}` });
  assert.equal(getToasts().length, 4);
});

t("dismiss removes exactly one", () => {
  clearToasts();
  const a = pushToast({ title: "Keep" });
  const b = pushToast({ title: "Drop" });
  dismissToast(b);
  const all = getToasts();
  assert.equal(all.length, 1);
  assert.equal(all[0]!.id, a);
});

t("dismissing an unknown id is a no-op", () => {
  clearToasts();
  pushToast({ title: "Only" });
  dismissToast(-999);
  assert.equal(getToasts().length, 1);
});

t("ttl 0 pins the toast", () => {
  clearToasts();
  pushToast({ title: "Realm destroyed", ttl: 0 });
  assert.equal(getToasts()[0]!.ttl, 0);
});

clearToasts();
console.log(`toast store: ${pass} assertions passed`);
