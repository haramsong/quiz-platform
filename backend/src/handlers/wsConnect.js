// $connect: register connection with session/role mapping.
// Query string: ?token=<code>:<playerId>  (player)  or  ?code=<code>&role=host
import { PK, SK, getItem, putItem, updateItem, queryByPk } from '../lib/ddb.js';
import { nowSec } from '../lib/http.js';
import { CONN_INDEX, broadcast } from '../lib/broadcast.js';

export const handler = async (event) => {
  const connectionId = event.requestContext?.connectionId;
  const qs = event.queryStringParameters || {};
  let code = qs.code;
  let role = qs.role === 'host' ? 'host' : 'player';
  let playerId = null;

  if (qs.token) {
    const idx = qs.token.indexOf(':');
    if (idx > 0) {
      code = qs.token.slice(0, idx);
      playerId = qs.token.slice(idx + 1);
      role = 'player';
    }
  }
  if (!code) return { statusCode: 400 };

  const codeItem = await getItem(PK(code), SK.code(code));
  const now = nowSec();
  if (!codeItem || (codeItem.expireAt && codeItem.expireAt <= now)) {
    return { statusCode: 403 };
  }
  const expireAt = (codeItem.expireAt || now + 7 * 24 * 3600);

  await putItem({
    PK: PK(code), SK: `CONN#${connectionId}`, entityType: 'CONN',
    connectionId, code, role, playerId,
    GSI1PK: CONN_INDEX(code), GSI1SK: `CONN#${connectionId}`,
    expireAt,
  });
  // reverse pointer so $disconnect (which only has connectionId) can locate the code
  await putItem({
    PK: `CONNPTR#${connectionId}`, SK: `CONNPTR#${connectionId}`, entityType: 'CONNPTR',
    connectionId, code, role, playerId, expireAt,
  });

  if (role === 'player' && playerId) {
    const result = await updateItem({
      Key: { PK: PK(code), SK: SK.session() },
      UpdateExpression: 'SET playerCount = if_not_exists(playerCount, :z) + :one, entityType = :et, #st = if_not_exists(#st, :w)',
      ExpressionAttributeNames: { '#st': 'state' },
      ExpressionAttributeValues: { ':one': 1, ':z': 0, ':et': 'SESSION', ':w': 'WAITING' },
    }).catch(() => null);

    // broadcast player_joined to host (with nickname)
    const playerItem = await getItem(PK(code), SK.player(playerId));
    const nickname = playerItem?.nickname || '?';
    const playerCount = result?.playerCount || 0;
    await broadcast(code, {
      type: 'player_joined', playerId, nickname, playerCount,
    }, 'host');
  }

  return { statusCode: 200 };
};
