# 서버리스 퀴즈 플랫폼 — 아키텍처 설계서

## 1. 아키텍처 개요

전체는 **정적 프론트(React) + 서버리스 백엔드(Lambda)** 로 구성되며, 통신은 두 경로로 나뉜다.

- **REST (HTTP API)**: 세팅/조회/입장 등 요청-응답형 작업.
- **WebSocket API**: 퀴즈 진행 중 실시간 양방향(시작, 문제 push, 응답 제출, 리더보드 broadcast).

실시간 흐름이 핵심이므로 WebSocket을 1급 시민으로 둔다. REST 폴링 대비 지연·비용 면에서 유리하다.

## 2. 컴포넌트 다이어그램

```
                         ┌──────────────────────────────┐
                         │           Browser             │
                         │   React SPA (Host / Player)   │
                         └───────┬───────────────┬───────┘
                                 │ HTTPS         │ WSS
                 static assets   │               │ realtime
                                 ▼               ▼
                     ┌───────────────────┐   ┌──────────────────────┐
     ┌───────────────│    CloudFront     │   │  API Gateway          │
     │   (OAC)       │   (CDN + TLS)     │   │  ┌─────────────────┐  │
     │               └─────────┬─────────┘   │  │  HTTP API (REST)│  │
     ▼                         │             │  └────────┬────────┘  │
┌──────────┐                   │             │  ┌────────▼────────┐  │
│ S3        │◄──────────────────┘             │  │ WebSocket API   │  │
│ (web)     │   origin                        │  │ $connect        │  │
└──────────┘                                  │  │ $disconnect     │  │
                                              │  │ $default/routes │  │
┌──────────┐    presigned PUT/GET            │  └────────┬────────┘  │
│ S3        │◄────────────────────────────    └───────────┼──────────┘
│ (images)  │                                             │
└────┬─────┘                                              ▼
     │ lifecycle                              ┌────────────────────────┐
     │                                        │   Lambda functions     │
     │                                        │  - masterFn (code)     │
     │                                        │  - hostFn (quiz CRUD)  │
     │                                        │  - playerFn (join)     │
     │                                        │  - wsConnectFn         │
     │                                        │  - wsMessageFn         │
     │                                        │  - wsDisconnectFn      │
     │                                        │  - scoringFn           │
     │                                        │  - ttlCleanupFn        │
     │                                        └───────────┬────────────┘
     │                                                    │
     │                                                    ▼
     │                                        ┌────────────────────────┐
     │          DynamoDB Streams              │       DynamoDB         │
     └────────────────────────────────────── │  (single-table, TTL)   │
                                              └────────────────────────┘
```

### 2.1 컴포넌트 역할

| 컴포넌트 | 역할 |
|----------|------|
| CloudFront (public) | 참여자/호스트 React 자산 전송, TLS, S3 오리진 보호(OAC) |
| CloudFront (master) | **마스터 콘솔 전용 별도 배포·도메인**. 공개 콘솔과 격리 |
| S3 (web) | 공개 SPA 호스팅 (비공개, public CloudFront OAC로만 접근) |
| S3 (master-web) | 마스터 콘솔 SPA 호스팅 (비공개, master CloudFront OAC로만 접근) |
| S3 (images) | 퀴즈 이미지 저장. presigned URL로 업/다운로드. Lifecycle로 정리 |
| API Gateway HTTP API | REST 엔드포인트 (세팅/조회/입장 + 마스터 라우트) |
| API Gateway WebSocket API | 실시간 진행. `$connect`/`$disconnect`/커스텀 라우트 |
| Lambda | 비즈니스 로직 (아래 함수 분리) |
| DynamoDB | 단일 테이블 설계 + TTL 자동 만료 + Streams |
| SSM Parameter Store | 마스터 비밀키 `SecureString`(KMS 암호화) 보관 |

## 3. Lambda 함수 분리

