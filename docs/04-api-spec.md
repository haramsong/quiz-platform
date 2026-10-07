# 서버리스 퀴즈 플랫폼 — API 명세서

두 종류의 API로 구성된다.
- **REST (HTTP API)**: 발급/세팅/조회/입장 등 요청-응답.
- **WebSocket API**: 실시간 진행(시작/문제/응답/리더보드/결과).

공통 규칙:
- Content-Type: `application/json`
- 인증: 아래 토큰/헤더 규칙 참조.
- 오류 응답: `{ "error": { "code": "STRING", "message": "STRING" } }`

---

## 1. REST API

Base URL 예: `https://{api-id}.execute-api.{region}.amazonaws.com`

### 1.1 인증 규칙
| 역할 | 방식 |
|------|------|
| Master | 헤더 `X-Master-Key: <마스터 비밀키>` → **Lambda Authorizer**가 SSM Parameter Store `SecureString`과 비교. 마스터 라우트에만 적용 |
| Host | 헤더 `X-Host-Auth: <code>:<pin>` → 서버가 PIN 해시 검증 후 처리 |
| Player | `POST /sessions/join` 성공 시 발급된 세션 토큰을 이후 WS 연결에 사용 |

#### 마스터 인가 상세 (Lambda Authorizer)
- 마스터 라우트(`/codes` 등)는 API Gateway **Lambda Authorizer(`masterAuthorizerFn`)** 로 보호한다.
- Authorizer가 요청 헤더 `X-Master-Key`를 SSM `GetParameter(WithDecryption)`로 가져온 비밀키와 상수 시간 비교(timing-safe) → 일치 시 `allow`, 불일치 시 `403 Deny`(핸들러 미실행).
- `X-Master-Key` 누락 → `401 UNAUTHORIZED`, 불일치 → `403 FORBIDDEN`.
- **CORS는 보조 수단**이며 보안 경계가 아니다. CORS만으로는 `curl`/스크립트 직접 호출을 막지 못하므로 실제 인가는 Authorizer가 담당한다. (근거: `02-architecture.md` §6.1)
- 마스터 콘솔은 참여자/호스트와 **별도 CloudFront 도메인**에서 서비스되며, 마스터 라우트의 `Access-Control-Allow-Origin`은 해당 마스터 도메인으로 제한한다(보조).

### 1.2 Master 엔드포인트 (`masterFn`, Lambda Authorizer 보호)
모든 마스터 요청에 `X-Master-Key` 필요. Authorizer 통과 후에만 `masterFn` 실행.

#### POST /codes — 퀴즈 발행 (+ 링크 생성)
요청:
```json
{ "scheduledDate": "2026-11-01", "expireAt": 1793000000, "title": "사내 퀴즈" }
```
응답 `201`:
```json
{
  "code": "ABCD-1234",
  "hostPin": "8471",
  "status": "ISSUED",
  "expireAt": 1793000000,
  "participantUrl": "https://<public-cdn>/play?code=ABCD-1234",
  "hostUrl": "https://<public-cdn>/host?code=ABCD-1234"
}
```
> - `hostPin`은 발행 시 **1회만 평문 반환**, 저장은 해시. 마스터가 `hostUrl` + `hostPin`을 호스트에게 전달.
> - `participantUrl`은 참여자 공유용(Code만 포함). `hostUrl`에는 **PIN을 포함하지 않는다**(호스트가 접속 후 PIN 입력).
> - 링크의 base 도메인은 **공개 CloudFront 도메인**(참여자/호스트용). 마스터 콘솔 도메인과 무관.

#### GET /codes — 발행 목록
응답 `200`:
```json
{
  "items": [
    {
      "code": "ABCD-1234", "status": "RUNNING",
      "scheduledDate": "2026-11-01", "expireAt": 1793000000,
      "participantUrl": "https://<public-cdn>/play?code=ABCD-1234",
      "hostUrl": "https://<public-cdn>/host?code=ABCD-1234",
      "playerCount": 12
    }
  ]
}
```
> `hostPin`은 목록에서 반환하지 않는다(해시만 보관). 분실 시 재발급(PIN 리셋)로 처리.

