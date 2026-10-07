# 🎯 Quiz Platform

실시간 참여형 퀴즈 플랫폼. 호스트가 대형 스크린으로 문제를 진행하고, 참여자는 자기 기기로 응답하며, 문제별·최종 리더보드와 상품 추첨을 제공합니다. 전부 **AWS 서버리스**로 구성되어 유휴 비용이 거의 없습니다.

## ✨ 주요 기능

- **마스터 콘솔**: 퀴즈 발행(만료일 지정), 참여/호스트 링크·PIN 발급, 발행 목록, 데이터 초기화/삭제
- **호스트(진행)**: 문제 세팅(객관식 단일/복수, 주관식 유사정답, 이미지, 배점, 썸네일), 진행 제어(시작/다음), 대형 스크린 표시
- **참여자**: 닉네임 입장 → 응답 → 실시간 리더보드/결과 (모바일·PC 반응형)
- **실시간**: WebSocket 기반 문제 push, 응답 현황, 리더보드/최종결과 브로드캐스트
- **비용 최적화**: 만료일 기반 DynamoDB TTL 자동 삭제
- **보안**: 마스터 API는 Lambda Authorizer + SSM SecureString, 마스터 콘솔은 별도 도메인 격리

## 🏗️ 아키텍처

```
                 ┌───────────── CloudFront (공개) ──────────────┐
브라우저 ──────── │  공개 콘솔(host/player)  ← S3 (web)            │
                 └──────────────────────────────────────────────┘
                 ┌───────────── CloudFront (마스터) ────────────┐
운영자 ───────── │  마스터 콘솔             ← S3 (master-web)     │
                 └──────────────────────────────────────────────┘
                              │ REST(HTTPS)        │ WSS(실시간)
                              ▼                    ▼
                   API Gateway HTTP API    API Gateway WebSocket API
                              │                    │
                              ▼                    ▼
                         Lambda(master/host/player/ws…) ──► DynamoDB(단일 테이블, TTL)
                                                        └─► S3(images, presigned)
```

- 프론트엔드: **React + Vite** (공개 콘솔 / 마스터 콘솔 2개 앱)
- 백엔드: **AWS SAM** (Lambda + API Gateway HTTP/WebSocket + DynamoDB + S3 + CloudFront)
- IaC/배포: **SAM** + **GitHub Actions**(OIDC, 변경 경로만 배포)

상세 설계는 [`docs/`](./docs/README.md) 참고.

## 📁 프로젝트 구조

```
quiz-platform/
├── backend/                 # SAM 앱 (Lambda + API GW + DynamoDB + S3 + CloudFront)
│   ├── template.yaml
│   ├── samconfig.toml.example   # 복사 → samconfig.toml (gitignore)
│   └── src/{handlers,lib}/
├── frontend/
│   ├── public/              # 공개 콘솔 (host/player)  — Vite + React
│   │   └── .env.example         # 복사 → .env (gitignore)
│   └── master/              # 마스터 콘솔              — Vite + React
│       └── .env.example
├── iam/                     # CI/CD IAM (수동 배포, 파이프라인 제외)
│   ├── template.yaml
│   └── samconfig.toml.example
├── .github/workflows/deploy.yml   # main push 자동 배포 (path filter)
└── docs/                    # 설계 문서 (요구사항~배포)
```

## 🧰 사전 요구사항

| 도구 | 버전 | 용도 |
|------|------|------|
| Node.js | 24 (LTS) | 프론트/백엔드 |
| npm | 11+ | 패키지 |
| AWS CLI | v2 | 자격증명/조회 |
| AWS SAM CLI | 최신 | 백엔드 빌드/배포 |
| (배포 시) GitHub CLI `gh` | 최신 | 저장소/시크릿 |
| AWS 자격증명 | admin 프로파일 | 최초 배포/IAM |

---

## 💻 로컬 개발

프론트는 **배포된 백엔드(API/WebSocket)에 붙어서** 로컬에서 UI만 개발하는 방식입니다. (백엔드가 한 번은 배포돼 있어야 API URL이 생깁니다 → 아래 "배포" 참고)

### 1. 백엔드 엔드포인트 확인
배포된 스택의 Outputs에서 API/WS URL을 조회합니다.
```bash
aws cloudformation describe-stacks --stack-name quiz-platform \
  --region ap-northeast-2 --profile <YOUR_PROFILE> \
  --query "Stacks[0].Outputs" --output table
# HttpApiUrl / WsApiUrl / PublicCdnDomain / MasterCdnDomain 확인
```

### 2. 공개 콘솔(host/player) 실행
```bash
cd frontend/public
cp .env.example .env            # VITE_API_URL, VITE_WS_URL 입력
npm install
npm run dev                     # http://localhost:5173
```
- 호스트 화면: `http://localhost:5173/host?code=<CODE>`
- 참여자 화면: `http://localhost:5173/play?code=<CODE>`

### 3. 마스터 콘솔 실행
```bash
cd frontend/master
cp .env.example .env            # VITE_API_URL 입력
npm install
npm run dev                     # http://localhost:5173 (다른 포트로 띄우려면 --port)
```
- 접속 후 **Master Key** 입력 (SSM SecureString 값). 확인:
  ```bash
  aws ssm get-parameter --name /quiz-platform/master-key --with-decryption \
    --region ap-northeast-2 --profile <YOUR_PROFILE> --query Parameter.Value --output text
  ```

### 4. 빌드/린트 (로컬 확인)
```bash
npm run build     # 프로덕션 빌드 (dist/ 생성)
npm run preview   # 빌드 결과 로컬 서빙
npm run lint      # oxlint
```

