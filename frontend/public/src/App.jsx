import HostApp from './host/HostApp';
import PlayerApp from './player/PlayerApp';
import { ToastProvider } from './Toast';
import './App.css';

function Routed() {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  const code = (params.get('code') || '').toUpperCase();

  if (path.startsWith('/host')) return <HostApp initialCode={code} />;
  if (path.startsWith('/play')) return <PlayerApp initialCode={code} />;

  return (
    <div className="center">
      <h1>🎯 Quiz Platform</h1>
      <p className="muted">참여 또는 진행 링크로 접속하세요.</p>
      <div className="links">
        <a className="btn primary" href="/play">참여자로 입장 (/play)</a>
        <a className="btn ghost" href="/host">호스트로 입장 (/host)</a>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Routed />
    </ToastProvider>
  );
}
