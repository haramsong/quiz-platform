// Print-only answer sheet. Shown only when printing (@media print) or when
// `active` is true (we toggle a body class and call window.print()).
export default function PrintView({ title, questions }) {
  return (
    <div className="print-view" aria-hidden="true">
      <div className="print-header">
        <h1>{title || '퀴즈'} — 정답지</h1>
        <p className="print-meta">총 {questions.length}문제</p>
      </div>

      {questions.map((q) => {
        const correctIds = q.correctChoiceIds || [];
        return (
          <div className="print-q" key={q.order}>
            <div className="print-q-head">
              <span className="print-q-num">Q{q.order}</span>
              <span className="print-q-type">
                {q.type === 'SINGLE' ? '객관식(단일)' : q.type === 'MULTI' ? '객관식(복수)' : '주관식'}
              </span>
              <span className="print-q-points">{q.points || 1}점</span>
            </div>

            <div className="print-q-body">{q.body}</div>

            {q.imageUrl && (
              <div className="print-q-image">
                <img src={q.imageUrl} alt="" crossOrigin="anonymous" />
              </div>
            )}

            {(q.type === 'SINGLE' || q.type === 'MULTI') && (
              <ul className="print-choices">
                {(q.choices || []).map((c) => {
                  const isCorrect = correctIds.includes(c.id);
                  return (
                    <li key={c.id} className={`print-choice ${isCorrect ? 'correct' : ''}`}>
                      <span className="print-check">{isCorrect ? '☑' : '☐'}</span>
                      <span className="print-choice-text">{c.text}</span>
                    </li>
                  );
                })}
              </ul>
            )}

            {q.type === 'TEXT' && (
              <div className="print-text-answer">
                <div className="print-answer-line">
                  <span className="print-answer-label">정답</span>
                  <span className="print-answer-value">{q.correctText || '-'}</span>
                </div>
                {(q.acceptedAnswers || []).filter(Boolean).length > 0 && (
                  <div className="print-answer-line">
                    <span className="print-answer-label">유사 정답</span>
                    <span className="print-accepted">{(q.acceptedAnswers || []).filter(Boolean).join(', ')}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
