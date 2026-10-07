# 서버리스 퀴즈 플랫폼 — 데이터 모델 설계서

## 1. 설계 방침

- **단일 테이블 설계** (DynamoDB single-table). 모든 접근 패턴이 `sessionId`(= 퀴즈 Code 기반) 중심으로 수렴한다.
- **TTL 속성** `expireAt`(Unix epoch seconds)로 세션 전체 데이터 자동 만료.
- **삭제 지연 대응**: 모든 조회에 `expireAt > now` 필터를 적용하여 아직 물리 삭제되지 않은 만료 항목을 숨긴다.
- 테이블명 예: `QuizPlatform`

## 2. 키 설계

| 속성 | 역할 |
|------|------|
| `PK` (Partition Key) | 엔티티 그룹핑 키 |
| `SK` (Sort Key) | 엔티티 식별/정렬 키 |
| `GSI1PK` / `GSI1SK` | 보조 접근 패턴 (연결·리더보드 등) |
| `expireAt` | TTL 속성 (Number, epoch seconds) |
| `entityType` | 엔티티 종류 식별 (`CODE`, `QUIZ`, `QUESTION`, `SESSION`, `PLAYER`, `ANSWER`, `CONN`) |

## 3. 엔티티 정의

### 3.1 Code (마스터 발급)
마스터가 발급한 Code/PIN/만료일.

| 필드 | 예시/설명 |
|------|-----------|
| PK | `CODE#<code>` |
| SK | `CODE#<code>` |
| entityType | `CODE` |
| code | 참여/세팅용 Code (예: `ABCD-1234`) |
| title | 퀴즈 제목(발행 시 입력, 목록 표시용) |
| hostPinHash | 관리자 PIN 해시 |
| status | `ISSUED` \| `CONFIGURED` \| `RUNNING` \| `ENDED` |
| scheduledDate | 사용 예정일 |
| expireAt | 만료 epoch (TTL) |
| createdAt | 발급 시각 |

> **링크 저장 안 함**: `participantUrl`(`/play?code=`)·`hostUrl`(`/host?code=`)은 공개 CloudFront 도메인 + `code`로 **응답 시 조립**한다(저장 중복 방지). 도메인은 Lambda 환경변수(`PUBLIC_CDN_DOMAIN`)로 주입. 호스트 PIN은 링크에 포함하지 않는다.

### 3.2 Quiz (퀴즈 메타)
| 필드 | 설명 |
|------|------|
| PK | `CODE#<code>` |
| SK | `QUIZ#meta` |
| entityType | `QUIZ` |
| title | 퀴즈 제목 |
| timeoutSec | 전체 공통 문제당 제한시간(초) |
| prizeWinners | 상품 당첨 총 인원수 n (1등 포함) |
| questionCount | 문제 수 |
| expireAt | TTL |

### 3.3 Question (문제)
정답은 서버 전용. 참여자에게 push할 때 정답 필드 제외.

| 필드 | 설명 |
|------|------|
| PK | `CODE#<code>` |
| SK | `QUESTION#<순번(zero-padded)>` 예: `QUESTION#001` |
| entityType | `QUESTION` |
| order | 정수 순번 |
| type | `SINGLE` \| `MULTI` \| `TEXT` |
| body | 문제 본문 |
| choices | 객관식 보기 배열 `[{id, label, color, text}]` (TEXT는 없음). label/color는 Host·Player 공유, Player엔 text 미전송 |
| correctChoiceIds | 정답 보기 id 배열 (SINGLE은 1개, MULTI는 N개) |
| correctText | 주관식 기준 정답 |
| acceptedAnswers | 주관식 허용 답안 목록 (유사정답) |
| similarityThreshold | 편집거리 기반 유사도 임계값 (0~1) |
| imageKey | S3(images) 객체 키 (최대 1개, 없으면 null) |
| points | 배점 (기본 1) |
| expireAt | TTL |

### 3.4 Session (진행 상태)
세션당 1개. 현재 진행 상태 머신.

| 필드 | 설명 |
|------|------|
| PK | `CODE#<code>` |
| SK | `SESSION#state` |
| entityType | `SESSION` |
| state | `WAITING` \| `RUNNING` \| `QUESTION_CLOSED` \| `ENDED` |
| currentOrder | 현재 문제 순번 |
| questionStartedAt | 현재 문제 서버 시작 시각 (epoch ms) — 풀이시간 기준 |
| playerCount | 현재 참여자 수 |
| expireAt | TTL |

### 3.5 Player (참여자)
| 필드 | 설명 |
|------|------|
| PK | `CODE#<code>` |
| SK | `PLAYER#<playerId>` |
| entityType | `PLAYER` |
| nickname | 닉네임 (세션 내 유니크 검증) |
| totalScore | 누적 점수 |
| totalTimeMs | 누적 풀이시간 (동점 tie-breaker) |
| joinedAt | 입장 시각 |
| prizeRank | 최종 순위 (집계 후) |
| isWinner | 상품 당첨 여부 (집계 후) |
| expireAt | TTL |

### 3.6 Answer (응답)
문제×참여자 단위 응답. 서버가 판정·시간 계산.

