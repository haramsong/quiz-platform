// Host handler: quiz meta (title/thumbnail), questions CRUD, image presign.
import { ok, created, error, parseBody, nowSec } from '../lib/http.js';
import { PK, SK, getItem, putItem, deleteItem, queryByPk, updateItem } from '../lib/ddb.js';
import { parseHostAuth, verifyPin } from '../lib/auth.js';
import { s3, IMAGE_BUCKET } from '../lib/clients.js';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

async function authHost(event, code) {
  const auth = parseHostAuth(event);
  if (!auth || auth.code !== code) return false;
  const codeItem = await getItem(PK(code), SK.code(code));
  if (!codeItem) return false;
  return verifyPin(auth.pin, code, codeItem.hostPinHash);
}

function codeFrom(event) {
  return decodeURIComponent(event.pathParameters?.code || '');
}

export const handler = async (event) => {
  const method = event.requestContext?.http?.method;
  const path = event.requestContext?.http?.path || '';

  if (method === 'POST' && path === '/quizzes') return postQuiz(event);
  if (method === 'GET' && path.match(/^\/quizzes\/[^/]+$/) && !path.includes('/questions')) return getQuiz(event);
  if (method === 'POST' && path.endsWith('/questions')) return postQuestion(event);
  if (method === 'PUT' && path.match(/\/questions\/\d+$/)) return putQuestion(event);
  if (method === 'DELETE' && path.match(/\/questions\/\d+$/)) return delQuestion(event);
  if (method === 'POST' && path.endsWith('/images')) return presign(event);
  return error(404, 'NOT_FOUND', 'Unknown host route');
};

// ---- Quiz meta (create/update) + title update on CODE item ----
async function postQuiz(event) {
  const body = parseBody(event);
  const code = body.code;
  if (!code) return error(400, 'BAD_REQUEST', 'code required');
  if (!(await authHost(event, code))) return error(403, 'INVALID_PIN', 'host auth failed');

  const codeItem = await getItem(PK(code), SK.code(code));
  const expireAt = codeItem?.expireAt || nowSec() + 7 * 24 * 3600;
  const title = body.title ?? codeItem?.title ?? '';
  const thumbnailKey = body.thumbnailKey ?? null;

  await putItem({
    PK: PK(code), SK: SK.quiz(), entityType: 'QUIZ',
    title, timeoutSec: Number(body.timeoutSec) || 20,
    prizeWinners: Number(body.prizeWinners) || 1,
    thumbnailKey, expireAt,
  });

  // sync title on CODE item (for master listing)
  if (title !== codeItem?.title) {
    await updateItem({
      Key: { PK: PK(code), SK: SK.code(code) },
      UpdateExpression: 'SET title = :t, #st = if_not_exists(#st, :is)',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: { ':t': title, ':is': 'CONFIGURED' },
    }).catch(() => {});
  }

  // update CODE status
  await updateItem({
    Key: { PK: PK(code), SK: SK.code(code) },
    UpdateExpression: 'SET #st = :conf',
    ExpressionAttributeNames: { '#st': 'status' },
    ExpressionAttributeValues: { ':conf': 'CONFIGURED' },
  }).catch(() => {});

  // ensure session exists
  if (!(await getItem(PK(code), SK.session()))) {
    await putItem({
      PK: PK(code), SK: SK.session(), entityType: 'SESSION',
      state: 'WAITING', currentOrder: 0, questionStartedAt: null, playerCount: 0, expireAt,
    });
  }
  return ok({ code, status: 'CONFIGURED' });
}

// ---- Get quiz (meta + questions, with signed image URLs) ----
async function getQuiz(event) {
  const code = codeFrom(event);
  if (!(await authHost(event, code))) return error(403, 'INVALID_PIN', 'host auth failed');
  const meta = await getItem(PK(code), SK.quiz());
  const questions = await queryByPk(PK(code), 'QUESTION#');

  let thumbnailUrl = null;
  if (meta?.thumbnailKey) {
    thumbnailUrl = await getSignedUrl(s3,
      new GetObjectCommand({ Bucket: IMAGE_BUCKET, Key: meta.thumbnailKey }),
      { expiresIn: 3600 }).catch(() => null);
  }

  const qs = [];
  for (const q of questions) {
    let imageUrl = null;
    if (q.imageKey) {
      imageUrl = await getSignedUrl(s3,
        new GetObjectCommand({ Bucket: IMAGE_BUCKET, Key: q.imageKey }),
        { expiresIn: 3600 }).catch(() => null);
    }
    qs.push({
      order: q.order, type: q.type, body: q.body, choices: q.choices || null,
      correctChoiceIds: q.correctChoiceIds || null, correctText: q.correctText || null,
      acceptedAnswers: q.acceptedAnswers || null, imageKey: q.imageKey || null,
      imageUrl, points: q.points || 1, similarityThreshold: q.similarityThreshold ?? 0.8,
    });
  }

  return ok({
    code, title: meta?.title || '', timeoutSec: meta?.timeoutSec || 20,
    prizeWinners: meta?.prizeWinners || 1, thumbnailKey: meta?.thumbnailKey || null,
    thumbnailUrl, questions: qs,
  });
}