### 5. 백엔드 로직 테스트 (선택)
```bash
cd backend
npm install
node --check src/handlers/*.js src/lib/*.js   # 구문 검사
```

> 두 프론트 앱을 동시에 띄우려면 서로 다른 포트를 쓰세요: `npm run dev -- --port 5174`

---

## 🚀 배포

두 가지 방식이 있습니다. **최초 1회는 수동 셋업**이 필요하고, 이후에는 **main push로 자동 배포**됩니다.

### A. 최초 수동 셋업 (1회)

> 상세: [`docs/07-deployment.md`](./docs/07-deployment.md)

**1) 마스터 키 생성 (SSM SecureString)**
```bash
aws ssm put-parameter --name /quiz-platform/master-key \
  --type SecureString --value "<강력한 랜덤 키>" \
  --region ap-northeast-2 --profile <YOUR_PROFILE>
```

**2) 백엔드 최초 배포** (SAM 패키징 버킷 생성 겸용)
```bash
cd backend
cp samconfig.toml.example samconfig.toml   # profile 등 입력
sam build && sam deploy --guided            # 최초 1회
```

**3) 프론트 최초 배포** — 스택 Outputs의 버킷/배포 도메인으로 업로드
```bash
# 공개 콘솔
cd frontend/public && cp .env.example .env   # API/WS URL 입력
npm install && npm run build
aws s3 sync dist/ s3://<WebBucket>/ --delete --profile <YOUR_PROFILE>
aws cloudfront create-invalidation --distribution-id <공개 배포 ID> --paths "/*" --profile <YOUR_PROFILE>
# 마스터 콘솔도 동일 (MasterWebBucket / 마스터 배포 ID)
```

**4) CI/CD IAM 역할 배포** (GitHub Actions용, 수동 — 파이프라인 제외)
```bash
cd iam
cp samconfig.toml.example samconfig.toml   # GitHubOrg/Repo, CreateOidcProvider 등 입력
sam deploy
```
> 계정에 GitHub OIDC provider가 이미 있으면 `CreateOidcProvider=false`.
> ⚠️ **저장소는 public 권장** — OIDC `sub` 매칭 안정성(immutable subject claim 변수 회피).

**5) GitHub Secrets 등록** (IAM 스택 Outputs의 ARN)
| Secret | 값 |
|--------|-----|
| `AWS_OIDC_ROLE_ARN` | OIDCRoleArn |
| `AWS_BACKEND_DEPLOY_ROLE_ARN` | BackendDeployRoleArn |
| `AWS_CFN_SERVICE_ROLE_ARN` | CfnServiceRoleArn |
| `AWS_FRONTEND_DEPLOY_ROLE_ARN` | FrontendDeployRoleArn |

### B. 자동 배포 (GitHub Actions)

`main` 브랜치 push 시 **변경된 경로만** 자동 배포됩니다 (`dorny/paths-filter`).

| 변경 경로 | 실행 잡 |
|-----------|---------|
| `backend/**` | 백엔드(SAM) 배포 |
| `frontend/public/**` | 공개 콘솔 배포 |
| `frontend/master/**` | 마스터 콘솔 배포 |
| `iam/**` | (의도적으로 제외 — 수동 배포) |

- 자격증명: **GitHub OIDC**(장기 키 없음) → OIDC Role → 배포 Role(role chaining)
- 백엔드: `sam deploy --role-arn <CloudFormation Service Role>` (권한 격리)
- 수동 전체 배포: Actions 탭 → **Deploy** → `workflow_dispatch`에서 `deploy_all=true`

```bash
# CLI로 전체 배포 수동 트리거
gh workflow run Deploy -R <org>/<repo> -f deploy_all=true
```

---

## 🔐 보안 메모

- 모든 CI 자격증명은 **OIDC 단기 토큰** (장기 액세스 키 없음)
- OIDC 신뢰 정책은 `repo:<org>*/<repo>*:ref:refs/heads/main`으로 제한
- 백엔드 배포 Role은 CloudFormation 조작 + `PassRole`만, 실제 리소스 생성은 **CloudFormation Service Role**이 수행
- 마스터 API는 Lambda Authorizer(SSM SecureString) 인가, 마스터 콘솔은 별도 CloudFront 도메인 격리
- `.env`, `samconfig.toml`은 **gitignore** (각각 `.example`만 커밋)

## 🗑️ 리소스 정리

```bash
cd backend && sam delete --profile <YOUR_PROFILE>                 # 앱 스택
aws cloudformation delete-stack --stack-name quiz-platform-cicd \  # CI/CD IAM
  --region ap-northeast-2 --profile <YOUR_PROFILE>
aws ssm delete-parameter --name /quiz-platform/master-key \        # 마스터 키
  --region ap-northeast-2 --profile <YOUR_PROFILE>
```

## 📚 문서

| 문서 | 내용 |
|------|------|
| [docs/01-requirements.md](./docs/01-requirements.md) | 요구사항 (역할·기능) |
| [docs/02-architecture.md](./docs/02-architecture.md) | 아키텍처 설계 |
| [docs/03-data-model.md](./docs/03-data-model.md) | DynamoDB 데이터 모델 |
| [docs/04-api-spec.md](./docs/04-api-spec.md) | REST + WebSocket API 명세 |
| [docs/05-core-logic.md](./docs/05-core-logic.md) | 핵심 로직 (채점/리더보드/추첨) |
| [docs/06-project-structure.md](./docs/06-project-structure.md) | 프로젝트 구조 & SAM |
| [docs/07-deployment.md](./docs/07-deployment.md) | 배포(CI/CD) 상세 |
