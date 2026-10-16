import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';
import { connect, send, disconnect, stopPing } from '../ws';
import AnswerReveal from '../AnswerReveal';
import { loadToken, saveToken, clearToken, isReconnectToken, playerIdFromToken, loadNick, saveNick, clearNick } from '../utils/session';

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
  const [aggregating, setAggregating] = useState(false);
  const [frac, setFrac] = useState(1);
  const [secLeft, setSecLeft] = useState(0);
  const startRef = useRef(0); // performance.now at question_pushed
  const deadlineRef = useRef(0);

  // leaderboard / result
  const [lb, setLb] = useState(null);
  const [result, setResult] = useState(null);

  const timerRef = useRef(null);

  const startTimer = useCallback((sec) => {
    setFrac(1);
    setSecLeft(sec);
    clearInterval(timerRef.current);
    deadlineRef.current = Date.now() + sec * 1000;
    timerRef.current = setInterval(() => {
      const remain = deadlineRef.current - Date.now();
      setFrac(Math.max(0, remain / (sec * 1000)));
      setSecLeft(Math.max(0, Math.ceil(remain / 1000)));
      if (remain <= 0) clearInterval(timerRef.current);
    }, 100);
  }, []);

  // reconnect bookkeeping: distinguish a rejected token (close before any open)
  // from a normal transient drop (ws.js auto-reconnects on its own).
  const connectedOnceRef = useRef(false);
  const reconnectingRef = useRef(false);

  const handleWs = useCallback((type, data) => {
    if (type === '_open') {
      connectedOnceRef.current = true;
      reconnectingRef.current = false;
      return;
    }
    if (type === '_close') {
      // Close before we ever opened during a token-based reconnect means the
      // server rejected the token ($connect 403: player no longer exists /
      // forged / expired). Stop retrying and fall back to the join screen.
      if (!connectedOnceRef.current && reconnectingRef.current) {
        reconnectingRef.current = false;
        disconnect(); // stops keep-alive + auto-reconnect loop
        clearToken(code);
        clearNick(code);
        setToken(null);
        setPhase(Phase.JOIN);
        setErr('세션이 만료되었어요. 다시 입장해주세요.');
      }
      return;
    }
    if (type === 'question_pushed_player') {
      startRef.current = performance.now();
      setQuestion(data);
      setSelected([]);
      setTextAns('');
      setSubmitted(false);
      setAggregating(false);
      setPhase(Phase.ANSWER);
      startTimer(data.timeoutSec || 10);
    }
    if (type === 'aggregating') {
      clearInterval(timerRef.current);
      setAggregating(true);
    }
    if (type === 'leaderboard_question') {
      clearInterval(timerRef.current);
      setAggregating(false);
      setLb(data);
      setPhase(Phase.LEADERBOARD);
    }
    if (type === 'final_result') {
      clearInterval(timerRef.current);
      setAggregating(false);
      setResult(data);
      setPhase(Phase.RESULT);
      stopPing(); // game over → stop keep-alive so the connection idles out
      clearToken(code); // finished quiz: don't auto-reconnect on a later visit
      clearNick(code);
    }
  }, [startTimer, code]);

  // On mount: if we have a stored token for this code, reconnect automatically
  // (refresh / network drop / mid-game rejoin) and wait for the next question.
  useEffect(() => {
    const saved = loadToken(initialCode);
    if (isReconnectToken(saved, initialCode)) {
      setToken(saved);
      const savedNick = loadNick(initialCode);
      if (savedNick) setNick(savedNick); // restore display name on reconnect
      connectedOnceRef.current = false;
      reconnectingRef.current = true;
      connect({ token: saved }, handleWs);
      setPhase(Phase.WAIT);
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => { clearInterval(timerRef.current); disconnect(); }, []);

  const doJoin = async (e) => {
    e.preventDefault();
    if (!code.trim() || !nickname.trim()) return;
    setLoading(true); setErr('');
    try {
      const normCode = code.trim().toUpperCase();
      const r = await api.join(normCode, nickname.trim());
      setToken(r.sessionToken);
      saveToken(normCode, r.sessionToken); // persist for reconnect
      saveNick(normCode, nickname.trim()); // persist display name for reconnect
      connectedOnceRef.current = false;
      reconnectingRef.current = false; // fresh join: close shouldn't trigger token-expiry fallback
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
    setSelected([id]);  // highlight the pick immediately
    doAnswer([id]);     // submit at once — elapsed = the real tap time, no +350ms bias.
                        // the "✅ 제출 완료" badge + selected highlight already show what was chosen.
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
            <span className="q-num">Q {q.order} / {q.total}</span>
            <span className={`time-left ${secLeft <= 5 ? 'urgent' : ''}`}>⏱ {secLeft}s</span>
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
        {aggregating ? (
          <div className="aggregating-inline"><span className="spinner small" /><span>집계 중…</span></div>
        ) : (
          submitted && <p className="muted center-text">결과를 기다리는 중…</p>
        )}
      </div>
    );
  }

  if (phase === Phase.LEADERBOARD && lb) {
    const myId = playerIdFromToken(token);
    const mine = (lb.entries || []).find((e) => e.playerId === myId);
    return (
      <div className="page-compact">
        <h2 className="center-text">Q{lb.order} 결과</h2>

        {mine ? (
          <div className={`my-answer ${mine.isCorrect ? 'correct' : 'wrong'}`}>
            {mine.isCorrect ? `✅ 정답! (${mine.elapsedSec}s) +${mine.score}점` : '❌ 오답'}
          </div>
        ) : (
          <div className="my-answer wrong">⏳ 미응답</div>
        )}

        <AnswerReveal lb={lb} />

        {lb.distribution && (
          <div className="dist-list">
            {lb.distribution.map((d) => (
              <div key={d.id} className={`dist-row ${d.isCorrect ? 'correct' : ''}`}>
                <div className="dist-head">
                  <span className="dist-text">{d.isCorrect ? '✓ ' : ''}{d.text}</span>
                  <span className="dist-pct">{d.percent}%</span>
                </div>
                <div className="dist-bar"><div className="dist-fill" style={{ width: `${d.percent}%` }} /></div>
              </div>
            ))}
          </div>
        )}

        {lb.hasNext && <p className="muted center-text">다음 문제를 기다리는 중…</p>}
      </div>
    );
  }

  if (phase === Phase.RESULT && result) {
    const myId = playerIdFromToken(token);
    const me = result.ranking.find((r) => r.playerId === myId) || result.ranking.find((r) => r.nickname === nickname);
    const top5 = result.ranking.slice(0, 5);
    return (
      <div className="page-compact">
        <h2 className="center-text">🏆 최종 결과</h2>

        {me && (
          <div className={`my-result ${me.isWinner ? 'winner' : ''}`}>
            <span className="big-rank">#{me.rank}</span>
            <span>{me.nickname} — {me.totalScore}점</span>
            {me.isWinner && <span className="prize">🎉 당첨되었습니다!</span>}
          </div>
        )}

        <div className="lb-list">
          {top5.map((r, i) => (
            <div key={i} className={`lb-row ${r.playerId === myId ? 'me' : ''} ${r.isWinner ? 'winner-row' : ''}`}>
              <span className="rank">#{r.rank}</span>
              <span className="name">{r.nickname}</span>
              <span className="pts">{r.totalScore}점</span>
              <span className="time">{r.totalTimeSec}s</span>
              {r.isWinner && <span className="badge-win">{r.winReason === 'FIRST' ? '🥇' : '🎁'}</span>}
            </div>
          ))}
        </div>

        {(result.funFastest || result.funReaction) && (
          <div className="fun-stats">
            {result.funFastest && (
              <div className="fun-card">
                <div className="fun-label">🏃 가장 빠른 참가자</div>
                <div className="fun-name">{result.funFastest.nickname}</div>
                <div className="fun-sub">평균 {result.funFastest.avgSec}s</div>
              </div>
            )}
            {result.funReaction && (
              <div className="fun-card">
                <div className="fun-label">⚡ 최고 반응속도</div>
                <div className="fun-name">{result.funReaction.nickname}</div>
                <div className="fun-sub">Q{result.funReaction.order} · {result.funReaction.elapsedSec}s</div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return <div className="center"><p className="muted">로딩 중…</p></div>;
}
