import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';
import { connect, send, disconnect } from '../ws';
import AnswerReveal from '../AnswerReveal';

const Phase = { JOIN: 'join', WAIT: 'wait', ANSWER: 'answer', LEADERBOARD: 'lb', RESULT: 'result' };

export default function PlayerApp({ initialCode }) {
  const [phase, setPhase] = useState(Phase.JOIN);
  const [code, setCode] = useState(initialCode || '');
  const [nickname, setNick] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState(null);

  // question state
  const [question, setQuestion] = useState(null);
  const [selected, setSelected] = useState([]);
  const [textAns, setTextAns] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [frac, setFrac] = useState(1);
  const startRef = useRef(0); // performance.now at question_pushed
  const deadlineRef = useRef(0);

  // leaderboard / result
  const [lb, setLb] = useState(null);
  const [result, setResult] = useState(null);

  const timerRef = useRef(null);

  const startTimer = useCallback((sec) => {
    setFrac(1);
    clearInterval(timerRef.current);
    deadlineRef.current = Date.now() + sec * 1000;
    timerRef.current = setInterval(() => {
      const remain = deadlineRef.current - Date.now();
      setFrac(Math.max(0, remain / (sec * 1000)));
      if (remain <= 0) clearInterval(timerRef.current);
    }, 100);
  }, []);

  const handleWs = useCallback((type, data) => {
    if (type === 'question_pushed_player') {
      startRef.current = performance.now();
      setQuestion(data);
      setSelected([]);
      setTextAns('');
      setSubmitted(false);
      setPhase(Phase.ANSWER);
      startTimer(data.timeoutSec || 20);
    }
    if (type === 'leaderboard_question') {
      clearInterval(timerRef.current);
      setLb(data);
      setPhase(Phase.LEADERBOARD);
    }
    if (type === 'final_result') {
      clearInterval(timerRef.current);
      setResult(data);
      setPhase(Phase.RESULT);
    }
  }, [startTimer]);

  useEffect(() => () => { clearInterval(timerRef.current); disconnect(); }, []);

  const doJoin = async (e) => {
    e.preventDefault();
    if (!code.trim() || !nickname.trim()) return;
    setLoading(true); setErr('');
    try {
      const r = await api.join(code.trim().toUpperCase(), nickname.trim());
      setToken(r.sessionToken);
      connect({ token: r.sessionToken }, handleWs);
      setPhase(Phase.WAIT);
    } catch (ex) {
      setErr(ex.message || '입장 실패');
    } finally { setLoading(false); }
  };

  const doAnswer = (choices) => {
    if (submitted) return;
    const elapsed = Math.round(performance.now() - startRef.current);
    send({ action: 'answer', order: question.order, submitted: choices, clientElapsedMs: elapsed });
    setSubmitted(true);
    // keep the timer running — the progress bar should continue until timeout.
  };

  const tapSingle = (id) => {
    if (submitted) return;
    setSelected([id]); // show selection highlight first
    setTimeout(() => doAnswer([id]), 350); // brief delay so the user sees their pick
  };
  const toggleMulti = (id) => {
    setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  };

  // ---- RENDER ----
  if (phase === Phase.JOIN) return (
    <div className="center">
      <h1>🎯 퀴즈 참여</h1>
      <form className="join-form" onSubmit={doJoin}>
        <input autoFocus placeholder="참여 Code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        <input placeholder="닉네임" value={nickname} onChange={(e) => setNick(e.target.value)} />
        {err && <p className="err">{err}</p>}
        <button className="btn primary" disabled={loading}>{loading ? '입장 중…' : '입장'}</button>
      </form>
    </div>
  );

  if (phase === Phase.WAIT) return (
    <div className="center">
      <h1>⏳ 대기 중</h1>
      <p className="muted">{nickname}님, 호스트가 퀴즈를 시작할 때까지 기다려주세요.</p>
      <div className="pulse"></div>
    </div>
  );

  if (phase === Phase.ANSWER && question) {
    const q = question;
    const isSingle = q.qType === 'SINGLE';
    const isMulti = q.qType === 'MULTI';
    const isText = q.qType === 'TEXT';

    return (
      <div className="player-answer">
        <div className="top-bar">
          <div className="top-left">
            <span className="q-num">Q{q.order}/{q.total}</span>
            <span className="points-badge">{q.points || 1}점</span>
          </div>
          <span className="submitted-badge" style={{ visibility: submitted ? 'visible' : 'hidden' }}>✅ 제출 완료</span>
        </div>
        <div className={`progress-bar ${frac <= 0.25 ? 'urgent' : ''}`}>
          <div className="progress-fill" style={{ width: `${frac * 100}%` }} />
        </div>

        <div className="player-question">
          <h2 className="player-q-body">{q.body}</h2>
          {q.imageUrl && <img src={q.imageUrl} alt="문제 이미지" className="player-q-image" />}
        </div>

        {(isSingle || isMulti) && (
          <div className="choice-list">
            {(q.choices || []).map((c) => (
              <button
                key={c.id}
                className={`choice-line ${selected.includes(c.id) ? 'sel' : ''}`}
                disabled={submitted}
                onClick={() => isSingle ? tapSingle(c.id) : toggleMulti(c.id)}
              >
                {c.text}
              </button>
            ))}
          </div>
        )}
        {isMulti && !submitted && (
          <button className="btn primary submit-btn" disabled={selected.length === 0} onClick={() => doAnswer(selected)}>
            제출 ({selected.length}개 선택)
          </button>
        )}
        {isText && (
          <div className="text-answer">
            <input autoFocus disabled={submitted} placeholder="정답 입력" value={textAns} onChange={(e) => setTextAns(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !submitted && textAns.trim() && doAnswer(textAns.trim())} />
            {!submitted && <button className="btn primary" disabled={!textAns.trim()} onClick={() => doAnswer(textAns.trim())}>제출</button>}
          </div>
        )}
        {submitted && <p className="muted center-text">결과를 기다리는 중…</p>}
      </div>
    );
  }

  if (phase === Phase.LEADERBOARD && lb) return (
    <div className="page-compact">
      <h2 className="center-text">Q{lb.order} 리더보드</h2>
      <AnswerReveal lb={lb} />
      <div className="lb-list">
        {lb.entries.map((e, i) => {
          const isMe = e.nickname === nickname;
          return (
            <div key={i} className={`lb-row ${isMe ? 'me' : ''} ${e.isCorrect ? 'correct' : 'wrong'}`}>
              <span className="rank">#{e.rank}</span>
              <span className="name">{e.nickname}</span>
              <span className="time">{e.isCorrect ? `${e.elapsedSec}s` : '✗'}</span>
              <span className="pts">+{e.score}</span>
            </div>
          );
        })}
      </div>
      {lb.hasNext && <p className="muted center-text">다음 문제를 기다리는 중…</p>}
    </div>
  );

  if (phase === Phase.RESULT && result) {
    const me = result.ranking.find((r) => r.nickname === nickname);
    return (
      <div className="page-compact">
        <h2>🏆 최종 결과</h2>
        {me && (
          <div className={`my-result ${me.isWinner ? 'winner' : ''}`}>
            <span className="big-rank">#{me.rank}</span>
            <span>{me.nickname} — {me.totalScore}점</span>
            {me.isWinner && <span className="prize">🎉 {me.winReason === 'FIRST' ? '1등 당첨!' : '랜덤 당첨!'}</span>}
          </div>
        )}
        <div className="lb-list">
          {result.ranking.map((r, i) => (
            <div key={i} className={`lb-row ${r.nickname === nickname ? 'me' : ''} ${r.isWinner ? 'winner-row' : ''}`}>
              <span className="rank">#{r.rank}</span>
              <span className="name">{r.nickname}</span>
              <span className="pts">{r.totalScore}점</span>
              <span className="time">{r.totalTimeSec}s</span>
              {r.isWinner && <span className="badge-win">{r.winReason === 'FIRST' ? '🥇' : '🎁'}</span>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return <div className="center"><p className="muted">로딩 중…</p></div>;
}
