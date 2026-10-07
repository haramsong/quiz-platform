// Print-only answer sheet — one question per landscape page, host-styled.
export default function PrintView({ title, questions }) {
  return (
    <div className="print-view" aria-hidden="true">
      {/* cover page */}
      <section className="print-page print-cover">
        <div className="print-brand">🎯 Quiz Platform</div>
        <h1 className="print-cover-title">{title || '퀴즈'}</h1>
        <div className="print-cover-sub">정답지 · 총 {questions.length}문제</div>
      </section>

      {questions.map((q) => {
        const correctIds = q.correctChoiceIds || [];
        const typeLabel = q.type === 'SINGLE' ? '객관식 · 단일 선택'
          : q.type === 'MULTI' ? '객관식 · 복수 선택' : '주관식';
        return (
          <section className="print-page" key={q.order}>
            <div className="print-card">
              <div className="print-card-head">
                <span className="print-badge">Q{q.order}</span>
                <span className="print-type">{typeLabel}</span>
                <span className="print-points">{q.points || 1}점</span>
              </div>

              <h2 className="print-body">{q.body}</h2>

              {q.imageUrl && (
                <div className="print-image"><img src={q.imageUrl} alt="" crossOrigin="anonymous" /></div>
              )}

              {(q.type === 'SINGLE' || q.type === 'MULTI') && (
                <div className="print-choices">
                  {(q.choices || []).map((c) => {
                    const ok = correctIds.includes(c.id);
                    return (
                      <div key={c.id} className={`print-choice ${ok ? 'correct' : ''}`}>
                        <span className="print-mark">{ok ? '✓' : ''}</span>
                        <span className="print-choice-text">{c.text}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {q.type === 'TEXT' && (
                <div className="print-text">
                  <div className="print-answer-row">
                    <span className="print-answer-tag">정답</span>
                    <span className="print-answer-val">{q.correctText || '-'}</span>
                  </div>
                  {(q.acceptedAnswers || []).filter(Boolean).length > 0 && (
                    <div className="print-answer-row accepted">
                      <span className="print-answer-tag">유사 정답</span>
                      <span className="print-accepted">{(q.acceptedAnswers || []).filter(Boolean).join(', ')}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="print-foot">{title || '퀴즈'} — 정답지</div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
