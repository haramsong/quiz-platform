# 서버리스 퀴즈 플랫폼 — 핵심 로직 설계서

요구사항의 "디테일한 기능"들을 서버 로직 수준으로 구체화한다.

## 1. 풀이시간 측정 (소수점 2자리 초) — 하이브리드 방식

### 배경: 왜 하이브리드인가
순수 "서버 수신 시각 - 서버 push 시각" 방식은 **Lambda 콜드스타트/네트워크 지연이 풀이시간을 왜곡**할 수 있다. 문제 push 직후 첫 `answer`를 처리하는 Lambda가 콜드로 뜨면 그 참여자의 풀이시간만 수백 ms 길게 찍혀 공정성이 깨진다.

따라서 **클라이언트가 측정한 경과시간을 1차 값으로 채택하되, 서버 수신 시각으로 상한을 검증**하는 하이브리드를 사용한다. 측정의 정확성은 클라이언트가, 조작 방지(치팅 상한)는 서버가 담당한다.

### 원칙
- **1차 측정값**: 클라이언트가 `question_pushed`를 받은 로컬 시각부터 "제출" 버튼까지의 경과시간 `clientElapsedMs`.
- **서버 권위 상한**: 서버는 `questionStartedAt`(push 시각, epoch ms)과 수신 시각으로 `serverElapsedMs`를 계산하고, 이를 **상한(이보다 클 수 없음)** 으로만 사용한다. 클라이언트 값이 서버 상한을 넘으면 치팅/오차로 보고 서버 값으로 캡.
- 서버 시각(`questionStartedAt`)은 여전히 서버 권위다. 클라이언트는 "절대 시각"이 아니라 "경과시간"만 보고하므로 시계 동기화가 불필요하다.

### 흐름
```
host "start"/"next"
  → wsMessageFn: now = Date.now()
  → session.questionStartedAt = now ; session.state = RUNNING
  → broadcast question_pushed(serverStartAt = now)

player 클라이언트
  → question_pushed 수신 시각 t0 기록 (performance.now() 권장: 단조 증가)
  → "제출" 시점 t1 → clientElapsedMs = round(t1 - t0)
  → answer 메시지에 clientElapsedMs 포함 전송

player "answer" 수신 시 (wsMessageFn/scoring)
  → recvAt = Date.now()
  → serverElapsedMs = recvAt - session.questionStartedAt     // 상한 기준
  → elapsedMs = clientElapsedMs (유효하면) else serverElapsedMs
      · 유효성: 0 <= clientElapsedMs <= serverElapsedMs + GRACE(예: 250ms)
      · 위반 시(음수/과대) → elapsedMs = serverElapsedMs 로 캡
  → elapsedMs = max(0, min(elapsedMs, timeoutSec*1000))      // 최종 클램프
  → 저장 (Answer.elapsedMs, Answer.serverElapsedMs 함께 기록해 감사 가능)

표기: elapsedSec = round(elapsedMs / 1000, 2)   // 예: 3.47
```

### 왜 이게 콜드스타트에 안전한가
- `clientElapsedMs`는 Lambda가 언제 뜨든 무관하게 "참여자가 실제로 답까지 걸린 시간"을 담는다.
- 콜드스타트로 `serverElapsedMs`가 커져도, 그건 **상한을 느슨하게** 만들 뿐이라 정상 클라이언트 값을 그대로 통과시킨다. 즉 콜드스타트는 공정성에 영향을 주지 않는다.
- 치팅(비정상적으로 작은 clientElapsedMs 조작)은 하한 0과 중복응답 차단으로, 과대 조작은 timeout 클램프로 억제된다. (완벽한 치팅 방지가 목표가 아니라, 콜드스타트로 인한 "불리한 왜곡"을 없애는 것이 1차 목표)

### 경계 처리
- `clientElapsedMs` 누락/비정상: `serverElapsedMs`로 폴백(기존 서버 측정과 동일).
- timeout 초과 응답: 서버가 거부(`QUESTION_CLOSED`) 또는 오답+최대시간 처리(정책 택1, 기본: 거부).
- 단조 시계: 클라이언트는 `performance.now()`(월클럭 변경·NTP 보정 영향 없음)로 경과를 재는 것을 권장.
- 재응답: 첫 응답만 유효, 이후 `DUPLICATE_ANSWER`.

