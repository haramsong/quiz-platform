import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, levenshtein, similarity, isTextCorrect } from './similarity.js';

test('normalize: lowercases, trims, collapses whitespace, NFKC', () => {
  assert.equal(normalize('  Apple  '), 'apple');
  assert.equal(normalize('ApPlE'), 'apple');
  assert.equal(normalize('a   b\tc'), 'a b c');
  assert.equal(normalize(null), '');
  assert.equal(normalize(undefined), '');
  // NFKC: fullwidth → ascii
  assert.equal(normalize('ＡＢＣ'), 'abc');
});

test('levenshtein: basic edit distances', () => {
  assert.equal(levenshtein('', ''), 0);
  assert.equal(levenshtein('abc', 'abc'), 0);
  assert.equal(levenshtein('abc', ''), 3);
  assert.equal(levenshtein('', 'abc'), 3);
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(levenshtein('flaw', 'lawn'), 2);
});

test('similarity: identical and empty', () => {
  assert.equal(similarity('', ''), 1);
  assert.equal(similarity('apple', 'apple'), 1);
  assert.equal(similarity('Apple', '  apple '), 1); // normalized equal
});

test('similarity: partial', () => {
  // 'apple' vs 'appla' → 1 edit over length 5 = 0.8
  assert.equal(similarity('apple', 'appla'), 0.8);
});

test('isTextCorrect: exact match (case-insensitive)', () => {
  const q = { correctText: 'Apple', acceptedAnswers: [] };
  assert.equal(isTextCorrect('apple', q), true);
  assert.equal(isTextCorrect('APPLE', q), true);
  assert.equal(isTextCorrect('  ApPlE ', q), true);
  assert.equal(isTextCorrect('orange', q), false);
});

test('isTextCorrect: accepted answers', () => {
  const q = { correctText: 'Apple', acceptedAnswers: ['사과', 'Banana'] };
  assert.equal(isTextCorrect('사과', q), true);
  assert.equal(isTextCorrect('BANANA', q), true);
});

test('isTextCorrect: similarity threshold (default 0.8)', () => {
  const q = { correctText: 'elephant', acceptedAnswers: [] }; // len 8
  // one typo (7/8 = 0.875 >= 0.8) → accepted
  assert.equal(isTextCorrect('elephent', q), true);
  // too different → rejected
  assert.equal(isTextCorrect('cat', q), false);
});

test('isTextCorrect: custom similarityThreshold respected', () => {
  const strict = { correctText: 'elephant', acceptedAnswers: [], similarityThreshold: 1 };
  assert.equal(isTextCorrect('elephent', strict), false); // must be exact
  assert.equal(isTextCorrect('elephant', strict), true);
});

test('isTextCorrect: empty candidates never match non-empty', () => {
  const q = { correctText: '', acceptedAnswers: [] };
  assert.equal(isTextCorrect('something', q), false);
});
