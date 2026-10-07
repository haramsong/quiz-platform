import { useState, useEffect, useRef } from 'react';

// Cute join toast: alternates left/right, slides in then floats up and fades.
export default function JoinToast({ nickname }) {
  return null; // stateless per-item, use JoinToastContainer
}

export function JoinToastContainer({ toasts }) {
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <Toast key={t.id} nickname={t.nickname} side={t.side} />
      ))}
    </div>
  );
}

function Toast({ nickname, side }) {
  const [show, setShow] = useState(false);
  useEffect(() => { requestAnimationFrame(() => setShow(true)); }, []);
  return (
    <div className={`join-toast ${side} ${show ? 'show' : ''}`}>
      🎮 <strong>{nickname}</strong> 참여!
    </div>
  );
}

let _toastId = 0;
export function createToast(nickname) {
  _toastId++;
  return { id: _toastId, nickname, side: _toastId % 2 === 0 ? 'left' : 'right', ts: Date.now() };
}
