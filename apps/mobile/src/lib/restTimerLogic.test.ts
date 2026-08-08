import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_REST_SEC, REST_STEP_SEC, resolveStartDuration, remainingSeconds, endAtFor,
  clampSeconds, isFinalStretch, formatCountdown, ringProgress,
} from './restTimerLogic';

test('resolveStartDuration prefers the plan-provided rest_sec over anything else', () => {
  assert.equal(resolveStartDuration(120, 90), 120);
});

test('resolveStartDuration falls back to the last manual config when the plan has none', () => {
  assert.equal(resolveStartDuration(null, 100), 100);
  assert.equal(resolveStartDuration(undefined, 100), 100);
});

test('resolveStartDuration falls back to the hard default when neither is available', () => {
  assert.equal(resolveStartDuration(null, null), DEFAULT_REST_SEC);
});

test('remainingSeconds derives from the wall clock, not a counter', () => {
  const now = 1_000_000;
  assert.equal(remainingSeconds(now + 90_000, now), 90);
  assert.equal(remainingSeconds(now + 500, now), 1); // rounds up to the nearest second
});

test('remainingSeconds never goes negative once the end time has passed', () => {
  const now = 1_000_000;
  assert.equal(remainingSeconds(now - 5_000, now), 0);
});

test('endAtFor + remainingSeconds round-trip', () => {
  const now = 1_000_000;
  const end = endAtFor(90, now);
  assert.equal(remainingSeconds(end, now), 90);
});

test('clampSeconds floors at zero', () => {
  assert.equal(clampSeconds(-20), 0);
  assert.equal(clampSeconds(0), 0);
  assert.equal(clampSeconds(10), 10);
});

test('a -30s adjustment on a 10s-remaining timer lands on 0, not negative', () => {
  assert.equal(clampSeconds(10 - REST_STEP_SEC), 0);
});

test('isFinalStretch is true only for the last 3 seconds, not before or at zero', () => {
  assert.equal(isFinalStretch(4), false);
  assert.equal(isFinalStretch(3), true);
  assert.equal(isFinalStretch(1), true);
  assert.equal(isFinalStretch(0), false);
});

test('formatCountdown pads seconds and keeps tabular width across the 1:30 -> 0:59 tick', () => {
  assert.equal(formatCountdown(90), '1:30');
  assert.equal(formatCountdown(89), '1:29');
  assert.equal(formatCountdown(59), '0:59');
  assert.equal(formatCountdown(0), '0:00');
});

test('formatCountdown clamps a negative input rather than rendering a negative time', () => {
  assert.equal(formatCountdown(-5), '0:00');
});

test('ringProgress is 1 at the very start and drains to 0', () => {
  assert.equal(ringProgress(90, 90), 1);
  assert.equal(ringProgress(0, 90), 0);
  assert.equal(ringProgress(45, 90), 0.5);
});

test('ringProgress clamps remaining that overshoots total (post +30 bump) to 1', () => {
  assert.equal(ringProgress(120, 90), 1);
});

test('ringProgress is 0 for a zero-length total rather than dividing by zero', () => {
  assert.equal(ringProgress(0, 0), 0);
});