| 함수 | 트리거 | 책임 |
|------|--------|------|
| `masterAuthorizerFn` | HTTP API Lambda Authorizer | 마스터 라우트 인가. `X-Master-Key`를 SSM SecureString과 비교, allow/deny |
| `masterFn` | HTTP API (Authorizer 보호) | 퀴즈 Code/PIN 발급, 만료일 설정, 발급 목록 |
| `hostFn` | HTTP API | 퀴즈/문제 CRUD, 이미지 presigned URL 발급, 설정 저장 |
| `playerFn` | HTTP API | 참여 Code 검증, 세션/닉네임 등록 |
| `wsConnectFn` | WS `$connect` | 연결 등록 (connectionId ↔ 세션/역할/닉네임 매핑) |
| `wsDisconnectFn` | WS `$disconnect` | 연결 정리 |
| `wsMessageFn` | WS routes | 시작/다음/응답제출 라우팅, broadcast |
| `scoringFn` | 내부 호출 / WS | 정답 판정, 풀이시간 계산, 리더보드/최종순위/추첨 |
| `ttlCleanupFn` | DynamoDB Streams | TTL 삭제 이벤트 수신 시 S3 이미지 등 부수 리소스 정리 |

> 수십 명 규모에서는 함수를 과도하게 쪼갤 필요는 없으나, WebSocket 라우트와 REST는 반드시 분리한다. 초기엔 `scoringFn`을 `wsMessageFn` 내부 모듈로 두고 트래픽 증가 시 분리해도 된다. **마스터 라우트는 `masterAuthorizerFn`으로 인가**하며 `masterFn`은 인가 통과 후에만 실행된다.

## 4. 데이터 흐름

### 4.1 퀴즈 세팅 (Host, REST)
```
Host SPA
  → POST /quizzes (Code+PIN 검증)         [hostFn]
  → POST /quizzes/{id}/questions          [hostFn]  → DynamoDB put
  → POST /quizzes/{id}/images:presign     [hostFn]  → presigned PUT URL 반환
  → PUT (presigned) 이미지 직접 업로드      → S3(images)
```

### 4.2 입장 & 대기 (Player)
```
Player SPA
  → POST /sessions/join {code, nickname}  [playerFn] → 세션 토큰 반환
  → WSS connect?token=...                 [wsConnectFn] → connection 등록, 역할=player
  Host 화면에는 참여자 목록이 실시간 갱신 (player_joined broadcast)
```

### 4.3 진행 (실시간, WebSocket)
```
Host "시작"  ──ws──► wsMessageFn
                      ├─ 세션 상태 = RUNNING, 현재 문제 인덱스=0
                      ├─ 서버 기준 question_started_at 기록
                      └─ broadcast question_pushed(문제 본문, timeout) → 전체 player

Player 응답 ──ws──► wsMessageFn
                      └─ scoring: 서버수신시각 - question_started_at = 풀이시간
                         정답판정 + 임시 저장 (답 노출 금지)

문제 종료(전원응답 or timeout)
                      └─ broadcast leaderboard_question(정답자우선, 2자리초)

Host "다음"  ──ws──► wsMessageFn
                      ├─ 다음 문제 push  (반복)
                      └─ 마지막이면 → 최종 집계
```

### 4.4 종료 & 추첨
```
scoringFn
  ├─ 누적 점수 내림차순 (동점 시 누적 풀이시간 짧은 순)
  ├─ 1등 확정 당첨
  ├─ 2등~ 중 랜덤 (n-1)명 추첨
  └─ broadcast final_result(순위 + 당첨자) → 전체
```

### 4.5 만료 정리 (비용 최적화)
```
DynamoDB TTL(만료 epoch) 경과
  → DynamoDB 자동 삭제 (수일 내, 쓰기비용 0)
  → Streams REMOVE 이벤트 (service deletion)
  → ttlCleanupFn → S3(images) 관련 객체 삭제
조회 시: 모든 Query/GetItem 결과에 filter(현재시각 < expireAt) 적용 → 삭제 지연분 숨김
```

## 5. 실시간 통신 설계 (WebSocket)

- 메시지 최대 **128KB** (문제/보기 텍스트는 충분, 이미지는 S3 URL로 전달하여 본문에 바이너리 금지).
- 백엔드 → 클라이언트 push는 **callback URL**(`@connections` POST) 사용.
- 라우트: `$connect`, `$disconnect`, `start`, `next`, `answer`, `ping`.
- 과금: 연결 분(minutes) + 메시지(32KB 단위). 수십 명 × 짧은 세션이라 비용 미미.
- 연결 매핑은 DynamoDB에 저장(connectionId → sessionId, role, nickname). `$disconnect` 시 제거.

## 6. 보안 설계

