// Player session-token persistence (per quiz code) for reconnect support.
// Pure helpers extracted from PlayerApp so they can be unit-tested; the storage
// backend defaults to window.localStorage but is injectable for tests.

export const tokenKey = (code) => `qp_token_${code}`;

const safeStore = () => {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
};

export function loadToken(code, store = safeStore()) {
  try { return code && store ? store.getItem(tokenKey(code)) || '' : ''; } catch { return ''; }
}

export function saveToken(code, token, store = safeStore()) {
  try { if (code && token && store) store.setItem(tokenKey(code), token); } catch { /* no-op */ }
}

export function clearToken(code, store = safeStore()) {
  try { if (code && store) store.removeItem(tokenKey(code)); } catch { /* no-op */ }
}

// Nickname is persisted alongside the token so a reconnect can restore the
// player's display name (the reconnect path doesn't re-run join).
export const nickKey = (code) => `qp_nick_${code}`;

export function loadNick(code, store = safeStore()) {
  try { return code && store ? store.getItem(nickKey(code)) || '' : ''; } catch { return ''; }
}

export function saveNick(code, nickname, store = safeStore()) {
  try { if (code && nickname && store) store.setItem(nickKey(code), nickname); } catch { /* no-op */ }
}

export function clearNick(code, store = safeStore()) {
  try { if (code && store) store.removeItem(nickKey(code)); } catch { /* no-op */ }
}

// A stored token is a valid reconnect candidate only if it belongs to this
// quiz code (format: `${code}:${playerId}`). Guards against stale/foreign tokens.
export function isReconnectToken(saved, code) {
  return !!saved && !!code && saved.startsWith(`${code}:`);
}

// Extract the playerId half of a session token (`${code}:${playerId}`).
export function playerIdFromToken(token) {
  if (!token) return null;
  const i = token.indexOf(':');
  return i >= 0 ? token.slice(i + 1) : null;
}
