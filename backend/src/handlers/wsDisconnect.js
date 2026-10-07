// $disconnect: remove connection, decrement playerCount.
import { PK, SK, getItem, deleteItem, updateItem } from '../lib/ddb.js';

export const handler = async (event) => {
  const connectionId = event.requestContext?.connectionId;
  // We don't know the code from the disconnect event directly; scan GSI not ideal.
  // CONN item PK requires code. Store lookup: we query by connectionId is not keyed,
  // so we rely on the item we wrote keyed by PK=CODE#<code>. We need code — stored in item.
  // Trick: we can't Get without PK. So we store a reverse pointer is overkill for MVP;
  // instead we accept that CONN TTL cleans up, but try best-effort via GSI query is also keyed by code.
  // MVP approach: connection item key is PK=CODE#<code> SK=CONN#<id>, we cannot delete without code.
  // To support disconnect, we also keep code in a self-keyed item:
  const ptr = await getItem(`CONNPTR#${connectionId}`, `CONNPTR#${connectionId}`);
  if (!ptr) return { statusCode: 200 };
  const { code } = ptr;
  await deleteItem(PK(code), `CONN#${connectionId}`).catch(() => {});
  await deleteItem(`CONNPTR#${connectionId}`, `CONNPTR#${connectionId}`).catch(() => {});
  if (ptr.role === 'player') {
    await updateItem({
      Key: { PK: PK(code), SK: SK.session() },
      UpdateExpression: 'SET playerCount = if_not_exists(playerCount, :z) - :one',
      ConditionExpression: 'playerCount > :z',
      ExpressionAttributeValues: { ':one': 1, ':z': 0 },
    }).catch(() => {});
  }
  return { statusCode: 200 };
};
