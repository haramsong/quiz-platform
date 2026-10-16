// $default WebSocket router: start / next / answer / ping.
import {
  PK, SK, getItem, putItem, updateItem, queryByPk, queryGsi1,
} from '../lib/ddb.js';
import { broadcast, sendTo, CONN_INDEX } from '../lib/broadcast.js';
import { judge, resolveElapsedMs, leaderboardSortKey, round2 } from '../lib/scoring.js';
import { drawWinners } from '../lib/lottery.js';
import {
  SETTLE_MS, shouldAccept, isAllAnswered, countConnectedPlayers,
  buildDistribution, buildEntries, formatCorrectAnswer,
} from '../lib/answerPolicy.js';
import { s3, IMAGE_BUCKET } from '../lib/clients.js';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const CHOICE_COLORS = ['red', 'blue', 'yellow', 'green', 'purple', 'orange'];
const CHOICE_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const handler = async (event) => {
  const connectionId = event.requestContext?.connectionId;
  let msg = {};
  try { msg = JSON.parse(event.body || '{}'); } catch { /* noop */ }
  const action = msg.action;

  const ptr = await getItem(`CONNPTR#${connectionId}`, `CONNPTR#${connectionId}`);
  if (!ptr) return { statusCode: 400 };
  const { code, role } = ptr;

  try {
    if (action === 'ping') { await sendTo(connectionId, { type: 'pong' }); return ok(); }
    if (action === 'start' || action === 'next') {
      if (role !== 'host') { await sendTo(connectionId, errEvt('NOT_HOST', 'host only')); return ok(); }
      return action === 'start' ? start(code) : next(code);
    }
    if (action === 'close') {
      if (role !== 'host') { await sendTo(connectionId, errEvt('NOT_HOST', 'host only')); return ok(); }
      const session = await getItem(PK(code), SK.session());
      if (session?.state === 'RUNNING') await closeQuestion(code, session.currentOrder);
      return ok();
    }
    if (action === 'answer') return answer(code, ptr, msg);
    await sendTo(connectionId, errEvt('UNKNOWN_ACTION', String(action)));
  } catch (e) {
    await sendTo(connectionId, errEvt('SERVER_ERROR', e.message));
  }
  return ok();
};

const ok = () => ({ statusCode: 200 });
const errEvt = (code, message) => ({ type: 'error', code, message });

async function loadQuestion(code, order) {
  return getItem(PK(code), SK.question(order));
}

async function pushQuestion(code, order) {
  const q = await loadQuestion(code, order);
  const meta = await getItem(PK(code), SK.quiz());
  const questions = await queryByPk(PK(code), 'QUESTION#');
  const total = questions.length;
  if (!q) return endQuiz(code, meta);

  const now = Date.now();
  await updateItem({
    Key: { PK: PK(code), SK: SK.session() },
    UpdateExpression: 'SET #st = :running, currentOrder = :o, questionStartedAt = :t, answeredCount = :z',
    ExpressionAttributeNames: { '#st': 'state' },
    ExpressionAttributeValues: { ':running': 'RUNNING', ':o': order, ':t': now, ':z': 0 },
  });

  const choices = (q.choices || []).map((c, i) => ({
    id: c.id, label: CHOICE_LABELS[i] || String(i + 1), color: CHOICE_COLORS[i] || 'gray',
  }));
  const hostChoices = (q.choices || []).map((c, i) => ({
    id: c.id, label: CHOICE_LABELS[i] || String(i + 1), color: CHOICE_COLORS[i] || 'gray', text: c.text,
  }));

  // presigned GET URL for the question image (shown on host big screen)
  let imageUrl = null;
  if (q.imageKey) {
    imageUrl = await getSignedUrl(s3,
      new GetObjectCommand({ Bucket: IMAGE_BUCKET, Key: q.imageKey }),
      { expiresIn: 3600 }).catch(() => null);
  }

  const timeoutSec = q.timeoutSec || 10;
  await broadcast(code, {
    type: 'question_pushed_host',
    order, total, qType: q.type, body: q.body, imageUrl, points: q.points || 1,
    choices: hostChoices, timeoutSec, serverStartAt: now,
  }, 'host');
  await broadcast(code, {
    type: 'question_pushed_player',
    order, total, qType: q.type, body: q.body, imageUrl, points: q.points || 1,
    choices: hostChoices, timeoutSec, serverStartAt: now,
  }, 'player');
  return ok();
}

async function start(code) {
  return pushQuestion(code, 1);
}

