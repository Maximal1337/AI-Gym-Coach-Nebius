import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildItems, classifySendFailure, factCategoryKey, failedMessageIds, mergeRows, pruneLocal, replyStatus, resendClientId, shouldPoll,
  SLOW_REPLY_MS,
  sortFacts, sourceLabel, validSources, type AssistantRow, type FactRow, type OpenJob,
} from './assistantLogic';

const row = (id: string, role: AssistantRow['role'], at: string, extra: Partial<AssistantRow> = {}): AssistantRow => ({
  id, role, doc: { text: `${role} ${id}` }, client_message_id: null, created_at: at, ...extra,
});

test('mergeRows: dedupes by id, orders by time, keeps microsecond order Date drops', () => {
  const a = row('a', 'user', '2026-10-01T10:00:00.1234+00:00');
  const b = row('b', 'assistant', '2026-10-01T10:00:00.12345+00:00');
  const c = row('c', 'user', '2026-10-01T09:59:59+00:00');
  const merged = mergeRows([a, b], [c, { ...b, doc: { text: 'edited' } }]);
  assert.deepEqual(merged.map((r) => r.id), ['c', 'a', 'b']);
  assert.equal(merged[2].doc.text, 'edited');
  // A whole second sorts before the same second with a fraction.
  assert.deepEqual(mergeRows([], [row('y', 'user', '2026-10-01T10:00:00.5+00:00'), row('x', 'user', '2026-10-01T10:00:00+00:00')]).map((r) => r.id), ['x', 'y']);
  // Exact ties fall back to the id, like the server's order by created_at, id.
  assert.deepEqual(mergeRows([], [row('2', 'user', '2026-10-01T10:00:00+00:00'), row('1', 'user', '2026-10-01T10:00:00+00:00')]).map((r) => r.id), ['1', '2']);
});

test('validSources and sourceLabel: https only; title, else the bare host', () => {
  const sources = validSources([
    { title: 'Deload basics', url: 'https://example.com/deload' },
    { url: 'http://insecure.example.com' },
    { url: 'javascript:alert(1)' },
    { url: 'https://www.strongerbyscience.com/a?b=c' },
    null,
    'https://string.example.com',
  ]);
  assert.deepEqual(sources.map((s) => s.url), ['https://example.com/deload', 'https://www.strongerbyscience.com/a?b=c']);
  assert.equal(sourceLabel(sources[0]), 'Deload basics');
  assert.equal(sourceLabel(sources[1]), 'strongerbyscience.com');
  assert.equal(sourceLabel({ title: '   ', url: 'https://x.org' }), 'x.org');
  assert.deepEqual(validSources(undefined), []);
});

test('buildItems: rows, then unconfirmed local sends; a confirmed send shows once', () => {
  const rows = [
    row('u1', 'user', '2026-10-01T10:00:00Z', { client_message_id: 'c1' }),
    row('r1', 'assistant', '2026-10-01T10:00:05Z', { doc: { text: 'hi', kind: 'chat', sources: [{ url: 'https://a.io' }, { url: 'ftp://b' }] } }),
    row('k1', 'assistant', '2026-10-02T06:00:00Z', { doc: { text: 'morning', kind: 'checkin' } }),
    row('u2', 'user', '2026-10-02T07:00:00Z', { client_message_id: 'c2' }),
  ];
  const items = buildItems(rows, [
    { clientMessageId: 'c1', text: 'dup', state: 'sending' },
    { clientMessageId: 'c3', text: 'on its way', state: 'sending' },
    { clientMessageId: 'c4', text: 'offline', state: 'unsent' },
  ], new Set(['u2']));
  assert.deepEqual(items.map((i) => i.key), ['u1', 'r1', 'k1', 'u2', 'local-c3', 'local-c4']);
  const [u1, r1, k1, u2, c3, c4] = items;
  assert.ok(u1.from === 'me' && u1.state === 'sent' && u1.rowId === 'u1');
  assert.ok(r1.from === 'coach' && !r1.checkin && r1.sources.length === 1);
  assert.ok(k1.from === 'coach' && k1.checkin);
  assert.ok(u2.from === 'me' && u2.state === 'no_reply');
  assert.ok(c3.from === 'me' && c3.state === 'sending' && c3.rowId === null);
  assert.ok(c4.from === 'me' && c4.state === 'unsent');
});

test('pruneLocal: drops confirmed sends, keeps the same array when nothing changed', () => {
  const local = [{ clientMessageId: 'c1', text: 'a', state: 'sending' as const }, { clientMessageId: 'c2', text: 'b', state: 'unsent' as const }];
  assert.deepEqual(pruneLocal(local, [row('u', 'user', '2026-10-01T10:00:00Z', { client_message_id: 'c1' })]).map((l) => l.clientMessageId), ['c2']);
  assert.equal(pruneLocal(local, []), local);
});

test('replyStatus: queued, typing, slow, idle', () => {
  const now = Date.parse('2026-10-01T10:05:00Z');
  const job = (status: OpenJob['status'], secondsAgo: number): OpenJob => ({
    message_id: `${status}-${secondsAgo}`, status, updated_at: new Date(now - secondsAgo * 1000).toISOString(),
  });
  assert.equal(replyStatus([], [], now), 'idle');
  assert.equal(replyStatus([job('failed', 5)], [], now), 'idle');
  assert.equal(replyStatus([job('pending', 5)], [], now), 'queued');
  assert.equal(replyStatus([job('pending', 5), job('leased', 3)], [], now), 'typing');
  assert.equal(replyStatus([job('leased', SLOW_REPLY_MS / 1000 + 1)], [], now), 'slow');
  assert.equal(replyStatus([job('pending', 10), job('pending', SLOW_REPLY_MS / 1000 + 30)], [], now), 'slow');
});

