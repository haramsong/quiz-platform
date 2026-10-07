# 서버리스 퀴즈 플랫폼 — 프로젝트 구조 & SAM 템플릿 개요

## 1. 모노레포 구조

```
quiz_platform/
├── docs/                      # 설계 문서 (본 문서 세트)
│   ├── 01-requirements.md
│   ├── 02-architecture.md
│   ├── 03-data-model.md
│   ├── 04-api-spec.md
│   ├── 05-core-logic.md
│   └── 06-project-structure.md
│
├── backend/                   # SAM 애플리케이션
│   ├── template.yaml          # SAM 템플릿 (아래 §3)
│   ├── samconfig.toml         # 배포 설정
│   ├── package.json
│   ├── src/
│   │   ├── handlers/
│   │   │   ├── masterAuthorizer.js # masterAuthorizerFn (X-Master-Key vs SSM SecureString)
│   │   │   ├── master.js      # masterFn (POST/GET /codes) — Authorizer 보호
│   │   │   ├── host.js        # hostFn (quiz/question CRUD, presign)
│   │   │   ├── player.js      # playerFn (join)
│   │   │   ├── wsConnect.js   # $connect
│   │   │   ├── wsDisconnect.js# $disconnect
│   │   │   ├── wsMessage.js   # start/next/answer/ping 라우팅
│   │   │   └── ttlCleanup.js  # DynamoDB Streams → S3 정리
│   │   └── lib/
│   │       ├── ddb.js         # DynamoDB 액세스 (단일 테이블 헬퍼)
│   │       ├── broadcast.js   # @connections postToConnection + 410 정리
│   │       ├── scoring.js     # 정답판정/풀이시간/리더보드/최종순위
│   │       ├── similarity.js  # 정규화 + Levenshtein 유사도
│   │       ├── lottery.js     # 상품 랜덤 추첨 (crypto 기반)
│   │       ├── ssm.js         # SSM SecureString 조회 + 콜드스타트 캐시
│   │       ├── auth.js        # 마스터키(timing-safe)/호스트PIN/세션토큰 검증
│   │       └── schema.js      # 입력 검증 스키마
│   └── tests/                 # 단위 테스트 (scoring/similarity/lottery/authorizer 등)
│
├── frontend/                  # 두 개의 React 앱 (공개 콘솔 / 마스터 콘솔)
│   ├── package.json
│   ├── vite.config.ts         # 앱별 빌드 타깃(public / master)
│   ├── index.html             # 공개 콘솔 엔트리 (host/player) → public CloudFront
│   ├── master.html            # 마스터 콘솔 엔트리 → master CloudFront (별도 도메인)
│   └── src/
│       ├── public-app.tsx     # 공개 앱 부트스트랩 (host/player 라우팅)
│       ├── master-app.tsx     # 마스터 앱 부트스트랩 (별도 번들)
│       ├── api/
│       │   ├── rest.ts        # REST 클라이언트
│       │   └── ws.ts          # WebSocket 클라이언트 (재연결/핑)
│       ├── pages/
│       │   ├── master/        # Code 발급·목록 (X-Master-Key 입력, master 앱에서만 import)
│       │   │   ├── MasterLoginView.tsx # X-Master-Key 입력(세션 보관)
│       │   │   ├── CodesPage.tsx       # 발행(링크/PIN 표시·복사)·목록·playerCount
│       │   │   └── ConfirmModal.tsx    # 삭제=Code 재입력, 초기화=confirm(+RUNNING 경고/force)
│       │   ├── host/          # 대형 스크린(공유 화면) + 세팅
│       │   │   ├── SetupPage.tsx       # 문제 편집(QuestionEditor), timeout/상품 설정
│       │   │   ├── PresentPage.tsx     # 대형 스크린: 문제 본문+보기 전체+타이머+응답현황+시작/다음
│       │   │   ├── HostLeaderboard.tsx # 문제별/최종 리더보드 대형 표시
│       │   │   └── PrintPage.tsx       # 정답 체크된 인쇄 뷰
│       │   └── player/        # 응답 컨트롤러 (모바일/PC 무관, 반응형)
│       │       ├── JoinPage.tsx        # 참여 Code + 닉네임 입력
│       │       ├── WaitingPage.tsx     # 시작 대기
│       │       ├── AnswerPage.tsx      # 라벨 버튼(SINGLE 탭즉시/MULTI 토글+제출)/TEXT 입력. 문제·보기 텍스트 없음
│       │       └── ResultView.tsx      # 내 순위/당첨 여부(요약)
│       ├── components/
│       │   ├── QuestionEditor.tsx
│       │   ├── Leaderboard.tsx
│       │   ├── LabelButton.tsx # 색상+문자 라벨 버튼(A빨강/B파랑/C노랑/D초록), 색맹 대응 문자 병기
│       │   ├── Timer.tsx       # timeout 카운트다운
│       │   └── PrintView.tsx   # @media print 레이아웃
│       └── styles/print.css    # 인쇄 전용 CSS
│
└── scripts/
    ├── deploy-backend.sh       # sam build && sam deploy
    ├── deploy-frontend.sh      # 공개 앱 build → s3 sync(web) → public CloudFront invalidation
    └── deploy-master-front.sh  # 마스터 앱 build → s3 sync(master-web) → master CloudFront invalidation
```