## 2. 정답 판정

### 2.1 객관식 SINGLE
```
isCorrect = (submitted == 정답 1개)
```

### 2.2 객관식 MULTI
```
isCorrect = (set(submitted) == set(correctChoiceIds))   // 완전 일치
```
> 부분 점수는 기본 미지원(정답/오답 이진). 필요 시 확장 포인트로 명시.

### 2.3 주관식 TEXT — 유사 정답 인정
단계적 판정:
```
norm(s) = s.trim().toLowerCase()
          .replace(공백 연속 → 1칸)
          .제거(구두점)        // 선택적
          .정규화(NFKC)        // 전각/반각, 한글 자모 결합

1) 완전 일치: norm(submitted) in { norm(correctText) } ∪ { norm(a) for a in acceptedAnswers }  → 정답
2) 유사도:   maxSim = max over 기준답안 of similarity(norm(submitted), norm(기준))
             similarity = 1 - levenshtein(a,b) / max(len(a), len(b))
             if maxSim >= similarityThreshold → 정답
3) else 오답
```
- `similarityThreshold` 기본 0.8 (문제별 조정 가능).
- `acceptedAnswers`로 동의어/표기변형(예: "람다", "aws lambda")을 명시적으로 흡수.
- Levenshtein은 짧은 문자열이라 비용 무시 가능.

## 3. 문제 종료 판정

문제는 다음 중 **먼저 도달한 조건**에서 종료:
```
A) 전원 응답: answeredCount == playerCount
B) timeout 경과: now - questionStartedAt >= timeoutSec*1000
```
구현:
- A는 `answer` 수신마다 카운트 확인 → 충족 시 즉시 종료 처리.
- B는 타이머 필요. 서버리스에서 "정확한 timeout 트리거"는 두 가지 방식:
  - **(권장, 단순) 클라이언트 보조 + 서버 검증**: host 화면이 timeout 도달 시 자동으로 `next` 유사 신호를 보내거나, 각 player가 timeout 시 빈 응답 전송 → 서버가 종료 판정. 서버는 항상 `questionStartedAt` 기준으로 재검증.
  - **(정밀) Step Functions / EventBridge Scheduler**: 문제 push 시 timeout 후 1회 실행 예약 → 종료 Lambda 호출. 수십 명 규모엔 과설계일 수 있어 선택 사항.
- 종료 시 `state = QUESTION_CLOSED`, 리더보드 집계·broadcast.

> 기본 설계: A(전원 응답) + host 수동 진행을 1차로 하고, timeout은 클라이언트 타이머 + 서버 재검증으로 처리. 정밀 서버 타이머가 필요하면 EventBridge Scheduler를 애드온.

## 4. 문제별 리더보드 집계

```
문제 종료 시 (scoring):
  entries = Query GSI1 (GSI1PK = LB#<code>#<order>, ScanIndexForward=true)
            // 정렬키 = correctFlag + zero-pad(elapsedMs) → 정답자 우선, 빠른 순
  rank 부여 (1부터)
  각 정답자: Player.totalScore += points ; Player.totalTimeMs += elapsedMs
  broadcast leaderboard_question(entries, correctChoiceIds, hasNext)
```
표기: `elapsedSec = round(elapsedMs/1000, 2)`.

## 5. 최종 순위 집계

```
모든 문제 종료 후 (host next at last):
  players = Query PLAYER#  (filter expireAt > now)
  정렬:
    1차: totalScore 내림차순
    2차: totalTimeMs 오름차순   (동점 tie-breaker: 더 빨리 푼 사람 우선)
  rank 1..N 부여, Player.prizeRank 저장
```

## 6. 상품 랜덤 추첨

```
입력: ranking(정렬 완료), prizeWinners = n
절차:
  1) winners = [ranking[0]]              // 1등 확정, winReason=FIRST
  2) if n > 1:
       pool = ranking[1:]                // 2등 이하 전원
       k = min(n-1, len(pool))
       picked = secureRandomSample(pool, k)   // 비복원 랜덤 추출
       for p in picked: winReason=RANDOM
       winners += picked
  3) winners 표시: Player.isWinner=true, winReason 기록
  4) broadcast final_result(ranking + isWinner + winReason)
```
- `secureRandomSample`: `crypto.randomInt` 기반 Fisher–Yates 부분 셔플로 편향 없는 추출.
- 서버에서만 수행 → 공정성·재현불가. 추첨 결과는 1회 확정 후 저장(재요청해도 불변).
- 엣지: `n >= 참여자 수`면 전원 당첨. `n <= 1`이면 1등만.