async function next(code) {
  const session = await getItem(PK(code), SK.session());
  const current = session?.currentOrder || 0;
  return pushQuestion(code, current + 1);
}

async function answer(code, ptr, msg) {
  const session = await getItem(PK(code), SK.session());
  if (!session) return ok();
  const order = Number(msg.order);
  if (order !== session.currentOrder) return ok();
  const playerId = ptr.playerId;
  if (!playerId) return ok();

  const q = await loadQuestion(code, order);
  const timeoutMs = (q?.timeoutSec || 10) * 1000;
  const now = Date.now();

  // Accept decision (latency-tolerant); see lib/answerPolicy.js.
  const accept = shouldAccept({
    state: session.state,
    closedAt: session.closedAt,
    now,
    clientElapsedMs: msg.clientElapsedMs,
    timeoutMs,
  });
  if (!accept) return ok();

  // reject duplicate answer
  const existing = await getItem(PK(code), SK.answer(order, playerId));
  if (existing) return ok();

  const isCorrect = judge(q, msg.submitted);
  const { elapsedMs, serverElapsedMs } = resolveElapsedMs({
    clientElapsedMs: msg.clientElapsedMs,
    questionStartedAt: session.questionStartedAt,
    recvAt: now,
    timeoutSec: q?.timeoutSec || 10,
  });
  const points = isCorrect ? (q.points || 1) : 0;

  await putItem({
    PK: PK(code), SK: SK.answer(order, playerId), entityType: 'ANSWER',
    order, playerId, submitted: msg.submitted, isCorrect,
    elapsedMs, serverElapsedMs, scoreAwarded: points,
    GSI1PK: `LB#${code}#${order}`, GSI1SK: leaderboardSortKey(isCorrect, elapsedMs),
    expireAt: session.expireAt || q.expireAt,
  });

  if (isCorrect) {
    await updateItem({
      Key: { PK: PK(code), SK: SK.player(playerId) },
      UpdateExpression: 'SET totalScore = if_not_exists(totalScore, :z) + :p, totalTimeMs = if_not_exists(totalTimeMs, :z) + :e',
      ExpressionAttributeValues: { ':z': 0, ':p': points, ':e': elapsedMs },
    }).catch(() => {});
  }

  // ack to the player
  await sendTo(ptr.connectionId, { type: 'answer_ack', order, received: true });

  // Progress/all-answered use:
  //  - total   = distinct players currently connected (role=player conns,
  //              deduped by playerId). Robust against connect/disconnect races
  //              on refresh, unlike a running playerCount counter.
  //  - answered = atomic ADD on answeredCount (reset to 0 in pushQuestion).
  // We reach here only for a newly-stored answer (duplicates returned earlier),
  // so the increment maps 1:1 to a distinct player's first answer.
  const conns = await queryGsi1(CONN_INDEX(code));
  const total = countConnectedPlayers(conns);
  const upd = await updateItem({
    Key: { PK: PK(code), SK: SK.session() },
    UpdateExpression: 'ADD answeredCount :one',
    ExpressionAttributeValues: { ':one': 1 },
  }).catch(() => null);
  const answered = upd?.answeredCount ?? 0;

  await broadcast(code, {
    type: 'question_progress', order, answered, total,
  }, 'host');

  // Everyone has answered → aggregate immediately (no need to wait for timeout).
  // Only fires while the question is still RUNNING; the settle path handles the
  // timeout case.
  if (isAllAnswered({ state: session.state, total, answered })) {
    await closeQuestion(code, order, { settle: false });
  }
  return ok();
}

