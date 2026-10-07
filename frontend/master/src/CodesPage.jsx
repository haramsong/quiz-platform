import { useEffect, useState, useCallback } from 'react';
import { api } from './api';
import ConfirmModal from './ConfirmModal';

function Copy({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn tiny ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          /* ignore */
        }
      }}
    >
      {done ? '복사됨' : '복사'}
    </button>
  );
}

export default function CodesPage({ masterKey, onLogout }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [title, setTitle] = useState('');
  const [expireDate, setExpireDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7); // default: 7 days from now
    return d.toISOString().slice(0, 10);
  });
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState(null);
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState({}); // code -> bool (show PIN)

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.listCodes(masterKey);
      setItems(r.items || []);
    } catch (ex) {
      setErr(ex.message || '목록 조회 실패');
    } finally {
      setLoading(false);
    }
  }, [masterKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const issue = async (e) => {
    e.preventDefault();
    setIssuing(true);
    setErr('');
    try {
      // end of the selected day (local) → epoch seconds
      const expireAt = Math.floor(new Date(`${expireDate}T23:59:59`).getTime() / 1000);
      const r = await api.issueCode(masterKey, { title: title.trim(), expireAt });
      setIssued(r);
      setTitle('');
      refresh();
    } catch (ex) {
      setErr(ex.message || '발행 실패');
    } finally {
      setIssuing(false);
    }
  };

  const togglePin = (code) => setRevealed((r) => ({ ...r, [code]: !r[code] }));
  const fmtDate = (epoch) => {
    if (!epoch) return '-';
    const d = new Date(epoch * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const doConfirm = async ({ force }) => {
    setBusy(true);
    setErr('');
    try {
      if (modal.mode === 'delete') {
        await api.deleteCode(masterKey, modal.code);
      } else {
        await api.resetCode(masterKey, modal.code, force);
      }
      setModal(null);
      refresh();
    } catch (ex) {
      setErr(ex.message || '작업 실패');
      if (ex.code === 'SESSION_RUNNING') {
        setErr('진행 중인 세션입니다. force 체크 후 다시 시도하세요.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <header className="topbar">
        <h1>🔐 Master Console</h1>
        <button className="btn ghost" onClick={onLogout}>
          로그아웃
        </button>
      </header>

      <section className="panel">
        <h2>퀴즈 발행</h2>
        <form className="issue-form" onSubmit={issue}>
          <label className="field-inline">
            <span>제목</span>
            <input placeholder="퀴즈 제목 (선택)" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field-inline">
            <span>만료일</span>
            <input type="date" value={expireDate} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setExpireDate(e.target.value)} />
          </label>
          <button className="btn primary" disabled={issuing}>
            {issuing ? '발행 중…' : '발행'}
          </button>
        </form>
        <p className="muted small">만료일이 지나면 퀴즈·참여 데이터가 자동 삭제됩니다(비용 최적화).</p>

        {issued && (
          <div className="issued">
            <p>
              발행 완료: <strong>{issued.code}</strong>
            </p>
            <div className="kv">
              <span>Host PIN</span>
              <code>{issued.hostPin}</code>
              <Copy text={issued.hostPin} />
            </div>
            <div className="kv">
              <span>참여자 링크</span>
              <code className="url">{issued.participantUrl}</code>
              <Copy text={issued.participantUrl} />
            </div>
            <div className="kv">
              <span>호스트 링크</span>
              <code className="url">{issued.hostUrl}</code>
              <Copy text={issued.hostUrl} />
            </div>
            <p className="muted small">
              ⚠️ Host PIN은 지금만 표시됩니다. 호스트에게 링크와 PIN을 전달하세요.
            </p>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>발행 목록</h2>
          <button className="btn tiny ghost" onClick={refresh}>
            새로고침
          </button>
        </div>
        {err && <p className="err">{err}</p>}
        {loading ? (
          <p className="muted">불러오는 중…</p>
        ) : items.length === 0 ? (
          <p className="muted">발행된 퀴즈가 없습니다.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>제목</th>
                <th>Host PIN</th>
                <th>만료일</th>
                <th>상태</th>
                <th>참여자 링크</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.code}>
                  <td><code>{it.code}</code></td>
                  <td>{it.title || '-'}</td>
                  <td className="pin-cell">
                    <code>{revealed[it.code] ? (it.hostPin || '-') : '••••'}</code>
                    <button className="btn tiny ghost lock-btn" title={revealed[it.code] ? '숨기기' : 'PIN 보기'} onClick={() => togglePin(it.code)}>
                      {revealed[it.code] ? '🔓' : '🔒'}
                    </button>
                    {revealed[it.code] && it.hostPin && <Copy text={it.hostPin} />}
                  </td>
                  <td className="small">{fmtDate(it.expireAt)}</td>
                  <td><span className="badge">{it.status}</span></td>
                  <td>
                    <span className="url small">{it.participantUrl}</span>
                    <Copy text={it.participantUrl} />
                  </td>
                  <td className="actions">
                    <button
                      className="btn tiny warn"
                      onClick={() => setModal({ mode: 'reset', code: it.code })}
                    >
                      초기화
                    </button>
                    <button
                      className="btn tiny danger"
                      onClick={() => setModal({ mode: 'delete', code: it.code })}
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {modal && (
        <ConfirmModal
          mode={modal.mode}
          code={modal.code}
          busy={busy}
          onCancel={() => setModal(null)}
          onConfirm={doConfirm}
        />
      )}
    </div>
  );
}