test('replyStatus: slow is timed from when the message was sent, not the job\'s last change', () => {
  const now = Date.parse('2026-10-01T10:05:00Z');
  // Deferred a moment ago, again and again: updated_at stays fresh, the message is 3 minutes old.
  const deferred: OpenJob = { message_id: 'm1', status: 'pending', updated_at: new Date(now - 5_000).toISOString() };
  const sent = row('m1', 'user', new Date(now - 3 * 60_000).toISOString());
  assert.equal(replyStatus([deferred], [], now), 'queued', 'not fetched yet: the job is all there is');
  assert.equal(replyStatus([deferred], [sent], now), 'slow');
  assert.equal(replyStatus([{ ...deferred, status: 'leased' }], [row('m1', 'user', new Date(now - 30_000).toISOString())], now), 'typing');
});

test('failedMessageIds: a failed message sent again is no longer offered, on any device, after a restart too', () => {
  const failed = (id: string): OpenJob => ({ message_id: id, status: 'failed', updated_at: '2026-10-01T10:01:00Z' });
  const rows = [
    row('m1', 'user', '2026-10-01T10:00:00Z', { doc: { text: 'Plan for Friday?' } }),
    row('m2', 'user', '2026-10-01T10:02:00Z', { doc: { text: 'Other question' } }),
    row('m3', 'user', '2026-10-01T10:03:00Z', { doc: { text: 'Plan for Friday?' }, client_message_id: resendClientId('m1', 'x1') }),
  ];
  const jobs = [failed('m1'), failed('m2'), { message_id: 'm3', status: 'pending' as const, updated_at: '2026-10-01T10:03:00Z' }];
  assert.deepEqual([...failedMessageIds(jobs, rows, new Set())], ['m2'], 'm1 was sent again as m3');
  assert.deepEqual([...failedMessageIds(jobs, rows, new Set(['m2']))], [], 'm2 tapped on this device');
  // The same short text sent later for another reason isn't a resend.
  const yes = [
    row('y1', 'user', '2026-10-01T08:00:00Z', { doc: { text: 'Yes' } }),
    row('y2', 'user', '2026-10-01T15:00:00Z', { doc: { text: 'Yes' }, client_message_id: 'c-afternoon' }),
  ];
  assert.deepEqual([...failedMessageIds([failed('y1')], yes, new Set())], ['y1']);
  // A failed job whose message isn't fetched yet still counts as failed.
  assert.deepEqual([...failedMessageIds([failed('m9')], rows, new Set())], ['m9']);
  assert.ok(resendClientId('3f1c2a5e-0b7d-4c1e-9a2b-1c2d3e4f5a6b', '6a0c2a5e-0b7d-4c1e-9a2b-1c2d3e4f5a6b').length <= 100, 'fits assistant-send\'s 100 characters');
});
test('shouldPoll: while a reply is expected or a send is in flight', () => {
  assert.equal(shouldPoll('idle', []), false);
  assert.equal(shouldPoll('idle', [{ clientMessageId: 'c', text: 't', state: 'unsent' }]), false);
  assert.equal(shouldPoll('idle', [{ clientMessageId: 'c', text: 't', state: 'sending' }]), true);
  for (const s of ['queued', 'typing', 'slow'] as const) assert.equal(shouldPoll(s, []), true);
});

test('classifySendFailure: follows the assistant-send contract', () => {
  assert.equal(classifySendFailure(null, null), 'retry');
  assert.equal(classifySendFailure(500, 'internal'), 'retry');
  assert.equal(classifySendFailure(503, null), 'retry');
  assert.equal(classifySendFailure(401, 'unauthorized'), 'signedOut');
  assert.equal(classifySendFailure(402, 'subscription_required'), 'subscription');
  assert.equal(classifySendFailure(403, 'assistant_disabled'), 'assistantOff');
  assert.equal(classifySendFailure(429, 'rate_limited'), 'slowDown');
  assert.equal(classifySendFailure(429, 'daily_limit_reached', 'messages'), 'dailyLimit');
  assert.equal(classifySendFailure(429, 'daily_limit_reached', 'spend'), 'busyToday');
  assert.equal(classifySendFailure(429, 'daily_limit_reached', 'global'), 'busyToday');
  assert.equal(classifySendFailure(400, 'invalid_input'), 'tooLong');
});

test('sortFacts: pinned first, then category order, then score', () => {
  const f = (id: string, category: string, score: number, pinned = false): FactRow => ({
    id, doc: { text: id, category: category as FactRow['doc']['category'] }, pinned, score,
  });
  const sorted = sortFacts([
    f('pref', 'preference', 0.9),
    f('goal-low', 'goal', 0.2),
    f('health', 'health', 0.5),
    f('pinned', 'health', 0.1, true),
    f('weird', 'mystery', 2),
    f('goal-high', 'goal', '0.700000' as unknown as number),
  ]);
  assert.deepEqual(sorted.map((x) => x.id), ['pinned', 'health', 'goal-high', 'goal-low', 'pref', 'weird']);
  assert.equal(factCategoryKey('goal'), 'factCategory_goal');
  assert.equal(factCategoryKey('mystery'), 'factCategory_other');
});