#### DELETE /codes/{code} — 퀴즈 삭제 (전체 데이터 제거)
요청 바디(오삭제 방지):
```json
{ "confirm": "ABCD-1234" }
```
- `confirm` 값이 경로의 `{code}`와 **일치해야** 실행. 불일치 → `400 CONFIRM_MISMATCH`.
- 해당 Code의 전 엔티티(CODE/QUIZ/QUESTION/SESSION/PLAYER/ANSWER/CONN) + S3 이미지 삭제.
- 진행 중(`RUNNING`) 세션 연결은 삭제 전 종료 통지(선택) 후 정리.
응답 `200`: `{ "code": "ABCD-1234", "deleted": true }`

#### POST /codes/{code}/reset — 데이터 초기화 (참여 데이터만 리셋)
요청:
```json
{ "confirm": "ABCD-1234", "force": false }
```
- PLAYER/ANSWER/CONN 삭제 + SESSION→`WAITING`(currentOrder=0 등 리셋). **QUIZ/QUESTION 유지**.
- `confirm` 불일치 → `400 CONFIRM_MISMATCH`.
- 세션이 `RUNNING`이면 기본 거부 `409 SESSION_RUNNING`. `force: true`면 진행 중이라도 강제 초기화(연결 끊고 리셋).
응답 `200`:
```json
{ "code": "ABCD-1234", "reset": true, "state": "WAITING", "removed": { "players": 12, "answers": 48 } }
```

### 1.3 Host 엔드포인트 (`hostFn`)
모든 요청에 `X-Host-Auth` 필요.

#### POST /quizzes — 퀴즈 메타 생성/갱신
```json
{ "code": "ABCD-1234", "title": "사내 퀴즈", "timeoutSec": 20, "prizeWinners": 3 }
```
응답 `200`: `{ "code": "ABCD-1234", "status": "CONFIGURED" }`

#### POST /quizzes/{code}/questions — 문제 추가
```json
{
  "order": 1,
  "type": "MULTI",
  "body": "다음 중 AWS 서버리스 서비스를 모두 고르세요.",
  "choices": [
    { "id": "a", "text": "Lambda" }, { "id": "b", "text": "EC2" },
    { "id": "c", "text": "DynamoDB" }, { "id": "d", "text": "RDS" }
  ],
  "correctChoiceIds": ["a", "c"],
  "points": 1,
  "imageKey": null
}
```
주관식 예:
```json
{
  "order": 2, "type": "TEXT",
  "body": "AWS의 서버리스 함수 서비스 이름은?",
  "correctText": "Lambda",
  "acceptedAnswers": ["람다", "aws lambda", "lambda"],
  "similarityThreshold": 0.8,
  "points": 1
}
```
응답 `201`: `{ "order": 2 }`

#### PUT /quizzes/{code}/questions/{order} — 문제 수정
#### DELETE /quizzes/{code}/questions/{order} — 문제 삭제

#### GET /quizzes/{code} — 퀴즈 전체 로드 (인쇄/편집용, 정답 포함)
> Host 전용. 정답 포함 반환. 인쇄 화면(H-6)에서 정답 체크 상태로 렌더.
```json
{
  "title": "사내 퀴즈", "timeoutSec": 20, "prizeWinners": 3,
  "questions": [ { "order": 1, "type": "MULTI", "body": "...", "choices": [...], "correctChoiceIds": ["a","c"] } ]
}
```

#### POST /quizzes/{code}/images:presign — 이미지 업로드 URL
```json
{ "order": 1, "contentType": "image/png" }
```
응답 `200`:
```json
{ "uploadUrl": "https://s3...X-Amz-Signature=...", "imageKey": "ABCD-1234/q1.png", "expiresInSec": 300 }
```
> 클라이언트가 `uploadUrl`로 직접 PUT. 이후 문제의 `imageKey`로 연결. GET도 동일하게 presigned로 발급.

### 1.4 Player 엔드포인트 (`playerFn`)

#### POST /sessions/join — 입장
```json
{ "code": "ABCD-1234", "nickname": "하람" }
```
응답 `200`:
```json
{ "sessionToken": "eyJ...", "playerId": "p_01H...", "state": "WAITING", "nickname": "하람" }
```
오류: 닉네임 중복 `409 NICKNAME_TAKEN`, 만료/무효 Code `404 CODE_NOT_FOUND`, 이미 시작됨 `409 ALREADY_STARTED`.

