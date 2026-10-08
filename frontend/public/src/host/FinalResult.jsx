// Final result view (host): top 5 + lower-ranked winners (nickname only) + fun stats.
export default function FinalResult({ data }) {
  const ranking = data.ranking || [];
  const top5 = ranking.slice(0, 5);
  // winners outside the top 5 → show nickname only (no rank), e.g. random prize winners
  const lowerWinners = ranking.slice(5).filter((r) => r.isWinner);

  return (
    <div className="final">
      <div className="lb-list host-lb">
        {top5.map((r, i) => (
          <div key={i} className={`lb-row big ${r.isWinner ? 'winner-row' : ''}`}>
            <span className="rank">#{r.rank}</span>
            <span className="name">{r.nickname}</span>
            <span className="pts">{r.totalScore}점 ({r.totalTimeSec}s)</span>
            {r.isWinner && <span className="badge-win">{r.winReason === 'FIRST' ? '🥇' : '🎁'}</span>}
          </div>
        ))}
      </div>

      {lowerWinners.length > 0 && (
        <div className="lower-winners">
          <div className="lower-winners-label">🎁 추가 당첨</div>
          <div className="lower-winners-names">
            {lowerWinners.map((r, i) => <span key={i} className="winner-chip">{r.nickname}</span>)}
          </div>
        </div>
      )}

      {(data.funFastest || data.funReaction) && (
        <div className="fun-stats">
          {data.funFastest && (
            <div className="fun-card">
              <div className="fun-label">🏃 가장 빠른 참가자</div>
              <div className="fun-name">{data.funFastest.nickname}</div>
              <div className="fun-sub">평균 {data.funFastest.avgSec}s</div>
            </div>
          )}
          {data.funReaction && (
            <div className="fun-card">
              <div className="fun-label">⚡ 최고 반응속도</div>
              <div className="fun-name">{data.funReaction.nickname}</div>
              <div className="fun-sub">Q{data.funReaction.order} · {data.funReaction.elapsedSec}s</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
