import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SETTLE_MS, ELAPSED_GRACE_MS,
  shouldAccept, isAllAnswered,
  buildDistribution, buildEntries, formatCorrectAnswer,
} from './answerPolicy.js';

const T = 8000; // 8s question

test('shouldAccept: RUNNING always accepts', () => {
  assert.equal(shouldAccept({ state: 'RUNNING', now: 0, clientElapsedMs: 99999, timeoutMs: T }), true);
});

test('shouldAccept: near-deadline tap arriving just after close is accepted', () => {
  // tapped at 7.5s, close at t=100000, arrives 200ms later → within settle & in time
  assert.equal(shouldAccept({
    state: 'QUESTION_CLOSED', closedAt: 100000, now: 100200, clientElapsedMs: 7500, timeoutMs: T,
  }), true);
});

test('shouldAccept: tap over timeout+grace rejected', () => {
  assert.equal(shouldAccept({
    state: 'QUESTION_CLOSED', closedAt: 100000, now: 100100, clientElapsedMs: T + ELAPSED_GRACE_MS + 1, timeoutMs: T,
  }), false);
});

test('shouldAccept: exactly timeout+grace accepted (boundary)', () => {
  assert.equal(shouldAccept({
    state: 'QUESTION_CLOSED', closedAt: 100000, now: 100100, clientElapsedMs: T + ELAPSED_GRACE_MS, timeoutMs: T,
  }), true);
});

test('shouldAccept: arrival after settle window rejected', () => {
  assert.equal(shouldAccept({
    state: 'QUESTION_CLOSED', closedAt: 100000, now: 100000 + SETTLE_MS + 1, clientElapsedMs: 7500, timeoutMs: T,
  }), false);
});

test('shouldAccept: arrival exactly at settle edge accepted', () => {
  assert.equal(shouldAccept({
    state: 'QUESTION_CLOSED', closedAt: 100000, now: 100000 + SETTLE_MS, clientElapsedMs: 7500, timeoutMs: T,
  }), true);
});

test('shouldAccept: missing clientElapsedMs rejected when closed', () => {
  assert.equal(shouldAccept({
    state: 'QUESTION_CLOSED', closedAt: 100000, now: 100100, clientElapsedMs: undefined, timeoutMs: T,
  }), false);
});

test('shouldAccept: closed but no closedAt rejected', () => {
  assert.equal(shouldAccept({
    state: 'QUESTION_CLOSED', closedAt: undefined, now: 100100, clientElapsedMs: 7500, timeoutMs: T,
  }), false);
});

test('shouldAccept: ENDED rejected', () => {
  assert.equal(shouldAccept({ state: 'ENDED', now: 0, clientElapsedMs: 100, timeoutMs: T }), false);
});

test('shouldAccept: negative clientElapsedMs rejected', () => {
  assert.equal(shouldAccept({
    state: 'QUESTION_CLOSED', closedAt: 100000, now: 100100, clientElapsedMs: -5, timeoutMs: T,
  }), false);
});

test('isAllAnswered: fires only when RUNNING and answered>=total>0', () => {
  assert.equal(isAllAnswered({ state: 'RUNNING', total: 3, answered: 3 }), true);
  assert.equal(isAllAnswered({ state: 'RUNNING', total: 3, answered: 4 }), true);
  assert.equal(isAllAnswered({ state: 'RUNNING', total: 3, answered: 2 }), false);
  assert.equal(isAllAnswered({ state: 'RUNNING', total: 0, answered: 0 }), false);
  assert.equal(isAllAnswered({ state: 'QUESTION_CLOSED', total: 3, answered: 3 }), false);
});

const SINGLE_Q = {
  type: 'SINGLE',
  choices: [{ id: 'a', text: 'Apple' }, { id: 'b', text: 'Banana' }, { id: 'c', text: 'Cherry' }],
  correctChoiceIds: ['b'],
};

test('buildDistribution: counts and percentages per choice', () => {
  const rows = [
    { submitted: ['a'] }, { submitted: ['b'] }, { submitted: ['b'] }, { submitted: 'c' },
  ];
  const dist = buildDistribution(SINGLE_Q, rows);
  assert.deepEqual(dist, [
    { id: 'a', text: 'Apple', count: 1, percent: 25, isCorrect: false },
    { id: 'b', text: 'Banana', count: 2, percent: 50, isCorrect: true },
    { id: 'c', text: 'Cherry', count: 1, percent: 25, isCorrect: false },
  ]);
});

test('buildDistribution: MULTI counts each pick', () => {
  const q = { type: 'MULTI', choices: [{ id: 'a', text: 'X' }, { id: 'b', text: 'Y' }], correctChoiceIds: ['a', 'b'] };
  const dist = buildDistribution(q, [{ submitted: ['a', 'b'] }, { submitted: ['a'] }]);
  assert.equal(dist.find((d) => d.id === 'a').count, 2);
  assert.equal(dist.find((d) => d.id === 'b').count, 1);
});

test('buildDistribution: ignores unknown choice ids', () => {
  const dist = buildDistribution(SINGLE_Q, [{ submitted: ['zzz'] }]);
  assert.equal(dist.every((d) => d.count === 0), true);
});

test('buildDistribution: null for TEXT / missing question', () => {
  assert.equal(buildDistribution({ type: 'TEXT' }, []), null);
  assert.equal(buildDistribution(null, []), null);
});

test('buildDistribution: no answers → all zero, no divide-by-zero', () => {
  const dist = buildDistribution(SINGLE_Q, []);
  assert.equal(dist.every((d) => d.count === 0 && d.percent === 0), true);
});

test('buildEntries: maps sorted rows to ranked entries', () => {
  const rows = [
    { playerId: 'p1', isCorrect: true, elapsedMs: 1230, scoreAwarded: 2 },
    { playerId: 'p2', isCorrect: false, elapsedMs: 5000, scoreAwarded: 0 },
  ];
  const entries = buildEntries(rows, { p1: 'Alice', p2: 'Bob' });
  assert.deepEqual(entries, [
    { rank: 1, playerId: 'p1', nickname: 'Alice', isCorrect: true, elapsedSec: 1.23, score: 2 },
    { rank: 2, playerId: 'p2', nickname: 'Bob', isCorrect: false, elapsedSec: 5, score: 0 },
  ]);
});

test('buildEntries: unknown nickname falls back to ?', () => {
  const entries = buildEntries([{ playerId: 'x', isCorrect: true, elapsedMs: 0, scoreAwarded: 1 }], {});
  assert.equal(entries[0].nickname, '?');
});

test('formatCorrectAnswer: SINGLE/MULTI joins correct texts in choice order', () => {
  const q = {
    type: 'MULTI',
    choices: [{ id: 'a', text: 'X' }, { id: 'b', text: 'Y' }, { id: 'c', text: 'Z' }],
    correctChoiceIds: ['c', 'a'], // out of order on purpose
  };
  const r = formatCorrectAnswer(q);
  assert.equal(r.correctAnswer, 'X, Z'); // reordered to choice order
  assert.equal(r.acceptedAnswers, null);
});

test('formatCorrectAnswer: TEXT returns correctText + accepted', () => {
  const r = formatCorrectAnswer({ type: 'TEXT', correctText: 'Paris', acceptedAnswers: ['paris', ''] });
  assert.equal(r.correctAnswer, 'Paris');
  assert.deepEqual(r.acceptedAnswers, ['paris']); // empties filtered
});

test('formatCorrectAnswer: null question → nulls', () => {
  assert.deepEqual(formatCorrectAnswer(null), { correctAnswer: null, acceptedAnswers: null });
});
