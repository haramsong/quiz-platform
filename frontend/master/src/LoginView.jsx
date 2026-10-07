import { useState } from 'react';
import { api } from './api';

export default function LoginView({ onLogin }) {
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!key.trim()) return;
    setLoading(true);
    setErr('');
    try {
      await api.listCodes(key.trim());
      onLogin(key.trim());
    } catch (ex) {
      if (ex.status === 401 || ex.status === 403) {
        setErr('유효하지 않은 Master Key입니다.');
      } else {
        setErr(ex.message || '연결 오류');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="center-card">
      <h1>🔐 Master Console</h1>
      <p className="muted">API 인가를 위해 Master Key를 입력하세요.</p>
      <form onSubmit={submit}>
        <input
          type="password"
          autoFocus
          placeholder="Master Key를 넣어주세요"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        {err && <p className="err">{err}</p>}
        <button className="btn primary" disabled={loading || !key.trim()}>
          {loading ? '확인 중…' : '접속'}
        </button>
      </form>
    </div>
  );
}
