// WebSocket broadcast via @connections, with role filter and 410 cleanup.
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { queryGsi1, deleteItem, PK } from './ddb.js';

let wsClient = null;
function client() {
  if (!wsClient) {
    wsClient = new ApiGatewayManagementApiClient({ endpoint: process.env.WS_ENDPOINT });
  }
  return wsClient;
}

export const CONN_INDEX = (code) => `CONNINDEX#${code}`;

// Send to all connections of a session, optionally filtered by role.
export async function broadcast(code, payload, role = null) {
  const conns = await queryGsi1(CONN_INDEX(code));
  const data = Buffer.from(JSON.stringify(payload));
  await Promise.all(
    conns
      .filter((c) => !role || c.role === role)
      .map(async (c) => {
        try {
          await client().send(
            new PostToConnectionCommand({ ConnectionId: c.connectionId, Data: data })
          );
        } catch (e) {
          if (e?.$metadata?.httpStatusCode === 410 || e?.name === 'GoneException') {
            await deleteItem(PK(code), `CONN#${c.connectionId}`).catch(() => {});
          }
        }
      })
  );
}

export async function sendTo(connectionId, payload) {
  try {
    await client().send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(JSON.stringify(payload)),
      })
    );
  } catch {
    /* ignore */
  }
}