| 필드 | 설명 |
|------|------|
| PK | `CODE#<code>` |
| SK | `ANSWER#<order>#<playerId>` |
| entityType | `ANSWER` |
| order | 문제 순번 |
| playerId | 참여자 |
| submitted | 제출 값 (선택 id 배열 또는 텍스트) |
| isCorrect | 서버 판정 결과 |
| elapsedMs | 최종 채택 풀이시간 (ms) — 하이브리드(클라 1차 + 서버 상한) 결과. 표기 시 /1000, 소수 2자리 |
| clientElapsedMs | 클라이언트 보고 경과시간 (ms) — 1차 측정값 |
| serverElapsedMs | 서버 수신시각 기준 경과 (ms) — 상한 검증·감사용 |
| scoreAwarded | 획득 점수 |
| GSI1PK | `LB#<code>#<order>` (리더보드 조회용) |
| GSI1SK | `<isCorrect desc><elapsedMs asc>` 정렬 키 (아래 4.2) |
| expireAt | TTL |

### 3.7 Connection (WebSocket 연결)
| 필드 | 설명 |
|------|------|
| PK | `CONN#<connectionId>` |
| SK | `CONN#<connectionId>` |
| entityType | `CONN` |
| connectionId | API GW WebSocket 연결 id |
| code | 세션 Code |
| role | `host` \| `player` |
| playerId | player인 경우 |
| GSI1PK | `CONNINDEX#<code>` (세션 내 전체 연결 broadcast 조회용) |
| GSI1SK | `CONN#<connectionId>` |
| expireAt | TTL (짧게, 예: 세션 종료+버퍼) |

## 4. 글로벌 보조 인덱스 (GSI)

### GSI1
| 용도 | GSI1PK | GSI1SK |
|------|--------|--------|
| 세션 연결 목록 (broadcast 대상) | `CONNINDEX#<code>` | `CONN#<connectionId>` |
| 문제별 리더보드 | `LB#<code>#<order>` | 정렬 키 (정답자 우선 + 시간 오름차순) |

### 4.1 Broadcast 대상 조회
`wsMessageFn`이 특정 세션의 모든 연결에 push할 때:
```
Query GSI1 where GSI1PK = CONNINDEX#<code>
→ 각 connectionId 로 @connections POST
```

### 4.2 리더보드 정렬 키 설계
정렬 우선순위는 ① 정답자 우선 ② 풀이시간 짧은 순. DynamoDB는 SK 오름차순 Query가 자연스러우므로 다음과 같이 합성:

```
GSI1SK = <correctFlag><paddedElapsed>
  correctFlag : 정답 '0', 오답 '1'   (0이 먼저 → 정답자 우선)
  paddedElapsed : elapsedMs 를 고정폭 zero-pad (예: 0000003470)
예) 정답 3.47s → "0" + "0000003470" = "00000003470"
    오답        → "1" + "..."
```
`Query ... ScanIndexForward=true (오름차순)` 하면 정답자 → 빠른 순으로 정렬된다.

## 5. 접근 패턴 요약

| # | 패턴 | 연산 |
|---|------|------|
| 1 | Code 검증/조회 | GetItem PK=`CODE#<code>` SK=`CODE#<code>` |
| 2 | 퀴즈 전체(메타+문제) 로드 | Query PK=`CODE#<code>` SK begins_with (`QUIZ`/`QUESTION`) |
| 3 | 세션 상태 조회/갱신 | Get/Update PK=`CODE#<code>` SK=`SESSION#state` |
| 4 | 참여자 목록 | Query PK=`CODE#<code>` SK begins_with `PLAYER#` |
| 5 | 응답 저장 | PutItem SK=`ANSWER#<order>#<playerId>` |
| 6 | 문제별 리더보드 | Query GSI1 GSI1PK=`LB#<code>#<order>` ScanIndexForward=true |
| 7 | 최종 순위 | Query PLAYER# → totalScore desc, totalTimeMs asc (앱 정렬) |
| 8 | 세션 연결 broadcast | Query GSI1 GSI1PK=`CONNINDEX#<code>` |
| 9 | 연결 등록/해제 | Put/Delete PK=`CONN#<connectionId>` |
| 10 | 퀴즈 삭제(M-4) | Query PK=`CODE#<code>`(전 SK) + GSI1 `CONNINDEX#<code>` → BatchWriteItem Delete(25청크) + S3 deleteObjects |
| 11 | 데이터 초기화(M-5) | Query SK begins_with `PLAYER#`/`ANSWER#` + GSI1 `CONNINDEX#<code>` → BatchWriteItem Delete, SESSION#state 조건부 리셋(→WAITING). QUIZ/QUESTION/CODE 유지 |

> 모든 조회(1~8)에 `FilterExpression: expireAt > :now` 를 추가하여 TTL 삭제 지연분을 숨긴다. 삭제/초기화(10/11)는 마스터 전용이며 상세 로직은 `05-core-logic.md` §12 참조.

## 6. TTL 전략

- `expireAt`: 마스터가 지정한 만료 시각 기준으로 모든 엔티티에 동일 세팅 (세션 통째 만료).
- `CONN` 항목은 더 짧게(진행 종료 + 버퍼) 설정해 연결 레코드 누적 방지.
- DynamoDB Streams(REMOVE) → `ttlCleanupFn` → 해당 세션 S3 이미지(`imageKey`) 삭제.
- S3(images)는 추가 안전망으로 **Lifecycle 만료 규칙**도 병행.

## 7. 용량 모드

- **On-Demand (PAY_PER_REQUEST)** 권장. 수십 명·간헐적 세션 특성상 프로비저닝 불필요, 유휴 비용 0.
