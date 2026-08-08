import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitCoachReply } from './messageChunks';

test('a single-topic reply with no blank line stays one chunk', () => {
  assert.deepEqual(
    splitCoachReply('Great set! Same weight next time, one more rep.'),
    ['Great set! Same weight next time, one more rep.'],
  );
});

test('a blank line splits into separate topic chunks, trimmed', () => {
  assert.deepEqual(
    splitCoachReply('Nice work finishing that exercise.\n\nNext up: Barbell Row.'),
    ['Nice work finishing that exercise.', 'Next up: Barbell Row.'],
  );
});

test('more than one consecutive blank line still splits into exactly two chunks', () => {
  assert.deepEqual(
    splitCoachReply('First topic.\n\n\n\nSecond topic.'),
    ['First topic.', 'Second topic.'],
  );
});

test('leading/trailing whitespace around the whole reply and each chunk is trimmed', () => {
  assert.deepEqual(
    splitCoachReply('  \n First topic.  \n\n  Second topic. \n  '),
    ['First topic.', 'Second topic.'],
  );
});

test('three or more real topics all split out, in order', () => {
  assert.deepEqual(
    splitCoachReply('One.\n\nTwo.\n\nThree.'),
    ['One.', 'Two.', 'Three.'],
  );
});

// Real regression (GYM feedback): a multi-topic reply rendered as one
// undivided block, but only when it arrived via the durable resume/
// catch-up path — that path had its own, separately-maintained copy of
// this splitting rule that went stale relative to the live path's copy.
// This exact scenario (a reply covering two topics, fetched as a single
// already-complete DB row rather than pushed live) is what messagesFromRow
// in app/(tabs)/index.tsx now runs through this same shared function for.
test("a reply fetched as one durable row still splits the same way a live reply would", () => {
  const storedRowText = 'רשמתי לפניך 3 סטים של 2 קילו ל-7 חזרות.\n\nהיעד הבא: לחיצת רגליים.';
  assert.deepEqual(
    splitCoachReply(storedRowText),
    ['רשמתי לפניך 3 סטים של 2 קילו ל-7 חזרות.', 'היעד הבא: לחיצת רגליים.'],
  );
});
