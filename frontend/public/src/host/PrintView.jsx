// Print-only sheet. `mode`: 'question' | 'answer' | 'both'.
// - question: question pages only (no correct marks)
// - answer:   answer pages only (correct marks shown)
// - both:     per question → question page then answer page
export default function PrintView({ title, questions, mode = 'answer' }) {
  const modeLabel = mode === 'question' ? '문제지' : mode === 'both' ? '문제 + 정답지' : '정답지';

  const renderCard = (q, showAnswer) => {
    const correctIds = q.correctChoiceIds || [];
    const typeLabel = q.type === 'SINGLE' ? '객관식 · 단일 선택'
      : q.type === 'MULTI' ? '객관식 · 복수 선택' : '주관식';
    const hasImage = !!q.imageUrl;
    return (
      <section className="print-page" key={`${q.order}-${showAnswer ? 'a' : 'q'}`}>
        <div className={`print-card ${hasImage ? 'has-image' : ''}`}>
          <div className="print-card-head">
            <span className="print-badge">Q{q.order}</span>
            <span className="print-type">{typeLabel}</span>
            <span className="print-kind">{showAnswer ? '정답' : '문제'}</span>
            <span className="print-points">{q.points || 1}점</span>
          </div>

          <div className="print-content">
            <div className="print-main">
              <h2 className="print-body">{q.body}</h2>

              {(q.type === 'SINGLE' || q.type === 'MULTI') && (
                <div className="print-choices">
                  {(q.choices || []).map((c) => {
                    const ok = showAnswer && correctIds.includes(c.id);
                    return (
                      <div key={c.id} className={`print-choice ${ok ? 'correct' : ''}`}>
                        <span className="print-mark">{ok ? '✓' : '○'}</span>
                        <span className="print-choice-text">{c.text}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {q.type === 'TEXT' && (
                showAnswer ? (
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
                ) : (
                  <div className="print-blank">정답: ______________________________</div>
                )
              )}
            </div>

            {hasImage && (
              <div className="print-side"><img src={q.imageUrl} alt="" crossOrigin="anonymous" /></div>
            )}
          </div>

          <div className="print-foot">{title || '퀴즈'} — {showAnswer ? '정답' : '문제'}</div>
        </div>
      </section>
    );
  };

  const pages = [];
  for (const q of questions) {
    if (mode === 'question') pages.push(renderCard(q, false));
    else if (mode === 'answer') pages.push(renderCard(q, true));
    else { pages.push(renderCard(q, false)); pages.push(renderCard(q, true)); }
  }

  return (
    <div className="print-view" aria-hidden="true">
      <section className="print-page print-cover">
        <div className="print-brand">🎯 Quiz Platform</div>
        <h1 className="print-cover-title">{title || '퀴즈'}</h1>
        <div className="print-cover-sub">{modeLabel} · 총 {questions.length}문제</div>
      </section>
      {pages}
    </div>
  );
}
