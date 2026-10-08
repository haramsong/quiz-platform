// WebSocket client with reconnect, ping, and event dispatch.
const WS_URL = import.meta.env.VITE_WS_URL;

let socket = null;
let listeners = {};
let pingTimer = null;
let keepAlive = true; // when false: stop pinging AND stop auto-reconnect (let it idle out)

export function connect(params, onEvent) {
  listeners = {};
  keepAlive = true;
  if (onEvent) listeners._all = onEvent;

  const qs = new URLSearchParams(params).toString();
  socket = new WebSocket(`${WS_URL}?${qs}`);

  socket.onopen = () => {
    emit('_open');
    startPing();
  };
  socket.onclose = () => {
    clearInterval(pingTimer);
    emit('_close');
    // auto-reconnect only while keep-alive is on
    if (keepAlive) {
      setTimeout(() => {
        if (keepAlive && listeners._all) connect(params, listeners._all);
      }, 2000);
    }
  };
  socket.onerror = () => {};
  socket.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      emit(msg.type || '_msg', msg);
    } catch { /* ignore */ }
  };
}

function startPing() {
  clearInterval(pingTimer);
  if (!keepAlive) return;
  pingTimer = setInterval(() => send({ action: 'ping' }), 30_000);
}

// Stop keep-alive pings (and auto-reconnect). The connection will idle out
// (API Gateway closes it after ~10 min of inactivity). Used after a game ends
// on the player screen to avoid lingering connections.
export function stopPing() {
  keepAlive = false;
  clearInterval(pingTimer);
}

export function send(obj) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(obj));
  }
}

export function disconnect() {
  listeners = {};
  keepAlive = false;
  clearInterval(pingTimer);
  if (socket) { socket.onclose = null; socket.close(); socket = null; }
}

function emit(type, data) {
  listeners._all?.(type, data);
}
