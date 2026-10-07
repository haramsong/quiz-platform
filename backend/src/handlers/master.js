// Master handler: issue code (+links), list, delete, reset.
import { ok, created, error, parseBody, nowSec } from '../lib/http.js';
import {
  PK, SK, getItem, putItem, updateItem, deleteItem,
  queryByPk, queryGsi1, batchDelete,
} from '../lib/ddb.js';
import { genCode, genPin, hashPin } from '../lib/auth.js';
import { buildLinks } from '../lib/links.js';
import { CONN_INDEX } from '../lib/broadcast.js';
import { s3, IMAGE_BUCKET } from '../lib/clients.js';
import { DeleteObjectsCommand } from '@aws-sdk/client-s3';

export const handler = async (event) => {
  const method = event.requestContext?.http?.method;
  const path = event.requestContext?.http?.path || '';

  if (method === 'POST' && path === '/codes') return issue(event);
  if (method === 'GET' && path === '/codes') return list();
  if (method === 'DELETE' && path.startsWith('/codes/')) return remove(event);
  if (method === 'POST' && path.endsWith('/reset')) return reset(event);
  return error(404, 'NOT_FOUND', 'Unknown master route');
};

async function issue(event) {
  const body = parseBody(event);
  const code = genCode();
  const pin = genPin();
  const expireAt = Number(body.expireAt) || nowSec() + 7 * 24 * 3600;
  const item = {
    PK: PK(code), SK: SK.code(code), entityType: 'CODE',
    code, title: body.title || '', hostPinHash: hashPin(pin, code),
    hostPinPlain: pin, // master-only; list is Authorizer-protected
    status: 'ISSUED', scheduledDate: body.scheduledDate || null,
    expireAt, createdAt: nowSec(),
    GSI1PK: 'MASTER#codes', GSI1SK: `CODE#${code}`,
  };
  await putItem(item);
  const links = buildLinks(code);
  return created({ code, hostPin: pin, status: 'ISSUED', expireAt, ...links });
}

async function list() {
  const items = await queryGsi1('MASTER#codes');
  const now = nowSec();
  const result = items
    .filter((i) => !i.expireAt || i.expireAt > now)
    .map((i) => ({
      code: i.code,
      title: i.title || '',
      status: i.status,
      hostPin: i.hostPinPlain || null, // master-only view (masked on client until unlocked)
      scheduledDate: i.scheduledDate || null,
      expireAt: i.expireAt,
      ...buildLinks(i.code),
    }));
  return ok({ items: result });
}

async function remove(event) {
  const code = decodeURIComponent(event.pathParameters?.code || '');
  const body = parseBody(event);
  if (body.confirm !== code) {
    return error(400, 'CONFIRM_MISMATCH', 'confirm must equal the code');
  }
  const items = await queryByPk(PK(code), null, { ttlGuard: false });
  const conns = await queryGsi1(CONN_INDEX(code));
  const imageKeys = items
    .filter((i) => i.entityType === 'QUESTION' && i.imageKey)
    .map((i) => ({ Key: i.imageKey }));

  // Dedupe keys: items (PK=CODE#code) already include CONN rows, but
  // GSI1 conns also carry CONNPTR connectionIds we must delete separately.
  const keyMap = new Map();
  const addKey = (pk, sk) => keyMap.set(`${pk}\u0000${sk}`, { PK: pk, SK: sk });
  for (const i of items) addKey(i.PK, i.SK);
  for (const c of conns) {
    addKey(c.PK, c.SK); // CONN row (likely already present → deduped)
    if (c.connectionId) addKey(`CONNPTR#${c.connectionId}`, `CONNPTR#${c.connectionId}`);
  }
  await batchDelete([...keyMap.values()]);
  if (imageKeys.length > 0) {
    await s3.send(new DeleteObjectsCommand({
      Bucket: IMAGE_BUCKET, Delete: { Objects: imageKeys },
    })).catch(() => {});
  }
  return ok({ code, deleted: true });
}

async function reset(event) {
  const code = decodeURIComponent(event.pathParameters?.code || '');
  const body = parseBody(event);
  if (body.confirm !== code) {
    return error(400, 'CONFIRM_MISMATCH', 'confirm must equal the code');
  }
  const session = await getItem(PK(code), SK.session());
  if (session?.state === 'RUNNING' && !body.force) {
    return error(409, 'SESSION_RUNNING', 'session is running; pass force=true');
  }
  const players = await queryByPk(PK(code), 'PLAYER#', { ttlGuard: false });
  const answers = await queryByPk(PK(code), 'ANSWER#', { ttlGuard: false });
  const conns = await queryGsi1(CONN_INDEX(code));
  const keyMap = new Map();
  const addKey = (pk, sk) => keyMap.set(`${pk}\u0000${sk}`, { PK: pk, SK: sk });
  for (const i of players) addKey(i.PK, i.SK);
  for (const i of answers) addKey(i.PK, i.SK);
  for (const c of conns) {
    addKey(c.PK, c.SK);
    if (c.connectionId) addKey(`CONNPTR#${c.connectionId}`, `CONNPTR#${c.connectionId}`);
  }
  await batchDelete([...keyMap.values()]);
  // reset session state (create if missing)
  await putItem({
    PK: PK(code), SK: SK.session(), entityType: 'SESSION',
    state: 'WAITING', currentOrder: 0, questionStartedAt: null, playerCount: 0,
    expireAt: session?.expireAt || nowSec() + 7 * 24 * 3600,
  });
  return ok({
    code, reset: true, state: 'WAITING',
    removed: { players: players.length, answers: answers.length },
  });
}