## 7. 실시간 진행 상태 머신 (서버 권위)

```
        host:start
WAITING ───────────► RUNNING(order=k)
                        │
          전원응답 or timeout(서버검증)
                        ▼
                 QUESTION_CLOSED(order=k)
                   │                 │
       host:next (k<last)      host:next (k==last)
                   │                 │
                   ▼                 ▼
            RUNNING(order=k+1)      ENDED
```
- 모든 전이는 **서버가 state를 조건부 업데이트(ConditionExpression)** 하여 중복/경합 방지.
  예: `UPDATE SESSION SET state=RUNNING ... WHERE state=WAITING`
- host 액션은 CONN.role=host 검증 후에만 수락(아니면 `NOT_HOST`).

## 8. Broadcast 메커니즘 (역할별 분리 전송)

```
conns = Query GSI1 (GSI1PK = CONNINDEX#<code>)   // 세션 전체 연결 (role 포함)
function sendTo(filterRole, payload):
    for conn in conns where (filterRole == null or conn.role == filterRole):
        try: apigwManagementApi.postToConnection(conn.connectionId, payload)
        except GoneException(410): delete CONN(conn.connectionId)  // 끊긴 연결 정리
```

문제 전환 시 **역할별로 다른 payload**를 보낸다 (대형 스크린 vs 응답 컨트롤러):
```
on question push (order k):
    hostPayload   = question_pushed_host  { body, choices[{id,label,color,text}], imageUrl, ... }
    playerPayload = question_pushed_player{ choices[{id,label,color}], qType, timeoutSec, serverStartAt }  // 본문·텍스트·정답 제외
    sendTo("host",   hostPayload)
    sendTo("player", playerPayload)
```
- Player payload는 **보기 라벨/색상/개수만** 포함(문제 본문·보기 텍스트·imageUrl·정답 제외) → 참여자 기기엔 응답 컨트롤러만 구성 가능.
- 공통 이벤트(leaderboard_question, final_result)는 `sendTo(null, ...)`로 전원 전송.
- host 전용 이벤트(player_joined, question_progress)는 `sendTo("host", ...)`.
- 128KB 제한 준수: 이미지·대용량은 URL 참조만.

## 9. 응답 제출 동작 (Player 컨트롤러)

Player는 문제 본문/보기 텍스트 없이 **보기 라벨 버튼**(또는 TEXT 입력창)만으로 응답한다.

| 문제 유형 | 컨트롤러 동작 | 전송 시점 | submitted |
|-----------|---------------|-----------|-----------|
| SINGLE | 라벨 1개 **탭** | **탭 즉시 전송** (별도 제출 버튼 없음) | `["a"]` |
| MULTI | 라벨 여러 개 토글 선택 | **"제출" 버튼** 클릭 시 | `["a","c"]` |
| TEXT | 입력창에 텍스트 | **"제출" 버튼** 클릭 시 | `"람다"` |

- SINGLE 탭 즉시 제출: 선택과 동시에 `clientElapsedMs` 확정 → 반응속도 측정에 유리. 탭 후에는 버튼 잠금(재응답 차단, `DUPLICATE_ANSWER`).
- MULTI/TEXT: 제출 버튼 클릭 순간 `clientElapsedMs` 확정. 제출 전까지 선택 변경 가능.
- 제출 후 컨트롤러는 "제출 완료" 상태로 잠기고, 문제 종료까지 대기. 정답 여부는 리더보드에서 공개.
- timeout 도달 시 미제출이면 비활성화(또는 빈 제출), 서버는 `questionStartedAt` 기준 재검증.

## 10. 동시성·경합 처리