### 1.1 화면(역할) 분리 원칙
- **마스터 콘솔은 별도 앱·별도 CloudFront 도메인으로 격리**: 공개 콘솔(host/player)과 코드 번들·배포·도메인을 분리한다. 참여자가 접근할 경로 자체를 없앤다. 마스터 API 호출은 `X-Master-Key` 헤더 → **Lambda Authorizer** 로 인가(CORS는 보조).
- **공개 앱 내 role 분리**: `/host/...`(대형 스크린), `/play`(참여자 컨트롤러). 디바이스가 아니라 role로 UI를 가른다.
- **Host 대형 스크린(`PresentPage`)**: `question_pushed_host` 수신 → 문제 본문·보기 텍스트·이미지·타이머·응답현황·진행 버튼 표시.
- **Player 컨트롤러(`AnswerPage`)**: `question_pushed_player` 수신 → **보기 라벨 버튼만**(문제/보기 텍스트 없음). SINGLE 탭 즉시 제출, MULTI 토글+제출, TEXT 입력+제출. 화면 크기 반응형(모바일 우선).
- **라벨/색상 공유**: `LabelButton`의 색상 팔레트를 Host 보기 표시와 **동일 상수**로 관리해 참여자가 대형 스크린과 1:1 매칭 가능하게 한다.

## 2. 런타임/도구 선택

- Backend: Node.js 20.x (AWS SDK v3), SAM.
- Frontend: React + Vite + TypeScript.
- 테스트: 백엔드 Jest/Vitest, 프론트 Vitest + Testing Library.

## 3. SAM 템플릿 개요 (`backend/template.yaml`)

> 전체 YAML이 아니라 리소스 구성 개요. 실제 구현 단계에서 완성.

### 3.1 Globals / Parameters
```yaml
Transform: AWS::Serverless-2016-10-31
Globals:
  Function:
    Runtime: nodejs20.x
    Timeout: 10
    MemorySize: 256
    Environment:
      Variables:
        TABLE_NAME: !Ref QuizTable
        IMAGE_BUCKET: !Ref ImageBucket
        WS_ENDPOINT: !Sub "https://${WebSocketApi}.execute-api.${AWS::Region}.amazonaws.com/${WsStageName}"
Parameters:
  MasterKeyParamName:                 # SSM SecureString 파라미터 "이름"만 전달(값 아님)
    Type: String
    Default: /quiz-platform/master-key
  WsStageName: { Type: String, Default: prod }
  MasterOrigin:                       # 마스터 CloudFront 도메인(CORS 보조용)
    Type: String
```
> 마스터 비밀키 **값은 템플릿/파라미터로 전달하지 않는다.** SSM Parameter Store에 `SecureString`으로 사전 생성(아래)하고, 템플릿에는 파라미터 **이름**만 넘겨 Authorizer가 런타임에 복호화 조회한다. 템플릿·CloudFormation 콘솔·로그에 평문 노출 방지.

SSM 파라미터는 CLI로 1회 생성(IaC 커밋 금지):
```bash
aws ssm put-parameter \
  --name /quiz-platform/master-key \
  --type SecureString \
  --value "<강력한 랜덤 비밀키>"
```

