// HTTP API (payload v2) response helpers.
const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

export function ok(body, statusCode = 200) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

export function created(body) {
  return ok(body, 201);
}

export function error(statusCode, code, message) {
  return {
    statusCode,
    headers: CORS,
    body: JSON.stringify({ error: { code, message } }),
  };
}

export function parseBody(event) {
  if (!event || !event.body) return {};
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}