| 상황 | 대응 |
|------|------|
| 두 참여자 동시 응답 | 각 Answer는 서로 다른 SK(ANSWER#order#playerId) → 충돌 없음 |
| 재응답 | PutItem `attribute_not_exists(SK)` 조건 → 중복 거부 |
| host 중복 start/next | SESSION ConditionExpression(state 검증)으로 1회만 적용 |
| 전원응답 vs timeout 동시 | state QUESTION_CLOSED 전이가 조건부라 한 번만 집계 |
| 끊긴 연결 push | 410 GoneException 시 CONN 정리 |

## 11. 인쇄 로직 (브라우저)

- 서버 PDF 생성 없음. Host가 `GET /quizzes/{code}`(정답 포함)로 전체 데이터를 받아 전용 인쇄 뷰 렌더.
- CSS `@media print`로 정답 체크 표시(정답 보기 강조/체크박스 채움, 주관식 정답·허용답안 표기), 이미지 포함.
- `window.print()`로 인쇄 또는 "PDF로 저장".
- 페이지 분할(`break-inside: avoid`)로 문제 단위 깨짐 방지.

## 12. 마스터 삭제 / 초기화 로직

마스터 전용 파괴적 작업. 모두 `masterFn`에서 처리하며 Lambda Authorizer 통과 후에만 실행된다. 두 작업 공통으로 **대상 엔티티를 `Query PK=CODE#<code>`로 모은 뒤 `BatchWriteItem`(25개 단위 청크)로 삭제**한다.

### 12.1 공통 안전장치
```
confirm 검증: body.confirm === pathCode ? 진행 : 400 CONFIRM_MISMATCH
```
- Code 재입력(confirm)이 일치해야 실행. UI는 이 confirm을 모달로 받는다.

### 12.2 퀴즈 삭제 (DELETE /codes/{code})
전체 데이터 + S3 이미지 제거.
```
1) confirm 검증 (불일치 → 400)
2) items = Query PK=CODE#<code>  (CODE/QUIZ/QUESTION/SESSION/PLAYER/ANSWER 전부)
   + CONN 항목: Query GSI1 GSI1PK=CONNINDEX#<code>
3) imageKeys = items where entityType=QUESTION and imageKey != null
4) (선택) 활성 CONN에 종료 통지 후, @connections delete
5) BatchWriteItem Delete (25개 청크, 지수 백오프로 UnprocessedItems 재시도)
6) S3 deleteObjects(imageKeys)  (버킷 접두어 CODE/<code>/ 일괄 삭제도 가능)
7) 응답 { deleted: true }
```
- 멱등성: 이미 없는 Code면 삭제 결과 0건이어도 `200`(idempotent). 또는 `404 CODE_NOT_FOUND` 중 택1(기본: idempotent 200).
- 삭제는 되돌릴 수 없음.

### 12.3 데이터 초기화 (POST /codes/{code}/reset)
참여 데이터만 리셋, 문제·설정 유지.
```
1) confirm 검증 (불일치 → 400)
2) session = Get SESSION#state
   if session.state == RUNNING and !force → 409 SESSION_RUNNING
3) 삭제 대상 수집 (유지 대상 제외):
     PLAYER#*      (Query SK begins_with PLAYER#)
     ANSWER#*      (Query SK begins_with ANSWER#)
     CONN          (Query GSI1 CONNINDEX#<code>)
   유지: CODE, QUIZ#meta, QUESTION#*
4) force면 활성 CONN에 reset 통지 후 @connections delete
5) BatchWriteItem Delete (위 수집분, 25개 청크 + 재시도)
6) SESSION 리셋 (조건부 업데이트):
     state=WAITING, currentOrder=0, questionStartedAt=null, playerCount=0
7) 응답 { reset: true, state: "WAITING", removed: { players, answers } }
```
- QUIZ(timeout/상품설정)·QUESTION(문제/정답/이미지)·CODE(PIN/만료)는 **건드리지 않는다** → 호스트가 동일 문제로 즉시 재시작 가능.
- 관리자 테스트 플레이 후 깨끗이 리셋하는 용도로도 동일 동작.

### 12.4 경합 / 멱등성
| 상황 | 대응 |
|------|------|
| 삭제·초기화 동시 호출 | SESSION 조건부 업데이트 + BatchWrite로 중복 삭제는 무해(이미 없는 키 삭제는 성공 처리) |
| 초기화 중 신규 입장 | 초기화는 SESSION→WAITING 후 playerCount=0. 입장은 WAITING에서 허용되므로 리셋 직후 새 참가자만 집계 |
| RUNNING 중 force 초기화 | 활성 CONN 종료 통지 → 삭제. 호스트/참여자 재입장 필요 |
| BatchWrite UnprocessedItems | 지수 백오프 재시도로 전량 처리 보장 |