### 3.1a 마스터 Authorizer (Lambda) + SSM 조회 권한
```yaml
MasterAuthorizerFunction:
  Type: AWS::Serverless::Function
  Properties:
    Handler: src/handlers/masterAuthorizer.handler
    Environment:
      Variables:
        MASTER_KEY_PARAM: !Ref MasterKeyParamName
    Policies:
      - Statement:                    # SecureString 복호화 조회(최소권한)
          - Effect: Allow
            Action: ["ssm:GetParameter"]
            Resource: !Sub "arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter${MasterKeyParamName}"
          - Effect: Allow
            Action: ["kms:Decrypt"]
            Resource: "*"             # 운영 시 SSM 기본키/전용 CMK ARN으로 제한
# HTTP API에 Lambda Authorizer 연결(요청 기반, X-Master-Key 헤더)
HttpApiMasterAuthorizer:
  # AWS::Serverless::HttpApi 의 Auth.Authorizers 로 정의, IdentitySource: $request.header.X-Master-Key
  # masterFn 라우트에만 Authorizer 적용 (host/player 라우트는 미적용)
```
> `masterAuthorizer.handler`는 `X-Master-Key`를 SSM 값과 **timing-safe 비교**(`crypto.timingSafeEqual`)하고, 값은 콜드스타트 1회 캐시. 일치 시 allow 정책, 불일치 시 deny.

### 3.2 DynamoDB (단일 테이블 + GSI1 + TTL + Streams)
```yaml
QuizTable:
  Type: AWS::DynamoDB::Table
  Properties:
    BillingMode: PAY_PER_REQUEST
    AttributeDefinitions:
      - { AttributeName: PK, AttributeType: S }
      - { AttributeName: SK, AttributeType: S }
      - { AttributeName: GSI1PK, AttributeType: S }
      - { AttributeName: GSI1SK, AttributeType: S }
    KeySchema:
      - { AttributeName: PK, KeyType: HASH }
      - { AttributeName: SK, KeyType: RANGE }
    GlobalSecondaryIndexes:
      - IndexName: GSI1
        KeySchema:
          - { AttributeName: GSI1PK, KeyType: HASH }
          - { AttributeName: GSI1SK, KeyType: RANGE }
        Projection: { ProjectionType: ALL }
    TimeToLiveSpecification: { AttributeName: expireAt, Enabled: true }
    StreamSpecification: { StreamViewType: OLD_IMAGE }   # ttlCleanup용
```

### 3.3 S3 버킷
```yaml
WebBucket:        # 공개 SPA 호스팅 (비공개, public CloudFront OAC 전용)
  Type: AWS::S3::Bucket
  Properties:
    PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true }

MasterWebBucket:  # 마스터 콘솔 SPA 호스팅 (비공개, master CloudFront OAC 전용)
  Type: AWS::S3::Bucket
  Properties:
    PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true }

ImageBucket:      # 퀴즈 이미지 (presigned 접근 + lifecycle 정리)
  Type: AWS::S3::Bucket
  Properties:
    LifecycleConfiguration:
      Rules:
        - { Id: ExpireImages, Status: Enabled, ExpirationInDays: 90 }
    CorsConfiguration:
      CorsRules:
        - { AllowedMethods: [PUT, GET], AllowedOrigins: ["*"], AllowedHeaders: ["*"] }
```

### 3.4 CloudFront (공개 / 마스터 2개 배포, 각각 OAC 보호)
```yaml
# 공개 콘솔 (host/player)
CloudFrontDistribution:
  Type: AWS::CloudFront::Distribution
  Properties:
    DistributionConfig:
      DefaultRootObject: index.html
      Origins:
        - { Id: web, DomainName: !GetAtt WebBucket.RegionalDomainName, OriginAccessControlId: !Ref OAC, S3OriginConfig: {} }
      DefaultCacheBehavior:
        TargetOriginId: web
        ViewerProtocolPolicy: redirect-to-https
      CustomErrorResponses:            # SPA 라우팅 → index.html
        - { ErrorCode: 403, ResponseCode: 200, ResponsePagePath: /index.html }
        - { ErrorCode: 404, ResponseCode: 200, ResponsePagePath: /index.html }

# 마스터 콘솔 (별도 배포·별도 도메인 → 공개 콘솔과 격리)
MasterCloudFrontDistribution:
  Type: AWS::CloudFront::Distribution
  Properties:
    DistributionConfig:
      DefaultRootObject: master.html
      Origins:
        - { Id: master-web, DomainName: !GetAtt MasterWebBucket.RegionalDomainName, OriginAccessControlId: !Ref MasterOAC, S3OriginConfig: {} }
      DefaultCacheBehavior:
        TargetOriginId: master-web
        ViewerProtocolPolicy: redirect-to-https
      CustomErrorResponses:
        - { ErrorCode: 403, ResponseCode: 200, ResponsePagePath: /master.html }
        - { ErrorCode: 404, ResponseCode: 200, ResponsePagePath: /master.html }
```
> 두 배포는 각각 OAC(`OAC`, `MasterOAC`)로 해당 S3 버킷만 접근. 마스터 도메인은 공유/링크하지 않고 운영자만 사용. (강화하려면 WAF로 접근 제한 가능하나 현 규모에선 Authorizer로 충분)