> `sessionToken`은 WebSocket 핸드셰이크(`$connect`) 쿼리스트링으로 전달하여 서버가 검증.

---

## 2. WebSocket API

연결 URL: `wss://{ws-api-id}.execute-api.{region}.amazonaws.com/{stage}?token=<sessionToken|hostAuth>`

- 클라이언트 → 서버 메시지는 `{"action":"<route>", ...}` 형식 (route 기반 라우팅).
- 서버 → 클라이언트 push는 `{"type":"<event>", ...}` 형식.
- 메시지 최대 128KB. 이미지는 presigned URL 문자열만 전달.

### 2.1 라우트 (클라이언트 → 서버)

| action | 역할 | 설명 |
|--------|------|------|
| `$connect` | all | 연결. token 검증 후 CONN 레코드 등록. |
| `$disconnect` | all | 연결 해제. CONN 삭제, playerCount 갱신. |
| `start` | host | 퀴즈 시작. 첫 문제 push. |
| `next` | host | 다음 문제 또는 최종 결과로 진행. |
| `answer` | player | 현재 문제 응답 제출. |
| `ping` | all | keep-alive. |

#### start (host → server)
```json
{ "action": "start" }
```
#### next (host → server)
```json
{ "action": "next" }
```
#### answer (player → server)
```json
{ "action": "answer", "order": 1, "submitted": ["a", "c"], "clientElapsedMs": 3470 }
```
`submitted` 형식 (Player 컨트롤러에서 선택한 **보기 id** 기준):
- SINGLE: 라벨 **탭 즉시 전송** → `"submitted": ["a"]` (단일 요소 배열).
- MULTI: 여러 라벨 토글 후 **"제출" 버튼** → `"submitted": ["a", "c"]`.
- TEXT: 입력창 값 → `"submitted": "람다"`.
- `clientElapsedMs`: 클라이언트가 `question_pushed_player` 수신 시점부터 제출까지 측정한 경과시간(ms). `performance.now()`(단조 시계) 기반 권장.
- 서버는 수신 시각으로 `serverElapsedMs = now - session.questionStartedAt`를 계산해 **상한 검증**에 사용한다. 최종 채택: `0 <= clientElapsedMs <= serverElapsedMs + GRACE`이면 `clientElapsedMs`, 아니면 `serverElapsedMs`로 캡 후 timeout 클램프.
- 이 하이브리드로 **Lambda 콜드스타트/서버 지연이 풀이시간을 왜곡하지 않는다.** `clientElapsedMs`가 없거나 비정상이면 서버 값으로 폴백. (상세: `05-core-logic.md` §1)

### 2.2 이벤트 (서버 → 클라이언트)

#### player_joined (→ host)
```json
{ "type": "player_joined", "playerId": "p_01H...", "nickname": "하람", "playerCount": 12 }
```

#### question_pushed — 역할별 분리 전송
문제 전환 시 서버는 **역할에 따라 다른 payload**를 보낸다. Host(대형 스크린)에는 문제·보기 텍스트 전체를, Player(응답 컨트롤러)에는 **보기 라벨/색상/개수만**(본문·보기 텍스트·정답 제외) 보낸다.

**(a) question_pushed_host (→ host 연결만) — 정답 미포함, 본문·보기 포함**
```json
{
  "type": "question_pushed_host",
  "order": 1, "total": 5, "qType": "MULTI",
  "body": "다음 중 AWS 서버리스 서비스를 모두 고르세요.",
  "choices": [
    { "id": "a", "label": "A", "color": "red",    "text": "Lambda" },
    { "id": "b", "label": "B", "color": "blue",   "text": "EC2" },
    { "id": "c", "label": "C", "color": "yellow", "text": "DynamoDB" },
    { "id": "d", "label": "D", "color": "green",  "text": "RDS" }
  ],
  "imageUrl": "https://s3.../get?sig=...",
  "timeoutSec": 20, "serverStartAt": 1762000000123
}
```

