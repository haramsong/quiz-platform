// Single-table DynamoDB access helpers.
import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { ddbDoc, TABLE_NAME } from './clients.js';

export const PK = (code) => `CODE#${code}`;

// Entity sort keys
export const SK = {
  code: (code) => `CODE#${code}`,
  quiz: () => 'QUIZ#meta',
  session: () => 'SESSION#state',
  question: (order) => `QUESTION#${String(order).padStart(3, '0')}`,
  player: (playerId) => `PLAYER#${playerId}`,
  answer: (order, playerId) => `ANSWER#${String(order).padStart(3, '0')}#${playerId}`,
};

export async function getItem(pk, sk) {
  const r = await ddbDoc.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: pk, SK: sk } })
  );
  return r.Item || null;
}

export async function putItem(item, opts = {}) {
  await ddbDoc.send(
    new PutCommand({ TableName: TABLE_NAME, Item: item, ...opts })
  );
  return item;
}

export async function updateItem(params) {
  const r = await ddbDoc.send(
    new UpdateCommand({ TableName: TABLE_NAME, ReturnValues: 'ALL_NEW', ...params })
  );
  return r.Attributes;
}

export async function deleteItem(pk, sk) {
  await ddbDoc.send(
    new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: pk, SK: sk } })
  );
}

// Query by PK, optionally filtering SK begins_with, with TTL guard.
export async function queryByPk(pk, skPrefix, { ttlGuard = true } = {}) {
  const names = { '#pk': 'PK' };
  const values = { ':pk': pk };
  let keyExpr = '#pk = :pk';
  if (skPrefix) {
    names['#sk'] = 'SK';
    values[':skp'] = skPrefix;
    keyExpr += ' AND begins_with(#sk, :skp)';
  }
  const params = {
    TableName: TABLE_NAME,
    KeyConditionExpression: keyExpr,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  };
  if (ttlGuard) {
    params.FilterExpression = 'attribute_not_exists(expireAt) OR expireAt > :now';
    params.ExpressionAttributeValues[':now'] = Math.floor(Date.now() / 1000);
  }
  return queryAll(params);
}

// Query a GSI1 partition (e.g. connections, leaderboard).
export async function queryGsi1(gsi1pk, { scanForward = true } = {}) {
  const params = {
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: '#gpk = :gpk',
    ExpressionAttributeNames: { '#gpk': 'GSI1PK' },
    ExpressionAttributeValues: { ':gpk': gsi1pk },
    ScanIndexForward: scanForward,
  };
  return queryAll(params);
}

async function queryAll(params) {
  const items = [];
  let last;
  do {
    const r = await ddbDoc.send(
      new QueryCommand({ ...params, ExclusiveStartKey: last })
    );
    items.push(...(r.Items || []));
    last = r.LastEvaluatedKey;
  } while (last);
  return items;
}

// Batch delete a list of {PK, SK} keys, chunked to 25 with retry on unprocessed.
export async function batchDelete(keys) {
  for (let i = 0; i < keys.length; i += 25) {
    let chunk = keys.slice(i, i + 25).map((k) => ({
      DeleteRequest: { Key: { PK: k.PK, SK: k.SK } },
    }));
    let attempt = 0;
    while (chunk.length > 0) {
      const r = await ddbDoc.send(
        new BatchWriteCommand({ RequestItems: { [TABLE_NAME]: chunk } })
      );
      const un = r.UnprocessedItems?.[TABLE_NAME] || [];
      chunk = un;
      if (chunk.length > 0 && ++attempt <= 5) {
        await new Promise((res) => setTimeout(res, 100 * attempt));
      } else if (chunk.length > 0) {
        break;
      }
    }
  }
}