### 3.5 HTTP API (REST) — 마스터 라우트 Authorizer 보호
```yaml
HttpApi:
  Type: AWS::Serverless::HttpApi
  Properties:
    CorsConfiguration:                # CORS는 보조 수단(보안 경계 아님)
      AllowOrigins: [!Ref MasterOrigin, "<public CloudFront 도메인>"]  # 운영 시 정확히 제한
      AllowMethods: [GET, POST, PUT, DELETE, OPTIONS]
      AllowHeaders: [content-type, x-master-key, x-host-auth]
    Auth:
      Authorizers:
        MasterAuthorizer:             # 요청 기반 Lambda Authorizer
          FunctionArn: !GetAtt MasterAuthorizerFunction.Arn
          Identity:
            Headers: [X-Master-Key]   # 이 헤더가 인가 입력
          EnableSimpleResponses: true
      # DefaultAuthorizer 지정하지 않음 → host/player 라우트는 공개(앱 레벨 검증)

# 마스터 함수: 라우트별로 MasterAuthorizer 적용
MasterFunction:
  Type: AWS::Serverless::Function
  Properties:
    Handler: src/handlers/master.handler
    Environment:
      Variables:
        PUBLIC_CDN_DOMAIN: !GetAtt CloudFrontDistribution.DomainName   # 참여자/호스트 링크 조립용
    Policies:
      - { DynamoDBCrudPolicy: { TableName: !Ref QuizTable } }
      - { S3CrudPolicy: { BucketName: !Ref ImageBucket } }             # 삭제 시 이미지 정리
    Events:
      PostCodes:                                                        # 발행 (+링크 반환)
        Type: HttpApi
        Properties: { ApiId: !Ref HttpApi, Path: /codes, Method: POST, Auth: { Authorizer: MasterAuthorizer } }
      GetCodes:                                                         # 발행 목록
        Type: HttpApi
        Properties: { ApiId: !Ref HttpApi, Path: /codes, Method: GET,  Auth: { Authorizer: MasterAuthorizer } }
      DeleteCode:                                                       # 퀴즈 삭제(전체)
        Type: HttpApi
        Properties: { ApiId: !Ref HttpApi, Path: /codes/{code}, Method: DELETE, Auth: { Authorizer: MasterAuthorizer } }
      ResetCode:                                                        # 데이터 초기화
        Type: HttpApi
        Properties: { ApiId: !Ref HttpApi, Path: /codes/{code}/reset, Method: POST, Auth: { Authorizer: MasterAuthorizer } }

HostFunction:   # /quizzes, /quizzes/{code}/questions..., images:presign  (Authorizer 미적용, X-Host-Auth 핸들러 검증)
PlayerFunction: # /sessions/join  (Authorizer 미적용)
```
> 마스터 라우트만 `Auth.Authorizer: MasterAuthorizer`를 지정한다. host/player 라우트에는 적용하지 않아 참여자 플로우에는 영향이 없다. Authorizer가 deny하면 `masterFn`은 **실행조차 되지 않는다**.

### 3.6 WebSocket API
```yaml
WebSocketApi:
  Type: AWS::ApiGatewayV2::Api
  Properties:
    ProtocolType: WEBSOCKET
    RouteSelectionExpression: "$request.body.action"

# 라우트: $connect, $disconnect, start, next, answer, ping
# $connect → WsConnectFunction, $disconnect → WsDisconnectFunction,
# 나머지 → WsMessageFunction (action으로 내부 분기)

WsMessageFunction:
  Type: AWS::Serverless::Function
  Properties:
    Handler: src/handlers/wsMessage.handler
    Policies:
      - { DynamoDBCrudPolicy: { TableName: !Ref QuizTable } }
      - Statement:                 # @connections 로 push
          - { Effect: Allow, Action: ["execute-api:ManageConnections"], Resource: !Sub "arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${WebSocketApi}/*" }
```