**(b) question_pushed_player (→ player 연결만) — 본문·보기 텍스트·정답 모두 제외**
```json
{
  "type": "question_pushed_player",
  "order": 1, "total": 5, "qType": "MULTI",
  "choices": [
    { "id": "a", "label": "A", "color": "red" },
    { "id": "b", "label": "B", "color": "blue" },
    { "id": "c", "label": "C", "color": "yellow" },
    { "id": "d", "label": "D", "color": "green" }
  ],
  "timeoutSec": 20, "serverStartAt": 1762000000123
}
```
- Player payload에는 `body`/`choices[].text`/`imageUrl`/정답이 **포함되지 않는다**. 참여자는 대형 스크린을 보고 라벨/색상으로 응답.
- `qType`: `SINGLE`은 라벨 탭 즉시 제출, `MULTI`는 다중 선택 후 제출, `TEXT`는 입력창(이 경우 `choices` 없음).
- 두 메시지의 `order`/`serverStartAt`/`timeoutSec`은 동일. 라벨/색상/순서는 Host·Player가 일치.
> Player 클라이언트는 이 메시지 **수신 즉시 `performance.now()`로 측정 시작점**을 기록하고, 제출 시 `clientElapsedMs`로 `answer`에 포함한다. `serverStartAt`은 서버 상한 검증용 참고값.

#### answer_ack (→ player)
```json
{ "type": "answer_ack", "order": 1, "received": true }
```
> 정답 여부는 즉시 노출하지 않음(문제 종료 후 리더보드에서 공개).

#### question_progress (→ host)
```json
{ "type": "question_progress", "order": 1, "answered": 8, "total": 12 }
```

#### leaderboard_question (→ all) — 문제별 리더보드
```json
{
  "type": "leaderboard_question",
  "order": 1,
  "correctChoiceIds": ["a", "c"],
  "entries": [
    { "rank": 1, "nickname": "하람", "isCorrect": true, "elapsedSec": 3.47, "score": 1 },
    { "rank": 2, "nickname": "지민", "isCorrect": true, "elapsedSec": 5.12, "score": 1 }
  ],
  "hasNext": true
}
```
> 정렬: 정답자 우선 → 풀이시간 오름차순. `elapsedSec`는 소수 2자리.

#### final_result (→ all) — 최종 순위 + 추첨
```json
{
  "type": "final_result",
  "ranking": [
    { "rank": 1, "nickname": "하람", "totalScore": 5, "totalTimeSec": 18.42, "isWinner": true, "winReason": "FIRST" },
    { "rank": 2, "nickname": "지민", "totalScore": 4, "totalTimeSec": 21.10, "isWinner": true, "winReason": "RANDOM" },
    { "rank": 3, "nickname": "현우", "totalScore": 4, "totalTimeSec": 25.03, "isWinner": false }
  ],
  "prizeWinners": 3
}
```
> `winReason`: `FIRST`(1등 확정) \| `RANDOM`(추첨). 추첨은 서버에서 수행.

#### error (→ sender)
```json
{ "type": "error", "code": "NOT_HOST", "message": "start는 host만 가능합니다." }
```

### 2.3 상태 전이와 이벤트 매핑

| 세션 state | 트리거 | 결과 state | 발행 이벤트 |
|------------|--------|-----------|-------------|
| WAITING | host `start` | RUNNING | question_pushed_host + question_pushed_player (order=1) |
| RUNNING | 전원 응답 or timeout | QUESTION_CLOSED | leaderboard_question |
| QUESTION_CLOSED | host `next` (남은 문제) | RUNNING | question_pushed_host + question_pushed_player (order+1) |
| QUESTION_CLOSED | host `next` (마지막) | ENDED | final_result |

---

## 3. 오류 코드 요약

| code | 상황 |
|------|------|
| UNAUTHORIZED | 마스터 라우트에 `X-Master-Key` 누락 (401) |
| FORBIDDEN | `X-Master-Key` 불일치로 Authorizer 거부 (403) |
| CODE_NOT_FOUND | 존재하지 않거나 만료된 Code |
| NICKNAME_TAKEN | 세션 내 닉네임 중복 |
| ALREADY_STARTED | 이미 시작된 세션에 입장 시도 |
| NOT_HOST | host 전용 액션을 비-host가 호출 |
| INVALID_PIN | 관리자 PIN 불일치 |
| QUESTION_CLOSED | 종료된 문제에 응답 제출 |
| DUPLICATE_ANSWER | 동일 문제 재응답 |
| CONFIRM_MISMATCH | 삭제/초기화 시 `confirm` 값이 Code와 불일치 (400) |
| SESSION_RUNNING | 진행 중 세션 초기화 시도(`force:false`) (409) |
