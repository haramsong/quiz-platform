import { useState, useEffect, useRef } from 'react';
import { toWebp } from '../utils/webp';
import { uploadImage } from '../utils/upload';
import { useToast } from '../Toast';

const API = import.meta.env.VITE_API_URL;

async function apiCall(path, code, pin, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method, headers: { 'content-type': 'application/json', 'x-host-auth': `${code}:${pin}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

export default function SetupPage({ code, pin, quizData, onRefresh, onStartQuiz, onResetGame, resetting }) {
  const toast = useToast();
  const [title, setTitle] = useState(quizData?.title || '');
  const [timeout, setTimeout_] = useState(quizData?.timeoutSec || 20);
  const [prizeWinners, setPrize] = useState(quizData?.prizeWinners || 1);
  const [thumbnailKey, setThumbKey] = useState(quizData?.thumbnailKey || null);
  const [thumbPreview, setThumbPreview] = useState(quizData?.thumbnailUrl || null);
  const [questions, setQuestions] = useState(quizData?.questions || []);
  const [selIdx, setSelIdx] = useState(-1);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const initedRef = useRef(false);

  // Initialize from server data only once (avoid clobbering unsaved local edits).
  useEffect(() => {
    if (quizData && !initedRef.current) {
      initedRef.current = true;
      setTitle(quizData.title || '');
      setTimeout_(quizData.timeoutSec || 20);
      setPrize(quizData.prizeWinners || 1);
      setThumbKey(quizData.thumbnailKey || null);
      setThumbPreview(quizData.thumbnailUrl || null);
      setQuestions(quizData.questions || []);
    }
  }, [quizData]);

  const saveSettings = async () => {
    setSaving(true); setMsg('');
    await apiCall('/quizzes', code, pin, { method: 'POST', body: { code, title, timeoutSec: timeout, prizeWinners, thumbnailKey } });
    setSaving(false); setMsg('설정 저장됨');
    setTimeout(() => setMsg(''), 2000);
  };

  // Save everything at once: quiz settings + every question.
  const saveAll = async () => {
    setSaving(true); setMsg('저장 중…');
    try {
      await apiCall('/quizzes', code, pin, { method: 'POST', body: { code, title, timeoutSec: timeout, prizeWinners, thumbnailKey } });
      const snapshot = questions;
      for (const q of snapshot) {
        const body = { ...q }; delete body._new; delete body._dirty; delete body.imageUrl;
        if (q._new) {
          await apiCall(`/quizzes/${code}/questions`, code, pin, { method: 'POST', body });
        } else {
          await apiCall(`/quizzes/${code}/questions/${q.order}`, code, pin, { method: 'PUT', body });
        }
      }
      // clear _new / _dirty flags locally (all saved)
      setQuestions((prev) => prev.map((q) => ({ ...q, _new: false, _dirty: false })));
      setMsg(`전체 저장 완료 (${snapshot.length}문제)`);
      toast.show(`전체 저장 완료 (${snapshot.length}문제)`, { type: 'success' });
    } catch {
      setMsg('저장 실패 — 다시 시도하세요');
      toast.show('저장에 실패했어요', { type: 'error' });
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(''), 2500);
    }
  };

  const addQuestion = () => {
    const maxOrder = questions.reduce((m, q) => Math.max(m, q.order || 0), 0);
    const order = maxOrder + 1;
    const q = { order, type: 'SINGLE', body: '', choices: [{ id: 'a', text: '' }, { id: 'b', text: '' }], correctChoiceIds: [], correctText: '', acceptedAnswers: [], points: 1, imageKey: null, imageUrl: null, _new: true };
    setQuestions((prev) => [...prev, q]);
    setSelIdx(questions.length);
  };

  const updateQ = (idx, patch) => {
    setQuestions((prev) => {
      const copy = [...prev];
      // mark dirty on any edit (unless it's a brand-new question, which is already flagged)
      copy[idx] = { ...copy[idx], ...patch, _dirty: copy[idx]._new ? false : true };
      return copy;
    });
  };

  const saveQ = async (idx) => {
    const q = questions[idx];
    setSaving(true); setMsg('');
    const body = { ...q }; delete body._new; delete body.imageUrl;
    if (q._new) {
      await apiCall(`/quizzes/${code}/questions`, code, pin, { method: 'POST', body });
    } else {
      await apiCall(`/quizzes/${code}/questions/${q.order}`, code, pin, { method: 'PUT', body });
    }
    // mark saved in local state (do NOT refetch-replace, which can drop unsaved items)
    setQuestions((prev) => {
      const copy = [...prev];
      if (copy[idx]) copy[idx] = { ...copy[idx], _new: false };
      return copy;
    });
    setSaving(false); setMsg(`Q${q.order} 저장됨`);
    setTimeout(() => setMsg(''), 2000);
  };

  const deleteQ = async (idx) => {
    const q = questions[idx];
    if (!confirm(`Q${q.order} 삭제?`)) return;
    if (!q._new) {
      await apiCall(`/quizzes/${code}/questions/${q.order}`, code, pin, { method: 'DELETE' });
    }
    setQuestions((prev) => prev.filter((_, i) => i !== idx));
    setSelIdx(-1);
    setMsg(`Q${q.order} 삭제됨`);
    setTimeout(() => setMsg(''), 2000);
  };

  const handleThumb = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMsg('썸네일 변환 중…');
    const { blob } = await toWebp(file, { maxWidth: 600 });
    setMsg('업로드 중…');
    const key = await uploadImage({ code, pin, purpose: 'thumbnail', blob });
    setThumbKey(key);
    setThumbPreview(URL.createObjectURL(blob));
    setMsg('썸네일 업로드 완료');
    setTimeout(() => setMsg(''), 2000);
  };

  const handleQImage = async (e, idx) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMsg('이미지 변환 중…');
    const { blob } = await toWebp(file, { maxWidth: 1000 });
    setMsg('업로드 중…');
    const key = await uploadImage({ code, pin, purpose: 'question', order: questions[idx].order, blob });
    updateQ(idx, { imageKey: key, imageUrl: URL.createObjectURL(blob) });
    setMsg('이미지 업로드 완료');
    setTimeout(() => setMsg(''), 2000);
  };

  const sel = selIdx >= 0 ? questions[selIdx] : null;

  return (
    <div className="setup">
      <header className="setup-header">
        <h2>📝 퀴즈 세팅 — <code>{code}</code></h2>
        <div className="setup-actions">
          {msg && <span className="msg">{msg}</span>}
          {onResetGame && (
            <button className="btn ghost" onClick={onResetGame} disabled={resetting} title="참가자·점수·지난 결과 삭제 (문제는 유지)">
              ♻️ 게임 초기화
            </button>
          )}
          <button className="btn save-all" onClick={saveAll} disabled={saving}>
            💾 전체 저장
          </button>
          <button className="btn primary" onClick={onStartQuiz} disabled={questions.length === 0}>
            🚀 진행 시작 ({questions.length}문제)
          </button>
        </div>
      </header>

      <div className="setup-body">
        {/* LEFT: settings + question list */}
        <aside className="setup-left">
          <div className="setup-panel">
            <h3>설정</h3>
            <label>퀴즈 제목<input value={title} onChange={e => setTitle(e.target.value)} placeholder="퀴즈 제목" /></label>
            <label>문제당 시간(초)<input type="number" min={5} max={300} value={timeout} onChange={e => setTimeout_(+e.target.value)} /></label>
            <label>상품 당첨 인원<input type="number" min={1} max={100} value={prizeWinners} onChange={e => setPrize(+e.target.value)} /></label>
            <label>썸네일 (선택)
              <label className="file-btn">
                {thumbPreview ? '🖼️ 썸네일 변경' : '🖼️ 썸네일 업로드'}
                <input type="file" accept="image/*" onChange={handleThumb} hidden />
              </label>
              {thumbPreview && <img src={thumbPreview} alt="thumb" className="thumb-preview" />}
            </label>
          </div>

          <div className="setup-panel">
            <div className="panel-head"><h3>문제 목록</h3><button className="btn tiny primary" onClick={addQuestion}>+ 추가</button></div>
            <div className="q-list">
              {questions.map((q, i) => (
                <div key={i} className={`q-item ${i === selIdx ? 'sel' : ''} ${(q._dirty || q._new) ? 'dirty' : ''}`} onClick={() => setSelIdx(i)}>
                  <span className="q-order">Q{q.order}</span>
                  <span className="q-type">{q.type}</span>
                  <span className="q-body-preview">{q.body?.slice(0, 30) || '(빈 문제)'}</span>
                  {(q._dirty || q._new) && <span className="dirty-dot" title="저장되지 않은 변경">●</span>}
                </div>
              ))}
              {questions.length === 0 && <p className="muted small">문제를 추가하세요.</p>}
            </div>
          </div>
        </aside>

        {/* RIGHT: question editor */}
        <main className="setup-right">
          {sel ? (
            <QuestionEditor
              q={sel}
              idx={selIdx}
              onChange={(patch) => updateQ(selIdx, patch)}
              onDelete={() => deleteQ(selIdx)}
              onImage={(e) => handleQImage(e, selIdx)}
              saving={saving}
            />
          ) : (
            <div className="empty-editor"><p className="muted">좌측에서 문제를 선택하거나 추가하세요.</p></div>
          )}
        </main>
      </div>
    </div>
  );
}

function QuestionEditor({ q, idx, onChange, onDelete, onImage, saving }) {
  const setType = (type) => {
    const patch = { type };
    if (type === 'TEXT') { patch.choices = null; patch.correctChoiceIds = null; }
    else if (!q.choices || q.choices.length === 0) {
      patch.choices = [{ id: 'a', text: '' }, { id: 'b', text: '' }];
      patch.correctChoiceIds = [];
    }
    onChange(patch);
  };

  const addChoice = () => {
    const choices = [...(q.choices || [])];
    const id = String.fromCharCode(97 + choices.length); // a, b, c, ...
    choices.push({ id, text: '' });
    onChange({ choices });
  };
  const removeChoice = (i) => {
    const choices = (q.choices || []).filter((_, ci) => ci !== i);
    const ids = choices.map(c => c.id);
    onChange({ choices, correctChoiceIds: (q.correctChoiceIds || []).filter(x => ids.includes(x)) });
  };
  const setChoiceText = (i, text) => {
    const choices = [...(q.choices || [])];
    choices[i] = { ...choices[i], text };
    onChange({ choices });
  };
  const toggleCorrect = (id) => {
    let ids = [...(q.correctChoiceIds || [])];
    if (q.type === 'SINGLE') { ids = [id]; }
    else { ids = ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]; }
    onChange({ correctChoiceIds: ids });
  };

  const addAccepted = () => onChange({ acceptedAnswers: [...(q.acceptedAnswers || []), ''] });
  const setAccepted = (i, v) => { const a = [...(q.acceptedAnswers || [])]; a[i] = v; onChange({ acceptedAnswers: a }); };
  const removeAccepted = (i) => { const a = (q.acceptedAnswers || []).filter((_, ci) => ci !== i); onChange({ acceptedAnswers: a }); };

  return (
    <div className="q-editor">
      <div className="q-editor-head">
        <h3>Q{q.order} 편집</h3>
        <button className="btn danger tiny" onClick={onDelete}>삭제</button>
      </div>
      <p className="editor-hint muted small">변경 사항은 상단 <strong>전체 저장</strong>을 눌러야 반영됩니다.</p>

      <div className="field">
        <label>문제 유형</label>
        <div className="type-btns">
          {['SINGLE','MULTI','TEXT'].map(t => (
            <button key={t} className={`btn tiny ${q.type === t ? 'primary' : 'ghost'}`} onClick={() => setType(t)}>{t === 'SINGLE' ? '단일 선택' : t === 'MULTI' ? '복수 선택' : '주관식'}</button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>문제 본문</label>
        <textarea rows={3} value={q.body || ''} onChange={e => onChange({ body: e.target.value })} placeholder="문제를 입력하세요" />
      </div>

      {(q.type === 'SINGLE' || q.type === 'MULTI') && (
        <div className="field">
          <label>보기 {q.type === 'SINGLE' ? '(정답 1개 선택)' : '(정답 여러 개 선택)'}</label>
          {(q.choices || []).map((c, i) => (
            <div key={c.id} className="choice-row">
              <span className="choice-label plain">{i + 1}</span>
              <input value={c.text} onChange={e => setChoiceText(i, e.target.value)} placeholder={`보기 ${i + 1}`} />
              <label className="choice-check">
                <input type={q.type === 'SINGLE' ? 'radio' : 'checkbox'} name="correct" checked={(q.correctChoiceIds || []).includes(c.id)} onChange={() => toggleCorrect(c.id)} />
                정답
              </label>
              {(q.choices || []).length > 2 && <button className="btn tiny ghost" onClick={() => removeChoice(i)}>✕</button>}
            </div>
          ))}
          {(q.choices || []).length < 6 && <button className="btn tiny ghost" onClick={addChoice}>+ 보기 추가</button>}
        </div>
      )}

      {q.type === 'TEXT' && (
        <>
          <div className="field">
            <label>정답</label>
            <input value={q.correctText || ''} onChange={e => onChange({ correctText: e.target.value })} placeholder="정답" />
          </div>
          <div className="field">
            <label>유사 정답 (허용 답안)</label>
            {(q.acceptedAnswers || []).map((a, i) => (
              <div key={i} className="accepted-row">
                <input value={a} onChange={e => setAccepted(i, e.target.value)} placeholder="허용 답안" />
                <button className="btn tiny ghost" onClick={() => removeAccepted(i)}>✕</button>
              </div>
            ))}
            <button className="btn tiny ghost" onClick={addAccepted}>+ 허용 답안 추가</button>
          </div>
        </>
      )}

      <div className="field">
        <label>배점<input type="number" min={1} max={100} value={q.points || 1} onChange={e => onChange({ points: +e.target.value })} /></label>
      </div>

      <div className="field">
        <label>이미지 (선택)</label>
        <label className="file-btn">
          {(q.imageUrl || q.imageKey) ? '🖼️ 이미지 변경' : '🖼️ 이미지 업로드'}
          <input type="file" accept="image/*" onChange={onImage} hidden />
        </label>
        {(q.imageUrl || q.imageKey) && <img src={q.imageUrl} alt="q-img" className="q-img-preview" />}
      </div>
    </div>
  );
}
