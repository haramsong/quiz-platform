// WebSocket client with reconnect, ping, and event dispatch.
const WS_URL = import.meta.env.VITE_WS_URL;

let socket = null;
let listeners = {};
let pingTimer = null;

export function connect(params, onEvent) {
  listeners = {};
  if (onEvent) listeners._all = onEvent;

  const qs = new URLSearchParams(params).toString();
  socket = new WebSocket(`${WS_URL}?${qs}`);

  socket.onopen = () => {
    emit('_open');
    pingTimer = setInterval(() => send({ action: 'ping' }), 30_000);
  };
  socket.onclose = () => {
    clearInterval(pingTimer);
    emit('_close');
    // auto-reconnect after 2s
    setTimeout(() => {
      if (listeners._all) connect(params, listeners._all);
    }, 2000);
  };
  socket.onerror = () => {};
  socket.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      emit(msg.type || '_msg', msg);
    } catch { /* ignore */ }
  };
}

export function send(obj) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(obj));
  }
}

export function disconnect() {
  listeners = {};
  clearInterval(pingTimer);
  if (socket) { socket.onclose = null; socket.close(); socket = null; }
}

function emit(type, data) {
  listeners._all?.(type, data);
}
