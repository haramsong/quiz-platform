import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';
import { connect, send, disconnect } from '../ws';
import { colorHex } from '../constants';
import SetupPage from './SetupPage';
import { JoinToastContainer, createToast } from './JoinToast';
import AnswerReveal from '../AnswerReveal';

const Phase = { LOGIN: 'login', SETUP: 'setup', LOBBY: 'lobby', QUESTION: 'question', LB: 'lb', RESULT: 'result' };

export default function HostApp({ initialCode }) {
  const [phase, setPhase] = useState(Phase.LOGIN);
  const [code, setCode] = useState(initialCode || '');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const [quizData, setQuizData] = useState(null);
  const [playerCount, setPcount] = useState(0);
  const [toasts, setToasts] = useState([]);

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

  const doLogin = async (e) => {
    e.preventDefault();
    setLoading(true); setErr('');
    try {
      const enteredCode = code.trim().toUpperCase();
      const enteredPin = pin.trim();
      // getQuiz succeeds only when code + PIN are valid (403 otherwise)
      const q = await api.getQuiz(enteredCode, enteredPin);
      setCode(enteredCode);
      setPin(enteredPin);
      setQuizData(q);
      setPhase(Phase.SETUP);
      // sync the URL ?code= to the authenticated code (fix mismatched/stale URL)
      try {
        const url = new URL(window.location.href);
        if (url.searchParams.get('code') !== enteredCode) {
          url.searchParams.set('code', enteredCode);
          window.history.replaceState({}, '', url);
        }
      } catch { /* no-op */ }
    } catch (ex) {
      setErr(ex.message || '접속 실패');
    } finally { setLoading(false); }
  };

  const goLobby = () => {
    connect({ code, role: 'host' }, handleWs);
    setPhase(Phase.LOBBY);
  };

  const doStart = () => send({ action: 'start' });
  const doNext = () => send({ action: 'next' });

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
    <SetupPage code={code} pin={pin} quizData={quizData} onRefresh={refreshQuiz} onStartQuiz={goLobby} />
  );

  if (phase === Phase.LOBBY) return (
    <div className="host-present center">
      {quizData?.thumbnailUrl && <img src={quizData.thumbnailUrl} alt="" className="lobby-thumb" />}
      <h1 className="lobby-title">{quizData?.title || code}</h1>
      <p className="big-count">{playerCount}명 참여</p>
      <p className="muted">참여자가 입장하면 숫자가 올라갑니다.</p>
      <button className="btn primary big" onClick={doStart}>🚀 퀴즈 시작</button>
      <JoinToastContainer toasts={toasts} />
    </div>
  );

  if (phase === Phase.QUESTION && question) {
    const q = question;
    return (
      <div className="host-present">
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
            <div key={c.id} className="host-choice" style={{ background: colorHex(c.color) }}>
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
    </div>
  );

  return <div className="center"><p className="muted">로딩 중…</p></div>;
}
