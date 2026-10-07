// Scoring: answer judging, elapsed time (hybrid), leaderboard sort key.
import { isTextCorrect } from './similarity.js';

// Judge correctness by question type.
export function judge(question, submitted) {
  if (question.type === 'SINGLE') {
    const arr = Array.isArray(submitted) ? submitted : [submitted];
    return arr.length === 1 && (question.correctChoiceIds || []).includes(arr[0]);
  }
  if (question.type === 'MULTI') {
    const a = new Set(Array.isArray(submitted) ? submitted : []);
    const b = new Set(question.correctChoiceIds || []);
    return a.size === b.size && [...a].every((x) => b.has(x));
  }
  if (question.type === 'TEXT') {
    return isTextCorrect(submitted, question);
  }
  return false;
}

// Hybrid elapsed: prefer client value, cap by server-measured upper bound.
export function resolveElapsedMs({ clientElapsedMs, questionStartedAt, recvAt, timeoutSec }) {
  const serverElapsed = Math.max(0, recvAt - questionStartedAt);
  const GRACE = 250;
  let elapsed;
  if (
    typeof clientElapsedMs === 'number' &&
    clientElapsedMs >= 0 &&
    clientElapsedMs <= serverElapsed + GRACE
  ) {
    elapsed = clientElapsedMs;
  } else {
    elapsed = serverElapsed;
  }
  const cap = (timeoutSec || 0) * 1000;
  if (cap > 0) elapsed = Math.min(elapsed, cap);
  return { elapsedMs: Math.round(elapsed), serverElapsedMs: Math.round(serverElapsed) };
}

// Leaderboard sort key: correct first ('0'), then faster first (zero-padded ms).
export function leaderboardSortKey(isCorrect, elapsedMs) {
  const flag = isCorrect ? '0' : '1';
  const padded = String(Math.min(elapsedMs, 9_999_999_999)).padStart(10, '0');
  return `${flag}${padded}`;
}

export function round2(ms) {
  return Math.round(ms / 10) / 100; // ms -> seconds, 2 decimals
}
