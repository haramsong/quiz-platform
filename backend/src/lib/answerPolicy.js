// Pure decision/aggregation helpers for the WebSocket message handler.
// Extracted so they can be unit-tested without DynamoDB / API Gateway.
import { round2 } from './scoring.js';

export const SETTLE_MS = 600;
export const ELAPSED_GRACE_MS = 300;

// Decide whether an incoming answer should be stored.
// - RUNNING: always accept.
// - QUESTION_CLOSED within the settle window: accept only if the answer was
//   tapped before the deadline (client-reported elapsed within timeout+grace)
//   AND it arrived within the settle window (guards against late/forged values).
// - anything else (e.g. ENDED, missing closedAt): reject.
export function shouldAccept({
  state, closedAt, now, clientElapsedMs, timeoutMs,
  settleMs = SETTLE_MS, graceMs = ELAPSED_GRACE_MS,
}) {
  if (state === 'RUNNING') return true;
  if (state === 'QUESTION_CLOSED' && closedAt) {
    const withinSettle = now <= closedAt + settleMs;
    const inTime = typeof clientElapsedMs === 'number'
      && clientElapsedMs >= 0
      && clientElapsedMs <= timeoutMs + graceMs;
    return withinSettle && inTime;
  }
  return false;
}

// Immediate-aggregation trigger: fire only while RUNNING when every connected
// player has answered (counter-based, O(1)).
export function isAllAnswered({ state, total, answered }) {
  return state === 'RUNNING' && total > 0 && answered >= total;
}

// Count distinct players currently connected, from the session's connection
// items. Uses role === 'player' and dedupes by playerId so a reconnecting
// player (old + new socket momentarily both present) is counted once. This is
// more robust than a running playerCount counter against connect/disconnect
// races on refresh.
export function countConnectedPlayers(connections) {
  const ids = new Set();
  for (const c of connections || []) {
    if (c && c.role === 'player' && c.playerId) ids.add(c.playerId);
  }
  return ids.size;
}

// Choice distribution (SINGLE/MULTI only) from stored answer rows.
// Returns null for TEXT / missing question.
export function buildDistribution(question, rows) {
  if (!question || (question.type !== 'SINGLE' && question.type !== 'MULTI')) return null;
  const choices = question.choices || [];
  const counts = Object.fromEntries(choices.map((c) => [c.id, 0]));
  for (const r of rows) {
    const picks = Array.isArray(r.submitted) ? r.submitted : (r.submitted != null ? [r.submitted] : []);
    for (const id of picks) if (id in counts) counts[id] += 1;
  }
  const totalPicks = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const correct = new Set(question.correctChoiceIds || []);
  return choices.map((c) => ({
    id: c.id,
    text: c.text,
    count: counts[c.id] || 0,
    percent: Math.round(((counts[c.id] || 0) / totalPicks) * 100),
    isCorrect: correct.has(c.id),
  }));
}

// Leaderboard entries from answer rows already sorted by GSI1SK.
export function buildEntries(sortedRows, nameById) {
  return sortedRows.map((r, i) => ({
    rank: i + 1,
    playerId: r.playerId,
    nickname: nameById[r.playerId] || '?',
    isCorrect: r.isCorrect,
    elapsedSec: round2(r.elapsedMs),
    score: r.scoreAwarded,
  }));
}

// Human-readable correct answer string + accepted list for the leaderboard.
export function formatCorrectAnswer(question) {
  if (!question) return { correctAnswer: null, acceptedAnswers: null };
  if (question.type === 'TEXT') {
    return {
      correctAnswer: question.correctText || '',
      acceptedAnswers: (question.acceptedAnswers || []).filter(Boolean),
    };
  }
  const choices = question.choices || [];
  const byId = Object.fromEntries(choices.map((c) => [c.id, c.text]));
  const orderIdx = Object.fromEntries(choices.map((c, i) => [c.id, i]));
  const sortedIds = [...(question.correctChoiceIds || [])]
    .sort((a, b) => (orderIdx[a] ?? 99) - (orderIdx[b] ?? 99));
  return {
    correctAnswer: sortedIds.map((id) => byId[id] || id).join(', '),
    acceptedAnswers: null,
  };
}
