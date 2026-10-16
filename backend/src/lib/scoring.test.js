import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge, resolveElapsedMs, leaderboardSortKey, round2 } from './scoring.js';

test('judge SINGLE: exactly one correct choice', () => {
  const q = { type: 'SINGLE', correctChoiceIds: ['b'] };
  assert.equal(judge(q, ['b']), true);
  assert.equal(judge(q, 'b'), true);        // non-array coerced
  assert.equal(judge(q, ['a']), false);
  assert.equal(judge(q, ['a', 'b']), false); // more than one → wrong
  assert.equal(judge(q, []), false);
});

test('judge MULTI: set equality (order-independent)', () => {
  const q = { type: 'MULTI', correctChoiceIds: ['a', 'c'] };
  assert.equal(judge(q, ['a', 'c']), true);
  assert.equal(judge(q, ['c', 'a']), true);
  assert.equal(judge(q, ['a']), false);       // missing one
  assert.equal(judge(q, ['a', 'c', 'd']), false); // extra one
  assert.equal(judge(q, []), false);
  assert.equal(judge(q, 'a'), false);         // not an array → treated as empty set
});

test('judge TEXT: delegates to similarity', () => {
  const q = { type: 'TEXT', correctText: 'Apple', acceptedAnswers: [] };
  assert.equal(judge(q, 'apple'), true);
  assert.equal(judge(q, 'orange'), false);
});

test('judge: unknown type is false', () => {
  assert.equal(judge({ type: 'FOO' }, 'x'), false);
});

test('resolveElapsedMs: prefers client value when within server bound+grace', () => {
  const r = resolveElapsedMs({
    clientElapsedMs: 3000,
    questionStartedAt: 1_000_000,
    recvAt: 1_003_100, // server elapsed 3100, client 3000 <= 3100+250
    timeoutSec: 10,
  });
  assert.equal(r.elapsedMs, 3000);
  assert.equal(r.serverElapsedMs, 3100);
});

test('resolveElapsedMs: client value trusted when <= server bound (even if small)', () => {
  // The guard only rejects client values LARGER than the server-measured bound
  // (physically impossible / faster-than-light). A smaller client value is
  // accepted as-is — it reflects the real tap time before network delay.
  const r = resolveElapsedMs({
    clientElapsedMs: 100,
    questionStartedAt: 1_000_000,
    recvAt: 1_005_000,    // server elapsed 5000; 100 <= 5000+250 → trusted
    timeoutSec: 10,
  });
  assert.equal(r.elapsedMs, 100);
});

test('resolveElapsedMs: falls back to server when client exceeds server+grace', () => {
  const r = resolveElapsedMs({
    clientElapsedMs: 8000, // claims 8s but server only saw 5s elapsed → implausible
    questionStartedAt: 1_000_000,
    recvAt: 1_005_000,     // server elapsed 5000; 8000 > 5000+250 → use server
    timeoutSec: 10,
  });
  assert.equal(r.elapsedMs, 5000);
});

test('resolveElapsedMs: caps at timeout', () => {
  const r = resolveElapsedMs({
    clientElapsedMs: 999_999,
    questionStartedAt: 1_000_000,
    recvAt: 1_050_000,  // server elapsed 50000
    timeoutSec: 10,     // cap 10000
  });
  assert.equal(r.elapsedMs, 10000);
});

test('resolveElapsedMs: missing client value uses server', () => {
  const r = resolveElapsedMs({
    clientElapsedMs: undefined,
    questionStartedAt: 1_000_000,
    recvAt: 1_002_000,
    timeoutSec: 10,
  });
  assert.equal(r.elapsedMs, 2000);
});

test('leaderboardSortKey: correct sorts before wrong; faster before slower', () => {
  const correctFast = leaderboardSortKey(true, 1200);
  const correctSlow = leaderboardSortKey(true, 5000);
  const wrongFast = leaderboardSortKey(false, 100);
  assert.ok(correctFast < correctSlow);     // faster correct ranks higher
  assert.ok(correctSlow < wrongFast);       // any correct ranks above any wrong
  assert.ok(correctFast.startsWith('0'));
  assert.ok(wrongFast.startsWith('1'));
});

test('leaderboardSortKey: zero-padded for lexicographic ordering', () => {
  // 900ms must sort before 1000ms lexicographically
  assert.ok(leaderboardSortKey(true, 900) < leaderboardSortKey(true, 1000));
});

test('round2: ms → seconds, 2 decimals', () => {
  assert.equal(round2(1234), 1.23);
  assert.equal(round2(1000), 1);
  assert.equal(round2(0), 0);
});
