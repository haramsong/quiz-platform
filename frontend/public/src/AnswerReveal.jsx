// Shared answer reveal shown on the question leaderboard (host + player).
export default function AnswerReveal({ lb }) {
  if (!lb) return null;
  const answer = lb.correctAnswer;
  if (!answer) return null;
  const accepted = (lb.acceptedAnswers || []).filter(Boolean);
  return (
    <div className="answer-reveal">
      <div className="answer-label">정답</div>
      <div className="answer-value">{answer}</div>
      {accepted.length > 0 && (
        <div className="answer-accepted">유사 정답 인정: {accepted.join(', ')}</div>
      )}
    </div>
  );
}
