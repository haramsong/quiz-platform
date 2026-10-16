import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankPlayers, drawWinners } from './lottery.js';

const P = (id, score, timeMs) => ({ playerId: id, nickname: id, totalScore: score, totalTimeMs: timeMs });

test('rankPlayers: score desc, then time asc', () => {
  const ranked = rankPlayers([
    P('a', 10, 5000),
    P('b', 20, 9000),
    P('c', 20, 3000), // same score as b, faster → ahead
    P('d', 5, 100),
  ]);
  assert.deepEqual(ranked.map((p) => p.playerId), ['c', 'b', 'a', 'd']);
});

test('rankPlayers: does not mutate input', () => {
  const input = [P('a', 1, 1), P('b', 2, 1)];
  const copy = [...input];
  rankPlayers(input);
  assert.deepEqual(input, copy);
});

test('drawWinners: rank 1 is always FIRST winner', () => {
  const r = drawWinners([P('a', 30, 1000), P('b', 20, 1000), P('c', 10, 1000)], 1);
  assert.equal(r[0].playerId, 'a');
  assert.equal(r[0].rank, 1);
  assert.equal(r[0].isWinner, true);
  assert.equal(r[0].winReason, 'FIRST');
  // the rest are not winners when only 1 prize
  assert.equal(r[1].isWinner, false);
  assert.equal(r[2].isWinner, false);
});

test('drawWinners: multiple prizes → FIRST + RANDOM, correct winner count', () => {
  const players = Array.from({ length: 6 }, (_, i) => P(`p${i}`, 10 - i, 1000));
  const r = drawWinners(players, 3);
  const winners = r.filter((x) => x.isWinner);
  assert.equal(winners.length, 3);
  // top player always FIRST
  const first = r.find((x) => x.winReason === 'FIRST');
  assert.equal(first.rank, 1);
  // the other two winners are RANDOM
  assert.equal(r.filter((x) => x.winReason === 'RANDOM').length, 2);
});

test('drawWinners: prizeWinners capped at player count', () => {
  const r = drawWinners([P('a', 10, 1), P('b', 5, 1)], 10);
  assert.equal(r.filter((x) => x.isWinner).length, 2); // only 2 players
});

test('drawWinners: zero prizes → no winners', () => {
  const r = drawWinners([P('a', 10, 1), P('b', 5, 1)], 0);
  assert.equal(r.filter((x) => x.isWinner).length, 0);
});

test('drawWinners: empty players → empty ranking', () => {
  assert.deepEqual(drawWinners([], 3), []);
});

test('drawWinners: shape of ranking rows', () => {
  const r = drawWinners([P('a', 25, 3450)], 1);
  assert.deepEqual(r[0], {
    rank: 1, playerId: 'a', nickname: 'a',
    totalScore: 25, totalTimeSec: 3.45, isWinner: true, winReason: 'FIRST',
  });
});

test('drawWinners: FIRST winner is deterministic across runs', () => {
  const players = Array.from({ length: 8 }, (_, i) => P(`p${i}`, 100 - i, 1000));
  for (let i = 0; i < 20; i++) {
    const r = drawWinners(players, 4);
    assert.equal(r.find((x) => x.winReason === 'FIRST').playerId, 'p0');
    assert.equal(r.filter((x) => x.isWinner).length, 4);
  }
});
