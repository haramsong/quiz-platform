// Player handler: join session with code + nickname.
import { ok, error, parseBody, nowSec } from '../lib/http.js';
import { PK, SK, getItem, putItem, queryByPk } from '../lib/ddb.js';
import { genPlayerId } from '../lib/auth.js';

export const handler = async (event) => {
  const body = parseBody(event);
  const code = body.code;
  const nickname = (body.nickname || '').trim();
  if (!code || !nickname) return error(400, 'BAD_REQUEST', 'code and nickname required');

  const codeItem = await getItem(PK(code), SK.code(code));
  const now = nowSec();
  if (!codeItem || (codeItem.expireAt && codeItem.expireAt <= now)) {
    return error(404, 'CODE_NOT_FOUND', 'invalid or expired code');
  }
  const session = await getItem(PK(code), SK.session());
  if (session && session.state && session.state !== 'WAITING') {
    return error(409, 'ALREADY_STARTED', 'quiz already started');
  }

  // nickname uniqueness within session
  const players = await queryByPk(PK(code), 'PLAYER#');
  if (players.some((p) => (p.nickname || '').toLowerCase() === nickname.toLowerCase())) {
    return error(409, 'NICKNAME_TAKEN', 'nickname already in use');
  }

  const playerId = genPlayerId();
  const expireAt = codeItem.expireAt || now + 7 * 24 * 3600;
  await putItem({
    PK: PK(code), SK: SK.player(playerId), entityType: 'PLAYER',
    playerId, nickname, totalScore: 0, totalTimeMs: 0, joinedAt: now, expireAt,
  });

  return ok({
    sessionToken: `${code}:${playerId}`,
    playerId, nickname, state: session?.state || 'WAITING',
  });
};
