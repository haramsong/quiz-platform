import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';
import { connect, send, disconnect } from '../ws';
import SetupPage from './SetupPage';
import { JoinToastContainer, createToast } from './JoinToast';
import PlayQR from './PlayQR';
import AnswerReveal from '../AnswerReveal';

const Phase = { LOGIN: 'login', SETUP: 'setup', LOBBY: 'lobby', QUESTION: 'question', LB: 'lb', RESULT: 'result', PAST_RESULT: 'past_result' };

// Per-code host PIN cache (session-scoped; cleared when the tab closes).
const pinKey = (code) => `qp_host_pin_${code}`;
const loadPin = (code) => (code ? sessionStorage.getItem(pinKey(code)) || '' : '');
const savePin = (code, pin) => { try { sessionStorage.setItem(pinKey(code), pin); } catch { /* no-op */ } };
const clearPin = (code) => { try { sessionStorage.removeItem(pinKey(code)); } catch { /* no-op */ } };

export default function HostApp({ initialCode }) {
  const [phase, setPhase] = useState(Phase.LOGIN);
  const [code, setCode] = useState(initialCode || '');
  const [pin, setPin] = useState(() => loadPin(initialCode || ''));
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const [quizData, setQuizData] = useState(null);
  const [playerCount, setPcount] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [sessionInfo, setSessionInfo] = useState(null); // { state, playerCount, hasResult }
  const [pastResult, setPastResult] = useState(null);    // getResult snapshot
  const [busy, setBusy] = useState(false);

  const [question, setQuestion] = useState(null);
  const [answered, setAnswered] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const timerRef = useRef(null);
  const [lb, setLb] = useState(null);
  const [result, setResult] = useState(null);

  const [totalSec, setTotalSec] = useState(20);
  const [frac, setFrac] = useState(1); // 1 → 0 (reverse progress)
  const deadlineRef = useRef(0);

  const startTimer = useCallback((sec) => {
    setTotalSec(sec);
    setFrac(1);
    clearInterval(timerRef.current);
    deadlineRef.current = Date.now() + sec * 1000;
    timerRef.current = setInterval(() => {
      const remain = deadlineRef.current - Date.now();
      const f = Math.max(0, remain / (sec * 1000));
      setFrac(f);
      setTimeLeft(Math.ceil(remain / 1000));
      if (remain <= 0) {
        clearInterval(timerRef.current);
        setTimeLeft(0);
        send({ action: 'close' }); // host triggers close at timeout
      }
    }, 100);
  }, []);

  const handleWs = useCallback((type, data) => {
    if (type === 'player_joined') {
      setPcount(data.playerCount);
      setToasts((prev) => [...prev, createToast(data.nickname)]);
      setTimeout(() => setToasts((prev) => prev.slice(1)), 3500);
    }
    if (type === 'question_pushed_host') {
      setQuestion(data); setAnswered(0); setPhase(Phase.QUESTION);
      startTimer(data.timeoutSec || 20);
    }
    if (type === 'question_progress') setAnswered(data.answered);
    if (type === 'leaderboard_question') {
      clearInterval(timerRef.current); setLb(data); setPhase(Phase.LB);
    }
    if (type === 'final_result') {
      clearInterval(timerRef.current); setResult(data); setPhase(Phase.RESULT);
    }
  }, [startTimer]);

  useEffect(() => () => { clearInterval(timerRef.current); disconnect(); }, []);

  const refreshQuiz = useCallback(async () => {
    if (!code || !pin) return;
    try {
      const q = await api.getQuiz(code, pin);
      setQuizData(q);
    } catch { /* ignore */ }
  }, [code, pin]);

  const authenticate = useCallback(async (rawCode, rawPin, { silent = false } = {}) => {
    const enteredCode = (rawCode || '').trim().toUpperCase();
    const enteredPin = (rawPin || '').trim();
    if (!enteredCode || !enteredPin) return false;
    if (!silent) { setLoading(true); setErr(''); }
    try {
      const q = await api.getQuiz(enteredCode, enteredPin); // 403 if invalid
      setCode(enteredCode);
      setPin(enteredPin);
      setQuizData(q);
      setPhase(Phase.SETUP);
      savePin(enteredCode, enteredPin); // remember for this tab
      try {
        const url = new URL(window.location.href);
        if (url.searchParams.get('code') !== enteredCode) {
          url.searchParams.set('code', enteredCode);
          window.history.replaceState({}, '', url);
        }
      } catch { /* no-op */ }
      return true;
    } catch (ex) {
      if (!silent) setErr(ex.message || '접속 실패');
      if (ex.status === 403) clearPin(enteredCode); // stale PIN — forget it
      return false;
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const doLogin = async (e) => {
    e.preventDefault();
    await authenticate(code, pin);
  };

  // Auto-login: if URL has ?code= and we have a stored PIN, try silently.
  useEffect(() => {
    const c = (initialCode || '').trim().toUpperCase();
    const p = loadPin(c);
    if (c && p) authenticate(c, p, { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const s = await api.getSession(code, pin);
      setSessionInfo(s);
      setPcount(s.playerCount || 0);
      return s;
    } catch { return null; }
  }, [code, pin]);

  const goLobby = async () => {
    connect({ code, role: 'host' }, handleWs);
    await refreshSession();
    setPhase(Phase.LOBBY);
  };

  const doStart = async () => {
    // if there is leftover participation data or a finished result, confirm reset first
    const s = sessionInfo || (await refreshSession());
    const hasPrior = (s?.playerCount || 0) > 0 || s?.hasResult || (s?.state && s.state !== 'WAITING');
    if (hasPrior) {
      const okReset = window.confirm(
        '이전 게임 데이터가 있습니다.\n초기화하고 새로 시작할까요?\n(참가자·점수·지난 결과가 삭제됩니다)'
      );
      if (!okReset) return;
      setBusy(true);
      try { await api.resetGame(code, pin); } catch { /* ignore */ }
      setBusy(false);
      setPcount(0);
      setSessionInfo({ state: 'WAITING', playerCount: 0, hasResult: false });
    }
    send({ action: 'start' });
  };

  const doNext = () => send({ action: 'next' });

  const resetGame = async () => {
    if (!window.confirm('게임을 초기화할까요?\n참가자·점수·지난 결과가 삭제됩니다. (문제는 유지)')) return;
    setBusy(true);
    try {
      await api.resetGame(code, pin);
      setPcount(0);
      setSessionInfo({ state: 'WAITING', playerCount: 0, hasResult: false });
      setPastResult(null);
    } catch { /* ignore */ }
    setBusy(false);
  };

  // Stop the current game and return to the lobby (resets so a clean restart works).
  const backToLobby = async () => {
    if (!window.confirm('진행을 중단하고 로비로 돌아갈까요?\n현재 게임이 초기화됩니다.')) return;
    clearInterval(timerRef.current);
    try { await api.resetGame(code, pin); } catch { /* ignore */ }
    setPcount(0);
    setSessionInfo({ state: 'WAITING', playerCount: 0, hasResult: false });
    setQuestion(null); setLb(null); setResult(null);
    setPhase(Phase.LOBBY);
  };

  const viewPastResult = async () => {
    try {
      const r = await api.getResult(code, pin);
      setPastResult(r);
      setPhase(Phase.PAST_RESULT);
    } catch (ex) {
      alert(ex.code === 'NO_RESULT' ? '저장된 지난 결과가 없습니다.' : '결과 조회 실패');
    }
  };

  // ---- RENDER ----
  if (phase === Phase.LOGIN) return (
    <div className="center">
      <h1>📺 호스트 진행</h1>
      <form className="join-form" onSubmit={doLogin}>
        <input autoFocus placeholder="퀴즈 Code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        <input type="password" placeholder="Host PIN" value={pin} onChange={(e) => setPin(e.target.value)} />
        {err && <p className="err">{err}</p>}
        <button className="btn primary" disabled={loading}>{loading ? '확인 중…' : '접속'}</button>
      </form>
    </div>
  );

  if (phase === Phase.SETUP) return (
    <SetupPage code={code} pin={pin} quizData={quizData} onRefresh={refreshQuiz} onStartQuiz={goLobby} onResetGame={resetGame} resetting={busy} />
  );

  if (phase === Phase.LOBBY) return (
    <div className="host-present center">
      <h1 className="lobby-title">{quizData?.title || code}</h1>
      <div className="lobby-join-row">
        {quizData?.thumbnailUrl && <img src={quizData.thumbnailUrl} alt="" className="lobby-thumb" />}
        <PlayQR code={code} size={220} />
      </div>
      <p className="big-count">{playerCount}명 참여</p>
      <p className="muted">QR을 스캔하거나 링크로 입장하세요.</p>
      {sessionInfo?.hasResult && (
        <p className="prior-note">⚠️ 이전 게임 결과가 저장되어 있습니다. 시작 시 초기화됩니다.</p>
      )}
      <button className="btn primary big" onClick={doStart} disabled={busy}>🚀 퀴즈 시작</button>
      <div className="lobby-subactions">
        {sessionInfo?.hasResult && (
          <button className="btn ghost" onClick={viewPastResult}>📊 지난 결과 보기</button>
        )}
      </div>
      <JoinToastContainer toasts={toasts} />
    </div>
  );

  if (phase === Phase.PAST_RESULT && pastResult) return (
    <div className="host-present">
      <h2>📊 지난 게임 결과</h2>
      {pastResult.endedAt && (
        <p className="muted center-text">
          {new Date(pastResult.endedAt).toLocaleString('ko-KR')} 종료
        </p>
      )}
      <div className="lb-list host-lb">
        {pastResult.ranking.map((r, i) => (
          <div key={i} className={`lb-row big ${r.isWinner ? 'winner-row' : ''}`}>
            <span className="rank">#{r.rank}</span>
            <span className="name">{r.nickname}</span>
            <span className="pts">{r.totalScore}점 ({r.totalTimeSec}s)</span>
            {r.isWinner && <span className="badge-win">{r.winReason === 'FIRST' ? '🥇' : '🎁'}</span>}
          </div>
        ))}
      </div>
      <button className="btn ghost big next-btn" onClick={() => setPhase(Phase.LOBBY)}>← 로비로</button>
    </div>
  );

  if (phase === Phase.QUESTION && question) {
    const q = question;
    return (
      <div className="host-present">
        <button className="btn ghost tiny corner-lobby" onClick={backToLobby}>← 로비</button>
        <div className="top-bar">
          <span className="q-num">Q{q.order}/{q.total}</span>
          <span className="points-badge big">{q.points || 1}점</span>
          <span className="progress">응답 {answered}/{playerCount}</span>
        </div>
        <div className={`progress-bar ${frac <= 0.25 ? 'urgent' : ''}`}>
          <div className="progress-fill" style={{ width: `${frac * 100}%` }} />
        </div>
        <div className="question-body"><h2>{q.body}</h2></div>
        {q.imageUrl && (
          <div className="q-image-wrap"><img src={q.imageUrl} alt="문제 이미지" className="q-image" /></div>
        )}
        <div className="host-choices">
          {(q.choices || []).map((c) => (
            <div key={c.id} className="host-choice plain">
              <span className="text">{c.text}</span>
            </div>
          ))}
        </div>
        {q.qType === 'TEXT' && <div className="text-hint"><p className="muted">주관식 — 참여자 화면에서 입력</p></div>}
      </div>
    );
  }

  if (phase === Phase.LB && lb) return (
    <div className="host-present">
      <button className="btn ghost tiny corner-lobby" onClick={backToLobby}>← 로비</button>
      <h2>Q{lb.order} 리더보드</h2>
      <AnswerReveal lb={lb} />
      <div className="lb-list host-lb">
        {lb.entries.slice(0, 10).map((e, i) => (
          <div key={i} className={`lb-row big ${e.isCorrect ? 'correct' : 'wrong'}`}>
            <span className="rank">#{e.rank}</span>
            <span className="name">{e.nickname}</span>
            <span className="time">{e.isCorrect ? `${e.elapsedSec}s` : '✗'}</span>
            <span className="pts">+{e.score}</span>
          </div>
        ))}
      </div>
      {lb.hasNext ? (
        <button className="btn primary big next-btn" onClick={doNext}>➡️ 다음 문제</button>
      ) : (
        <button className="btn primary big next-btn" onClick={doNext}>🏆 최종 결과</button>
      )}
    </div>
  );

  if (phase === Phase.RESULT && result) return (
    <div className="host-present">
      <h2>🏆 최종 결과</h2>
      <div className="lb-list host-lb">
        {result.ranking.map((r, i) => (
          <div key={i} className={`lb-row big ${r.isWinner ? 'winner-row' : ''}`}>
            <span className="rank">#{r.rank}</span>
            <span className="name">{r.nickname}</span>
            <span className="pts">{r.totalScore}점 ({r.totalTimeSec}s)</span>
            {r.isWinner && <span className="badge-win">{r.winReason === 'FIRST' ? '🥇' : '🎁'}</span>}
          </div>
        ))}
      </div>
      <button className="btn ghost big next-btn" onClick={async () => { await refreshSession(); setPhase(Phase.LOBBY); }}>← 로비로</button>
    </div>
  );

  return <div className="center"><p className="muted">로딩 중…</p></div>;
}