async function closeQuestion(code, order, { settle = true } = {}) {
  try {
    await updateItem({
      Key: { PK: PK(code), SK: SK.session() },
      UpdateExpression: 'SET #st = :closed, closedAt = :now',
      ConditionExpression: '#st = :running',
      ExpressionAttributeNames: { '#st': 'state' },
      ExpressionAttributeValues: { ':closed': 'QUESTION_CLOSED', ':running': 'RUNNING', ':now': Date.now() },
    });
  } catch {
    return ok(); // already closed (concurrent close) — skip duplicate broadcast
  }

  // Tell everyone we're tallying so the UI can show a spinner instead of a
  // frozen question. On the timeout path we then wait out the settle window so
  // in-flight answers (tapped before the deadline) still get counted; when all
  // players already answered there's nothing to wait for.
  if (settle) {
    await broadcast(code, { type: 'aggregating', order });
    await sleep(SETTLE_MS);
  }

  const q = await loadQuestion(code, order);
  const questions = await queryByPk(PK(code), 'QUESTION#');
  const rows = await queryByPk(PK(code), `ANSWER#${String(order).padStart(3, '0')}`, { ttlGuard: false });
  const players = await queryByPk(PK(code), 'PLAYER#');
  const nameById = Object.fromEntries(players.map((p) => [p.playerId, p.nickname]));

  const sorted = rows.sort((a, b) =>
    (a.GSI1SK || '').localeCompare(b.GSI1SK || '')
  );
  const entries = buildEntries(sorted, nameById);

  // fastest correct answerer (highlighted on the host screen)
  const firstCorrect = sorted.find((r) => r.isCorrect);
  const topCorrect = firstCorrect
    ? { nickname: nameById[firstCorrect.playerId] || '?', elapsedSec: round2(firstCorrect.elapsedMs) }
    : null;

  // choice distribution (objective questions only) — percentage per choice
  const distribution = buildDistribution(q, rows);

  // human-readable correct answer for the leaderboard
  const { correctAnswer, acceptedAnswers } = formatCorrectAnswer(q);

  await broadcast(code, {
    type: 'leaderboard_question',
    order, qType: q?.type || null,
    correctChoiceIds: q?.correctChoiceIds || null,
    correctAnswer, acceptedAnswers,
    topCorrect, distribution,
    entries, hasNext: order < questions.length,
  });
}

async function endQuiz(code, meta) {
  await updateItem({
    Key: { PK: PK(code), SK: SK.session() },
    UpdateExpression: 'SET #st = :ended',
    ExpressionAttributeNames: { '#st': 'state' },
    ExpressionAttributeValues: { ':ended': 'ENDED' },
  });
  const allPlayers = await queryByPk(PK(code), 'PLAYER#');
  const prizeWinners = meta?.prizeWinners || 1;

  // ----- fun stats + participation from every answer (elapsedMs always stored) -----
  const answers = await queryByPk(PK(code), 'ANSWER#', { ttlGuard: false });
  const answeredIds = new Set(answers.map((a) => a.playerId));
  // only players who actually answered at least once count as participants
  // (filters out ghosts / joined-but-never-played)
  const players = allPlayers.filter((p) => answeredIds.has(p.playerId));

  const ranking = drawWinners(players, prizeWinners);
  const nameById = Object.fromEntries(allPlayers.map((p) => [p.playerId, p.nickname]));

  // ① fastest overall participant: lowest AVERAGE response time (min 1 answer)
  // ② best reaction: single fastest answer across all questions
  const perPlayer = {}; // playerId -> { sum, n }
  let bestReaction = null; // { playerId, order, elapsedMs }
  for (const a of answers) {
    const ms = typeof a.elapsedMs === 'number' ? a.elapsedMs : null;
    if (ms == null) continue;
    (perPlayer[a.playerId] ||= { sum: 0, n: 0 });
    perPlayer[a.playerId].sum += ms;
    perPlayer[a.playerId].n += 1;
    if (!bestReaction || ms < bestReaction.elapsedMs) {
      bestReaction = { playerId: a.playerId, order: a.order, elapsedMs: ms };
    }
  }
  let fastestPlayer = null; // { playerId, avgMs }
  for (const [pid, s] of Object.entries(perPlayer)) {
    const avg = s.sum / s.n;
    if (!fastestPlayer || avg < fastestPlayer.avgMs) fastestPlayer = { playerId: pid, avgMs: avg };
  }
  const funFastest = fastestPlayer
    ? { nickname: nameById[fastestPlayer.playerId] || '?', avgSec: Math.round(fastestPlayer.avgMs / 10) / 100 }
    : null;
  const funReaction = bestReaction
    ? { nickname: nameById[bestReaction.playerId] || '?', order: bestReaction.order, elapsedSec: Math.round(bestReaction.elapsedMs / 10) / 100 }
    : null;

  // persist a snapshot so the host can review it later (lottery is non-reproducible)
  const session = await getItem(PK(code), SK.session());
  await putItem({
    PK: PK(code), SK: 'RESULT#final', entityType: 'RESULT',
    ranking, prizeWinners, funFastest, funReaction, endedAt: Date.now(),
    expireAt: session?.expireAt,
  }).catch(() => {});

  await broadcast(code, { type: 'final_result', ranking, prizeWinners, funFastest, funReaction });
  return ok();
}