### 3.7 TTL Cleanup (Streams 트리거)
```yaml
TtlCleanupFunction:
  Type: AWS::Serverless::Function
  Properties:
    Handler: src/handlers/ttlCleanup.handler
    Policies:
      - { S3CrudPolicy: { BucketName: !Ref ImageBucket } }
      - { DynamoDBStreamReadPolicy: { TableName: !Ref QuizTable, StreamName: !GetAtt QuizTable.StreamArn } }
    Events:
      Stream:
        Type: DynamoDB
        Properties:
          Stream: !GetAtt QuizTable.StreamArn
          StartingPosition: LATEST
          FilterCriteria:            # REMOVE(서비스 삭제=TTL) 이벤트만
            Filters: [ { Pattern: '{"eventName":["REMOVE"]}' } ]
```

### 3.8 Outputs
```yaml
Outputs:
  HttpApiUrl:      { Value: !Sub "https://${HttpApi}.execute-api.${AWS::Region}.amazonaws.com" }
  WsApiUrl:        { Value: !Sub "wss://${WebSocketApi}.execute-api.${AWS::Region}.amazonaws.com/${WsStageName}" }
  CdnDomain:       { Value: !GetAtt CloudFrontDistribution.DomainName }        # 공개 콘솔
  MasterCdnDomain: { Value: !GetAtt MasterCloudFrontDistribution.DomainName }  # 마스터 콘솔(별도)
  WebBucket:       { Value: !Ref WebBucket }
  MasterWebBucket: { Value: !Ref MasterWebBucket }
  ImageBucket:     { Value: !Ref ImageBucket }
```

## 4. 배포 흐름

```
0) 사전: 마스터 비밀키를 SSM SecureString으로 1회 생성 (IaC에 값 미포함)
   aws ssm put-parameter --name /quiz-platform/master-key --type SecureString --value "<랜덤키>"

1) 백엔드:  cd backend && sam build && sam deploy --guided
            (파라미터로 MasterKeyParamName, MasterOrigin 전달)
            → HttpApiUrl / WsApiUrl / CdnDomain / MasterCdnDomain 획득
2) 공개 프론트: frontend/.env 에 API URL 주입 → npm run build (public 타깃)
            → aws s3 sync dist/ s3://<WebBucket>
            → aws cloudfront create-invalidation --paths "/*"  (공개 배포)
3) 마스터 프론트: master 타깃 build → aws s3 sync dist-master/ s3://<MasterWebBucket>
            → aws cloudfront create-invalidation (마스터 배포)
            → 마스터 운영자는 MasterCdnDomain 접속, 콘솔에서 X-Master-Key 입력
```

## 5. 콜드스타트 완화 (성능 최적화)

수십 명 규모에서 WebSocket Lambda는 세션 진행 중 대부분 웜 상태로 유지되지만, 세션 초반 첫 호출은 콜드스타트가 발생할 수 있다. 아래 두 가지를 **필수 적용**한다. (상품/과금 부담이 있는 Provisioned Concurrency는 현 규모에선 도입하지 않음)

### 5.1 풀이시간 측정 하이브리드 (공정성)
- 콜드스타트가 `answer` 처리 Lambda에 생겨도 **풀이시간이 왜곡되지 않도록**, 클라이언트가 보고한 `clientElapsedMs`를 1차 채택하고 서버 수신 시각으로 상한만 검증한다.
- 상세 로직은 `05-core-logic.md` §1, 메시지 필드는 `04-api-spec.md`의 `answer`/`question_pushed` 참조.
- 효과: 콜드스타트로 인한 "불리한 참여자" 문제 제거(비용 0).

### 5.2 Lambda 초기화 코드 최적화
콜드스타트 지연의 가장 큰 몫은 핸들러 바깥 초기화 코드다. 아래를 코딩 규칙으로 강제한다.