// ---- Questions CRUD ----
async function postQuestion(event) {
  const code = codeFrom(event);
  if (!(await authHost(event, code))) return error(403, 'INVALID_PIN', 'host auth failed');
  const body = parseBody(event);
  const order = Number(body.order);
  if (!order) return error(400, 'BAD_REQUEST', 'order required');
  const codeItem = await getItem(PK(code), SK.code(code));
  const expireAt = codeItem?.expireAt || nowSec() + 7 * 24 * 3600;
  await putItem(buildQuestionItem(code, order, body, expireAt));
  return created({ order });
}

async function putQuestion(event) {
  const code = codeFrom(event);
  if (!(await authHost(event, code))) return error(403, 'INVALID_PIN', 'host auth failed');
  const body = parseBody(event);
  const orderStr = event.pathParameters?.order || event.requestContext?.http?.path?.match(/\/(\d+)$/)?.[1];
  const order = Number(orderStr);
  if (!order) return error(400, 'BAD_REQUEST', 'invalid order');
  const existing = await getItem(PK(code), SK.question(order));
  if (!existing) return error(404, 'NOT_FOUND', 'question not found');
  const expireAt = existing.expireAt || nowSec() + 7 * 24 * 3600;
  await putItem(buildQuestionItem(code, order, { ...existing, ...body }, expireAt));
  return ok({ order, updated: true });
}

async function delQuestion(event) {
  const code = codeFrom(event);
  if (!(await authHost(event, code))) return error(403, 'INVALID_PIN', 'host auth failed');
  const orderStr = event.pathParameters?.order || event.requestContext?.http?.path?.match(/\/(\d+)$/)?.[1];
  const order = Number(orderStr);
  if (!order) return error(400, 'BAD_REQUEST', 'invalid order');
  await deleteItem(PK(code), SK.question(order));
  return ok({ order, deleted: true });
}

function buildQuestionItem(code, order, body, expireAt) {
  const choices = body.choices || null;
  // sort correctChoiceIds by the choice order (so "2,1" becomes "1,2")
  let correctChoiceIds = body.correctChoiceIds || null;
  if (correctChoiceIds && choices) {
    const idx = Object.fromEntries(choices.map((c, i) => [c.id, i]));
    correctChoiceIds = [...correctChoiceIds].sort((a, b) => (idx[a] ?? 99) - (idx[b] ?? 99));
  }
  return {
    PK: PK(code), SK: SK.question(order), entityType: 'QUESTION',
    order, type: body.type || 'SINGLE', body: body.body || '',
    choices,
    correctChoiceIds,
    correctText: body.correctText || null,
    acceptedAnswers: body.acceptedAnswers || null,
    similarityThreshold: body.similarityThreshold ?? 0.8,
    imageKey: body.imageKey || null, points: Number(body.points) || 1, expireAt,
  };
}

// ---- Image presign (question images + thumbnail) ----
async function presign(event) {
  const code = codeFrom(event);
  if (!(await authHost(event, code))) return error(403, 'INVALID_PIN', 'host auth failed');
  const body = parseBody(event);
  const purpose = body.purpose || 'question'; // 'question' | 'thumbnail'
  const order = Number(body.order) || 0;
  const contentType = body.contentType || 'image/webp';
  const ext = contentType.split('/')[1] || 'webp';

  let imageKey;
  if (purpose === 'thumbnail') {
    imageKey = `${code}/thumbnail.${ext}`;
  } else {
    imageKey = `${code}/q${order}.${ext}`;
  }

  const url = await getSignedUrl(s3,
    new PutObjectCommand({ Bucket: IMAGE_BUCKET, Key: imageKey, ContentType: contentType }),
    { expiresIn: 300 });
  return ok({ uploadUrl: url, imageKey, expiresInSec: 300 });
}
