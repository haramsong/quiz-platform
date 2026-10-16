import { describe, test, expect } from 'vitest';
import { questionsToRows, rowsToQuestions } from './excel.js';

describe('questionsToRows (export)', () => {
  test('SINGLE: choices joined, answer = correct choice texts', () => {
    const [row] = questionsToRows([{
      type: 'SINGLE', body: 'Q1',
      choices: [{ id: 'a', text: 'Apple' }, { id: 'b', text: 'Banana' }],
      correctChoiceIds: ['b'], points: 2, timeoutSec: 15,
    }]);
    expect(row).toEqual({
      type: 'SINGLE', body: 'Q1', choices: 'Apple|Banana', answer: 'Banana',
      points: 2, timeSec: 15,
    });
  });

  test('MULTI: multiple correct answers joined', () => {
    const [row] = questionsToRows([{
      type: 'MULTI', body: 'pick two',
      choices: [{ id: 'a', text: 'X' }, { id: 'b', text: 'Y' }, { id: 'c', text: 'Z' }],
      correctChoiceIds: ['a', 'c'],
    }]);
    expect(row.choices).toBe('X|Y|Z');
    expect(row.answer).toBe('X|Z');
    expect(row.points).toBe(1);   // default
    expect(row.timeSec).toBe(10); // default
  });

  test('TEXT: answer = correctText + accepted joined, no choices', () => {
    const [row] = questionsToRows([{
      type: 'TEXT', body: 'capital of France?',
      correctText: 'Paris', acceptedAnswers: ['paris', ''],
    }]);
    expect(row.choices).toBe('');
    expect(row.answer).toBe('Paris|paris'); // empties filtered
  });

  test('defaults type to SINGLE when missing', () => {
    const [row] = questionsToRows([{ body: 'x', choices: [], correctChoiceIds: [] }]);
    expect(row.type).toBe('SINGLE');
  });
});

describe('rowsToQuestions (import)', () => {
  test('SINGLE: maps choice texts to ids a,b,c... and resolves correct ids', () => {
    const [q] = rowsToQuestions([{
      type: 'single', body: 'Q', choices: 'Apple|Banana|Cherry', answer: 'Banana', points: '3', timeSec: '20',
    }]);
    expect(q.type).toBe('SINGLE');
    expect(q.choices).toEqual([
      { id: 'a', text: 'Apple' }, { id: 'b', text: 'Banana' }, { id: 'c', text: 'Cherry' },
    ]);
    expect(q.correctChoiceIds).toEqual(['b']);
    expect(q.points).toBe(3);
    expect(q.timeoutSec).toBe(20);
    expect(q._new).toBe(true);
  });

  test('MULTI: multiple correct ids resolved', () => {
    const [q] = rowsToQuestions([{ type: 'MULTI', body: 'Q', choices: 'X|Y|Z', answer: 'X|Z' }]);
    expect(q.correctChoiceIds).toEqual(['a', 'c']);
  });

  test('TEXT: answer split into correctText + acceptedAnswers', () => {
    const [q] = rowsToQuestions([{ type: 'text', body: 'Q', answer: 'Paris|paris|PARIS' }]);
    expect(q.type).toBe('TEXT');
    expect(q.correctText).toBe('Paris');
    expect(q.acceptedAnswers).toEqual(['paris', 'PARIS']);
    expect(q.choices).toBeNull();
  });

  test('skips rows with invalid/empty type', () => {
    const out = rowsToQuestions([
      { type: '', body: 'ignored' },
      { type: 'FOO', body: 'ignored' },
      { type: 'SINGLE', body: 'kept', choices: 'a|b', answer: 'a' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].body).toBe('kept');
  });

  test('invalid points/time fall back to defaults', () => {
    const [q] = rowsToQuestions([{ type: 'SINGLE', body: 'Q', choices: 'a|b', answer: 'a', points: '-5', timeSec: 'abc' }]);
    expect(q.points).toBe(1);
    expect(q.timeoutSec).toBe(10);
  });

  test('trims whitespace in cells', () => {
    const [q] = rowsToQuestions([{ type: ' single ', body: '  hi  ', choices: ' a | b ', answer: ' a ' }]);
    expect(q.body).toBe('hi');
    expect(q.choices.map((c) => c.text)).toEqual(['a', 'b']);
    expect(q.correctChoiceIds).toEqual(['a']);
  });
});

describe('round-trip: export → import preserves question meaning', () => {
  test('SINGLE/MULTI/TEXT survive a round trip', () => {
    const original = [
      { type: 'SINGLE', body: 'Q1', choices: [{ id: 'a', text: 'Apple' }, { id: 'b', text: 'Banana' }], correctChoiceIds: ['a'], points: 2, timeoutSec: 15 },
      { type: 'MULTI', body: 'Q2', choices: [{ id: 'a', text: 'X' }, { id: 'b', text: 'Y' }, { id: 'c', text: 'Z' }], correctChoiceIds: ['b', 'c'], points: 1, timeoutSec: 10 },
      { type: 'TEXT', body: 'Q3', correctText: 'Paris', acceptedAnswers: ['paris'], points: 1, timeoutSec: 10 },
    ];
    const back = rowsToQuestions(questionsToRows(original));
    expect(back).toHaveLength(3);
    // SINGLE
    expect(back[0].correctChoiceIds).toEqual(['a']);
    expect(back[0].choices.map((c) => c.text)).toEqual(['Apple', 'Banana']);
    expect(back[0].points).toBe(2);
    expect(back[0].timeoutSec).toBe(15);
    // MULTI
    expect(back[1].correctChoiceIds).toEqual(['b', 'c']);
    // TEXT
    expect(back[2].correctText).toBe('Paris');
    expect(back[2].acceptedAnswers).toEqual(['paris']);
  });
});