| 항목 | 방식 |
|------|------|
| S3(web) 보호 | 퍼블릭 차단 + CloudFront OAC |
| **마스터 인가** | **Lambda Authorizer**가 `X-Master-Key` 헤더를 **SSM Parameter Store(SecureString)** 의 비밀키와 비교 검증. 마스터 라우트에만 적용 |
| 관리자 권한 | 퀴즈 Code + PIN. WS 연결 시 토큰에 role=host 포함, 서버 검증 |
| 참여자 | 참여 Code 검증 후 단기 세션 토큰 발급, WS 핸드셰이크에서 검증 |
| 정답 비노출 | 정답/판정 로직은 서버 전용. 문제 push 시 정답 필드 제외 |
| 풀이시간 신뢰 | 서버 수신 시각 기준 계산 (클라이언트 타임스탬프 미신뢰) |
| 입력 검증 | 모든 Lambda 입력 스키마 검증, DynamoDB는 파라미터화 접근 |
| CORS | 보조 수단(브라우저 UX·CSRF 완화)일 뿐 **보안 경계가 아님**. 실제 인가는 Authorizer가 담당 |

### 6.1 마스터 보안 모델 (핵심)

마스터 관리자는 Code/PIN을 발급하는 최상위 권한이므로 다음과 같이 보호한다.

```
Master Console (별도 CloudFront 배포, 별도 도메인)
   │  X-Master-Key: <비밀키>   (운영자만 보유)
   ▼
API Gateway HTTP API  ──(마스터 라우트: /codes 등)──► Lambda Authorizer
                                                        │ SSM GetParameter(WithDecryption)
                                                        │ 입력 키 == SecureString?
                                                        ├─ 일치 → allow → masterFn 실행
                                                        └─ 불일치 → 403 Deny (masterFn 미실행)
```

- **왜 CORS만으로 안 되는가**: CORS는 브라우저에서만 강제되며 `curl`/스크립트 직접 호출을 막지 못한다. 요청은 서버에 도달해 로직이 실행된 뒤 응답만 가려질 뿐이다. 따라서 마스터 라우트는 반드시 **Authorizer(서버 측 인가)** 로 보호한다.
- **키 저장**: SSM Parameter Store `SecureString`(KMS 암호화). Lambda는 실행 시 `ssm:GetParameter`(WithDecryption)로 조회, 콜드스타트 1회 캐시.
- **마스터 콘솔 격리**: 참여자/호스트용 CloudFront와 **별도 배포·별도 도메인**으로 분리. 공개 콘솔에 마스터 UI를 노출하지 않아 URL 노출/오접근 경로를 제거한다.
- **같은 HTTP API에 공존**: 비용·운영 단순성을 위해 마스터 라우트는 공용 HTTP API에 둔다. 격리는 "네트워크 분리"가 아니라 **라우트별 Authorizer + 콘솔 분리 + 최소권한 IAM**으로 달성한다.
- **CORS 보조**: 마스터 라우트의 `Access-Control-Allow-Origin`은 마스터 CloudFront 도메인으로 제한하되, 이는 보조일 뿐 인가는 Authorizer가 책임진다.

## 7. 리전/배포

- 단일 리전 (예: `ap-northeast-2`) 로 충분. CloudFront가 전역 엣지 캐싱 담당.
- SAM 단일 스택으로 HTTP API, WebSocket API, Lambda, DynamoDB, S3 버킷, **CloudFront 2개(공개 콘솔 / 마스터 콘솔)**, **마스터 Authorizer Lambda**, **SSM SecureString 파라미터**를 정의.
- 프론트 빌드 → 각 S3(web/master-web) 동기화 → 해당 CloudFront invalidation 은 배포 스크립트로 처리.

## 8. 설계 근거 / 트레이드오프

- **WebSocket 채택**: "관리자 버튼 → 전원 화면 전환", "실시간 리더보드"는 polling으로도 가능하나, 수십 개 연결에 주기적 폴링은 Lambda 호출·지연을 늘린다. WebSocket push가 UX·비용 모두 유리.
- **단일 테이블 DynamoDB**: 세션 단위로 접근 패턴이 명확(모두 sessionId 기준)하여 단일 테이블이 적합. 상세는 데이터 모델 문서 참조.
- **브라우저 인쇄**: 서버 PDF 렌더링(Headless Chromium 등)은 Lambda 패키징·콜드스타트 부담. 요구가 "정답 체크된 문제 인쇄"이므로 CSS 인쇄 레이아웃 + `window.print()`로 충분.
- **TTL 자동 삭제**: 별도 정리 배치 불필요, 쓰기비용 0. 단 삭제 지연이 있어 조회 필터가 필수.
