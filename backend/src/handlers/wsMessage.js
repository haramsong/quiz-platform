// $default WebSocket router: start / next / answer / ping.
import {
  PK, SK, getItem, putItem, updateItem, queryByPk,
} from '../lib/ddb.js';
import { broadcast, sendTo } from '../lib/broadcast.js';
import { judge, resolveElapsedMs, leaderboardSortKey, round2 } from '../lib/scoring.js';
import { drawWinners } from '../lib/lottery.js';
import { s3, IMAGE_BUCKET } from '../lib/clients.js';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const CHOICE_COLORS = ['red', 'blue', 'yellow', 'green', 'purple', 'orange'];
const CHOICE_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

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
    UpdateExpression: 'SET #st = :running, currentOrder = :o, questionStartedAt = :t',
    ExpressionAttributeNames: { '#st': 'state' },
    ExpressionAttributeValues: { ':running': 'RUNNING', ':o': order, ':t': now },
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

  await broadcast(code, {
    type: 'question_pushed_host',
    order, total, qType: q.type, body: q.body, imageUrl, points: q.points || 1,
    choices: hostChoices, timeoutSec: meta?.timeoutSec || 20, serverStartAt: now,
  }, 'host');
  await broadcast(code, {
    type: 'question_pushed_player',
    order, total, qType: q.type, body: q.body, imageUrl, points: q.points || 1,
    choices: hostChoices, timeoutSec: meta?.timeoutSec || 20, serverStartAt: now,
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
  if (!session || session.state !== 'RUNNING') {
    return ok();
  }
  const order = Number(msg.order);
  if (order !== session.currentOrder) return ok();
  const playerId = ptr.playerId;
  if (!playerId) return ok();

  // reject duplicate answer
  const existing = await getItem(PK(code), SK.answer(order, playerId));
  if (existing) return ok();

  const q = await loadQuestion(code, order);
  const meta = await getItem(PK(code), SK.quiz());
  const isCorrect = judge(q, msg.submitted);
  const { elapsedMs, serverElapsedMs } = resolveElapsedMs({
    clientElapsedMs: msg.clientElapsedMs,
    questionStartedAt: session.questionStartedAt,
    recvAt: Date.now(),
    timeoutSec: meta?.timeoutSec || 20,
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

  // notify host of progress (do NOT auto-close — UI keeps the timer running to timeout)
  const players = await queryByPk(PK(code), 'PLAYER#');
  const answers = await queryByPk(PK(code), `ANSWER#${String(order).padStart(3, '0')}`);
  await broadcast(code, {
    type: 'question_progress', order, answered: answers.length, total: players.length,
  }, 'host');
  return ok();
}

async function closeQuestion(code, order) {
  try {
    await updateItem({
      Key: { PK: PK(code), SK: SK.session() },
      UpdateExpression: 'SET #st = :closed',
      ConditionExpression: '#st = :running',
      ExpressionAttributeNames: { '#st': 'state' },
      ExpressionAttributeValues: { ':closed': 'QUESTION_CLOSED', ':running': 'RUNNING' },
    });
  } catch {
    return ok(); // already closed (concurrent close) — skip duplicate broadcast
  }
  const q = await loadQuestion(code, order);
  const questions = await queryByPk(PK(code), 'QUESTION#');
  const rows = await queryByPk(PK(code), `ANSWER#${String(order).padStart(3, '0')}`, { ttlGuard: false });
  const players = await queryByPk(PK(code), 'PLAYER#');
  const nameById = Object.fromEntries(players.map((p) => [p.playerId, p.nickname]));

  const sorted = rows.sort((a, b) =>
    (a.GSI1SK || '').localeCompare(b.GSI1SK || '')
  );
  const entries = sorted.map((r, i) => ({
    rank: i + 1, nickname: nameById[r.playerId] || '?',
    isCorrect: r.isCorrect, elapsedSec: round2(r.elapsedMs), score: r.scoreAwarded,
  }));

  // human-readable correct answer for the leaderboard
  let correctAnswer = null;
  let acceptedAnswers = null;
  if (q) {
    if (q.type === 'TEXT') {
      correctAnswer = q.correctText || '';
      acceptedAnswers = (q.acceptedAnswers || []).filter(Boolean);
    } else {
      const byId = Object.fromEntries((q.choices || []).map((c) => [c.id, c.text]));
      const orderIdx = Object.fromEntries((q.choices || []).map((c, i) => [c.id, i]));
      const sortedIds = [...(q.correctChoiceIds || [])].sort((a, b) => (orderIdx[a] ?? 99) - (orderIdx[b] ?? 99));
      correctAnswer = sortedIds.map((id) => byId[id] || id).join(', ');
    }
  }

  await broadcast(code, {
    type: 'leaderboard_question',
    order, qType: q?.type || null,
    correctChoiceIds: q?.correctChoiceIds || null,
    correctAnswer, acceptedAnswers,
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
  const players = await queryByPk(PK(code), 'PLAYER#');
  const ranking = drawWinners(players, meta?.prizeWinners || 1);
  const prizeWinners = meta?.prizeWinners || 1;

  // persist a snapshot so the host can review it later (lottery is non-reproducible)
  const session = await getItem(PK(code), SK.session());
  await putItem({
    PK: PK(code), SK: 'RESULT#final', entityType: 'RESULT',
    ranking, prizeWinners, endedAt: Date.now(),
    expireAt: session?.expireAt,
  }).catch(() => {});

  await broadcast(code, { type: 'final_result', ranking, prizeWinners });
  return ok();
}
