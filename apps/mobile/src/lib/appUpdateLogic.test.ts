import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, deriveUpdateStatus, NO_UPDATE } from './appUpdateLogic';

test('compareVersions: equal, less, greater', () => {
  assert.equal(compareVersions('1.0.1', '1.0.1'), 0);
  assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
  assert.equal(compareVersions('1.0.2', '1.0.1'), 1);
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.9.9', '2.0.0'), -1);
});

test('compareVersions: differing lengths treat missing parts as 0', () => {
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.1', '1.0'), 1);
  assert.equal(compareVersions('1', '1.0.0'), 0);
});

test('compareVersions: non-numeric / leading-zero parts never throw, count as their integer value', () => {
  assert.equal(compareVersions('1.0.x', '1.0.0'), 0); // x -> 0
  assert.equal(compareVersions('abc', '0.0.0'), 0); // abc -> 0
  assert.equal(compareVersions('1.0.01', '1.0.1'), 0); // 01 -> 1
  assert.equal(compareVersions('', '0.0.0'), 0);
});

// --- The safety-critical property: NEVER block unless running < a real min ---

test('null config (fetch failed / no row) never blocks — fail open', () => {
  assert.deepEqual(deriveUpdateStatus('1.0.1', null), NO_UPDATE);
});

test('missing/blank running version never blocks', () => {
  assert.equal(deriveUpdateStatus('', { minSupportedVersion: '2.0.0', latestVersion: null, storeUrl: null }).mustUpdate, false);
});

test('null / blank min never blocks', () => {
  assert.equal(deriveUpdateStatus('1.0.1', { minSupportedVersion: null, latestVersion: null, storeUrl: null }).mustUpdate, false);
  assert.equal(deriveUpdateStatus('1.0.1', { minSupportedVersion: '', latestVersion: null, storeUrl: null }).mustUpdate, false);
});

test('gate disabled sentinel (min 0.0.0) blocks nobody', () => {
  assert.equal(deriveUpdateStatus('1.0.1', { minSupportedVersion: '0.0.0', latestVersion: null, storeUrl: null }).mustUpdate, false);
});

test('mustUpdate is true only when running is strictly below min', () => {
  const cfg = (min: string) => ({ minSupportedVersion: min, latestVersion: null, storeUrl: null });
  assert.equal(deriveUpdateStatus('1.0.0', cfg('1.0.1')).mustUpdate, true);  // below
  assert.equal(deriveUpdateStatus('1.0.1', cfg('1.0.1')).mustUpdate, false); // equal
  assert.equal(deriveUpdateStatus('1.0.2', cfg('1.0.1')).mustUpdate, false); // above
});

test('soft nudge: updateAvailable when running < latest (and not blocked)', () => {
  const s = deriveUpdateStatus('1.0.1', { minSupportedVersion: '0.0.0', latestVersion: '1.1.0', storeUrl: 'x' });
  assert.equal(s.mustUpdate, false);
  assert.equal(s.updateAvailable, true);
  assert.equal(s.latestVersion, '1.1.0');
  assert.equal(s.storeUrl, 'x');
});

test('no nudge when running is at or above latest', () => {
  assert.equal(deriveUpdateStatus('1.1.0', { minSupportedVersion: '0.0.0', latestVersion: '1.1.0', storeUrl: null }).updateAvailable, false);
  assert.equal(deriveUpdateStatus('1.2.0', { minSupportedVersion: '0.0.0', latestVersion: '1.1.0', storeUrl: null }).updateAvailable, false);
});

test('a hard block suppresses the soft nudge (never both)', () => {
  const s = deriveUpdateStatus('1.0.1', { minSupportedVersion: '2.0.0', latestVersion: '3.0.0', storeUrl: null });
  assert.equal(s.mustUpdate, true);
  assert.equal(s.updateAvailable, false);
});