| 규칙 | 설명 |
|------|------|
| 클라이언트 핸들러 바깥 생성 | `DynamoDBClient`, `ApiGatewayManagementApiClient` 등은 모듈 스코프에서 1회 생성 → 웜 재사용 |
| AWS SDK v3 모듈 단위 import | `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb` 등 필요한 것만. 전체 SDK import 금지 |
| 번들링/트리셰이킹 | SAM `esbuild` 사용(`Metadata: BuildMethod: esbuild`)으로 패키지 축소 → 로드 시간 단축 |
| 지연 초기화 | 특정 경로에서만 쓰는 무거운 모듈은 핸들러 내부에서 조건부 import |
| 메모리 적정화 | 256MB 기준. CPU는 메모리에 비례하므로 콜드/실행이 느리면 384~512MB로 상향 테스트 |
| keep 종속성 최소화 | 불필요한 대형 라이브러리 배제(예: 거대 유틸 라이브러리 대신 소형 함수) |

SAM 함수 정의 예(esbuild + 외부화):
```yaml
WsMessageFunction:
  Type: AWS::Serverless::Function
  Metadata:
    BuildMethod: esbuild
    BuildProperties:
      Minify: true
      Target: es2022
      Sourcemap: false
      External: ["@aws-sdk/*"]   # 런타임 제공 SDK는 번들 제외로 패키지 축소
  Properties:
    Handler: src/handlers/wsMessage.handler
    MemorySize: 256
```

코드 패턴 예(핸들러 바깥 초기화):
```js
// lib/clients.js — 모듈 스코프에서 1회 생성, 웜 재사용
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { ApiGatewayManagementApiClient } from "@aws-sdk/client-apigatewaymanagementapi";

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
export const wsClient = new ApiGatewayManagementApiClient({ endpoint: process.env.WS_ENDPOINT });

// handlers/wsMessage.js
import { ddb, wsClient } from "../lib/clients.js";
export const handler = async (event) => { /* 핸들러에서는 재생성하지 않음 */ };
```

> 선택적 애드온: 지연에 극도로 민감한 이벤트가 생기면, 세션 진행 중에만 `WsMessageFunction` alias에 Provisioned Concurrency(PC=1~2)를 Application Auto Scaling 스케줄로 켜고 종료 후 0으로 내리는 방식을 고려. 현 규모에선 불필요.

## 6. 보안·운영 체크리스트

- [ ] 마스터 비밀키는 SSM Parameter Store `SecureString`(KMS)로 관리. **값은 템플릿/파라미터/로그에 미노출**(이름만 전달).
- [ ] 마스터 라우트에 Lambda Authorizer(`masterAuthorizerFn`) 적용 확인. host/player 라우트 미적용 확인.
- [ ] Authorizer의 키 비교는 timing-safe. SSM `GetParameter`는 최소권한(해당 파라미터 ARN) + KMS Decrypt 범위 제한.
- [ ] 마스터 콘솔은 별도 CloudFront 배포·도메인으로 격리. 공개 콘솔에 마스터 UI 미포함(번들 분리) 확인.
- [ ] CORS는 보조 수단임을 인지. 마스터 Origin을 마스터 CloudFront 도메인으로 제한하되 인가는 Authorizer가 담당.
- [ ] HostPIN은 해시 저장(bcrypt/argon2), 평문 미저장.
- [ ] Lambda 최소권한 IAM (테이블/버킷 스코프 한정).
- [ ] CloudWatch Logs 보존기간·알람 설정.
- [ ] WebSocket 유휴 연결 정리(TTL + 410 핸들링) 동작 확인.
- [ ] TTL 삭제 지연 대비 조회 필터(expireAt > now) 전 함수 적용 확인.
- [ ] 콜드스타트 완화: 클라이언트 초기화 핸들러 바깥 배치 + esbuild 번들링 적용 확인.
- [ ] 풀이시간 하이브리드(clientElapsedMs 상한검증) 동작·감사 필드 저장 확인.

## 7. 다음 단계 (구현 로드맵)

1. SAM 스캐폴딩 + DynamoDB/HTTP API/WS API 뼈대 배포.
2. master/host/player REST 핸들러 + 데이터 모델 헬퍼 구현·테스트.
3. WebSocket 연결/진행/broadcast 구현, scoring/similarity/lottery 단위 테스트.
4. React 3개 역할 화면 + WS 클라이언트 + 인쇄 뷰.
5. 통합 테스트(실세션 시뮬레이션) → 비용/부하 점검.
