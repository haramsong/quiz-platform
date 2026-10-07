// Final ranking + prize lottery (1st fixed, rest random).
import crypto from 'node:crypto';

// Sort players: totalScore desc, totalTimeMs asc (tie-breaker).
export function rankPlayers(players) {
  return [...players].sort((a, b) => {
    if ((b.totalScore || 0) !== (a.totalScore || 0)) {
      return (b.totalScore || 0) - (a.totalScore || 0);
    }
    return (a.totalTimeMs || 0) - (b.totalTimeMs || 0);
  });
}

// Fisher-Yates partial sample using crypto.randomInt (unbiased).
function sample(arr, k) {
  const a = [...arr];
  const picked = [];
  for (let i = 0; i < k && a.length > 0; i++) {
    const idx = crypto.randomInt(a.length);
    picked.push(a[idx]);
    a.splice(idx, 1);
  }
  return picked;
}

// Returns ranking array with rank, isWinner, winReason.
export function drawWinners(players, prizeWinners) {
  const ranked = rankPlayers(players);
  const n = Math.max(0, prizeWinners || 0);
  const winnerIds = new Set();
  const reason = {};

  if (ranked.length > 0 && n >= 1) {
    winnerIds.add(ranked[0].playerId);
    reason[ranked[0].playerId] = 'FIRST';
  }
  if (n > 1 && ranked.length > 1) {
    const pool = ranked.slice(1);
    const k = Math.min(n - 1, pool.length);
    for (const p of sample(pool, k)) {
      winnerIds.add(p.playerId);
      reason[p.playerId] = 'RANDOM';
    }
  }

  return ranked.map((p, i) => ({
    rank: i + 1,
    playerId: p.playerId,
    nickname: p.nickname,
    totalScore: p.totalScore || 0,
    totalTimeSec: Math.round((p.totalTimeMs || 0) / 10) / 100,
    isWinner: winnerIds.has(p.playerId),
    winReason: reason[p.playerId] || null,
  }));
}
