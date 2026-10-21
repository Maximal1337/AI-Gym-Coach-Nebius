import { test } from "node:test";
import assert from "node:assert/strict";
import { EDGE_CALLS_EVERY_MS, EdgeCallMeter, type EdgeCallsReport } from "./edge-calls.js";

const MIN = 60_000;

function meter(start = Date.parse("2026-10-21T10:00:00Z")) {
  const clock = { t: start };
  return { clock, m: new EdgeCallMeter(() => clock.t) };
}

/** Moves the clock one reporting interval and returns that report's edge_calls. */
function tick(clock: { t: number }, m: EdgeCallMeter, calls: number): EdgeCallsReport {
  for (let i = 0; i < calls; i++) m.record("assistant-outbox", "claim");
  clock.t += EDGE_CALLS_EVERY_MS;
  const events = m.report();
  const last = events[events.length - 1];
  assert.equal(last[0], "edge_calls");
  return last[1] as EdgeCallsReport;
}

test("edge calls: no rate until a quarter of an hour is seen, then the calls per day at that pace", () => {
  const { clock, m } = meter();
  assert.equal(tick(clock, m, 6).perDay, null);
  assert.equal(tick(clock, m, 6).perDay, null);
  const third = tick(clock, m, 6);
  assert.deepEqual([third.minutes, third.calls, third.perDay], [15, 18, 1728]);
});

test("edge calls: the rate is the last hour's, so a burst fades and a loop that never stops shows", () => {
  const { clock, m } = meter();
  for (let i = 0; i < 12; i++) tick(clock, m, 6); // a long poll every 50 s: 72 an hour
  const steady = tick(clock, m, 6);
  assert.deepEqual([steady.minutes, steady.calls, steady.perDay], [60, 72, 1728]);
  const burst = tick(clock, m, 66); // judges writing: 60 turns in five minutes
  assert.equal(burst.perDay, (72 - 6 + 66) * 24);
  for (let i = 0; i < 12; i++) tick(clock, m, 6);
  assert.equal(tick(clock, m, 6).perDay, 1728, "an hour later, gone");
  tick(clock, m, 300); // one call a second
  const loop = tick(clock, m, 300);
  assert.ok((loop.perDay ?? 0) > 12_000, `a loop shows within ten minutes: ${loop.perDay}`);
});

test("edge calls: by function and action since the last report, and the UTC day so far", () => {
  const { clock, m } = meter();
  m.record("assistant-outbox", "claim");
  m.record("assistant-outbox", "claim");
  m.record("assistant-deliver");
  m.record("assistant-outbox", "defer");
  const r = tick(clock, m, 0);
  assert.deepEqual(r.byCall, { "assistant-deliver": 1, "assistant-outbox:claim": 2, "assistant-outbox:defer": 1 });
  assert.deepEqual([r.day, r.today], ["2026-10-21", 4]);
  assert.deepEqual(tick(clock, m, 1).byCall, { "assistant-outbox:claim": 1 });
});

test("edge calls: a day that ends is logged with its total, and the new day starts from nothing", () => {
  const { clock, m } = meter(Date.parse("2026-10-21T23:50:00Z"));
  tick(clock, m, 10); // 23:55
  m.record("assistant-outbox", "claim"); // still the 21st
  clock.t += EDGE_CALLS_EVERY_MS; // 00:00
  clock.t += MIN;
  m.record("assistant-outbox", "claim"); // the 22nd
  const events = m.report();
  assert.deepEqual(events[0], ["edge_calls_day", { day: "2026-10-21", calls: 11 }]);
  assert.equal(events[1][0], "edge_calls");
  assert.deepEqual([(events[1][1] as EdgeCallsReport).day, (events[1][1] as EdgeCallsReport).today], ["2026-10-22", 1]);
  assert.equal(m.report().length, 1, "the day's total once");
});
