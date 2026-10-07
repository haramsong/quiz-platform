# 배포 준비 — GitHub Actions CI/CD

GitHub `main` 브랜치에 push하면 자동으로 백엔드(SAM)와 프론트(S3+CloudFront)가 배포되도록 구성한다. 자격증명은 **장기 액세스 키 없이 GitHub OIDC**로 처리한다.

## 1. 배포 아키텍처

```
GitHub Actions (main push, 변경 경로만)
   │  OIDC 토큰 (id-token: write)
   ▼
[GitHub OIDC Role]  ── assume-only, 자체 배포권한 없음
   │  sts:AssumeRole (이 둘만 허용)
   ├─► [Backend Deploy Role]   (얇음) CloudFormation 조작 + PassRole + 패키징 S3
   │        │  sam deploy --role-arn
   │        ▼
   │     [CloudFormation Service Role]  ← 실제 앱 리소스 생성/수정/삭제
   │        (lambda/apigw/dynamodb/cloudfront/s3/iam …)
   └─► [Frontend Deploy Role]  S3 sync + CloudFront invalidation
```

- **GitHub OIDC Role**: GitHub Actions가 OIDC로 assume하는 진입점. 신뢰 정책이 `repo:ORG/REPO:ref:refs/heads/main`으로 제한. 권한은 **두 배포 role AssumeRole만**.
- **Backend Deploy Role (얇음)**: 직접 리소스를 만들지 않는다. **CloudFormation 변경셋/스택 조작** + **CfnServiceRole을 CloudFormation에 PassRole** + SAM 패키징 버킷 쓰기만 가능. `sam deploy --role-arn <CfnServiceRole>`로 실제 생성은 서비스 롤에 위임.
- **CloudFormation Service Role**: `cloudformation.amazonaws.com`만 신뢰. CloudFormation이 이 롤로 **앱 스택 리소스를 실제 생성**. IAM 생성은 `${AppStackName}-*` 이름으로 스코프.
- **Frontend Deploy Role**: 프론트 S3 버킷 sync + CloudFront 무효화 + 스택 Outputs 조회. OIDC Role만 assume 가능.

**왜 이렇게 분리하나**: 파이프라인이 쥐는 Backend Deploy Role이 탈취돼도, 그 자체로는 Lambda/DynamoDB를 직접 만들 수 없다. 오직 CloudFormation 경로로만, 그것도 PassRole이 `cloudformation.amazonaws.com`으로 조건 제한되어 서비스 롤을 다른 서비스에 넘길 수 없다. 넓은 권한은 CloudFormation만 쓸 수 있는 서비스 롤에 격리된다.

## 2. 리포지토리 구조

```
quiz-platform/
├── backend/            # SAM 앱
│   ├── template.yaml
│   ├── samconfig.toml.example   # 복사 → samconfig.toml (gitignore)
│   └── src/
├── frontend/
│   ├── public/         # 공개 콘솔 (host/player)
│   └── master/         # 마스터 콘솔
├── iam/
│   ├── template.yaml   # ★ CI/CD IAM (OIDC + deploy roles + CFN service role)
│   └── samconfig.toml.example   # 복사 → samconfig.toml (gitignore)
├── .github/workflows/
│   └── deploy.yml      # ★ main push 자동 배포 (path filter)
├── .gitignore          # samconfig.toml / node_modules / dist / .aws-sam / .env
└── docs/
```

## 3. 최초 셋업 (1회)

> IAM 역할은 **최초 1회만 로컬에서 수동 배포**한다. 이후 앱 배포는 GitHub Actions가 담당한다.

### 3.1 사전 준비
- GitHub 저장소 생성 (브랜치 `main`)
- 마스터 키 SSM 파라미터가 없다면 생성:
  ```bash
  aws ssm put-parameter --name /quiz-platform/master-key \
    --type SecureString --value "<강력한 랜덤 키>" \
    --region ap-northeast-2 --profile <YOUR_PROFILE>
  ```

> **저장소는 public 권장.** OIDC 신뢰 정책의 `sub` 조건을 표준 형식
> `repo:<org>/<repo>:ref:refs/heads/main`으로 안정적으로 매칭하기 위함이다.
> 조직 설정에 따라 **immutable/unique subject claim**이 적용되면 `sub`에 레포 고유 ID가
> 섞여 들어가 이 패턴 매칭이 어긋날 수 있다(주로 private/조직 레포에서). public 개인
> 레포는 표준 `sub`가 그대로 쓰여 가장 단순하다.
>
> 만약 push 후 Actions에서 `Not authorized to perform sts:AssumeRoleWithWebIdentity`
> (sub 불일치) 오류가 나면, `iam/template.yaml`의 `GitHubOIDCRole` 신뢰 조건을
> 실제 토큰의 `sub` 값에 맞게 조정한 뒤 `iam` 스택을 다시 배포한다.

> **2단계 푸시 전략 (중요)**: `.github/workflows/deploy.yml`을 push하면 **그 즉시 파이프라인이
> 트리거**된다. Secrets가 아직 없으면 실패하므로, 아래 순서로 올린다.
> 1. **1차 push**: `deploy.yml`을 **제외한** 전체 코드 (파이프라인 미동작)
> 2. IAM 스택 배포 + GitHub Secrets 4개 등록
> 3. **2차 push**: `deploy.yml` 추가 → 이때 파이프라인 첫 가동

### 3.2 IAM 역할 스택 배포 (수동 — 파이프라인에서 제외)

> **왜 수동인가**: `iam/template.yaml`은 **파이프라인이 사용하는 역할 자체**를 정의한다. 이걸 파이프라인이 배포하면 자기참조(권한 상승) 위험이 생기므로, CI/CD 부트스트랩 리소스는 **사람이 admin 자격으로** 관리한다. 그래서 워크플로우 path filter에는 `iam/**`가 **의도적으로 없다**.

`samconfig.toml.example`을 복사해 값을 채운 뒤 배포한다:

```bash
cd iam
cp samconfig.toml.example samconfig.toml   # 실제값 입력 (gitignore됨)
#   profile, GitHubOrg, GitHubRepo, CreateOidcProvider 등 수정
sam deploy                                  # samconfig.toml의 값 사용
```

> `samconfig.toml`은 계정/프로필 종속 값이라 **gitignore** 되어 있고, 저장소에는 `samconfig.toml.example`만 올라간다.

- `GitHubOrg`/`GitHubRepo`: 본인 저장소 (예: `haramsong`/`quiz-platform`)
- **이미 계정에 GitHub OIDC provider가 있으면** `CreateOidcProvider=false` (중복 생성 방지). 확인:
  ```bash
  aws iam list-open-id-connect-providers --profile <YOUR_PROFILE> | grep token.actions.githubusercontent.com
  ```
- `iam/` 템플릿을 수정했다면 **같은 방식으로 다시 `sam deploy`**(수동) 한다.

### 3.3 역할 ARN 확인
```bash
aws cloudformation describe-stacks --stack-name quiz-platform-cicd \
  --region ap-northeast-2 --profile haram \
  --query "Stacks[0].Outputs" --output table
```
출력된 `OIDCRoleArn` / `BackendDeployRoleArn` / `FrontendDeployRoleArn`을 기록한다.

### 3.4 GitHub Secrets 등록
저장소 → Settings → Secrets and variables → Actions → **New repository secret** 로 아래 3개 등록:

| Secret 이름 | 값 |
|-------------|-----|
| `AWS_OIDC_ROLE_ARN` | OIDCRoleArn |
| `AWS_BACKEND_DEPLOY_ROLE_ARN` | BackendDeployRoleArn |
| `AWS_CFN_SERVICE_ROLE_ARN` | CfnServiceRoleArn |
| `AWS_FRONTEND_DEPLOY_ROLE_ARN` | FrontendDeployRoleArn |

## 4. 자동 배포 동작 (`.github/workflows/deploy.yml`)

모노레포이므로 **변경된 경로만 배포**한다(`dorny/paths-filter`).

`main` push(또는 수동 `workflow_dispatch`) 시:

1. **changes 잡** — 변경 경로 감지
   - `backend/**` → `backend` 잡 실행
   - `frontend/public/**` → `frontend-public` 잡 실행
   - `frontend/master/**` → `frontend-master` 잡 실행
   - (수동 실행 시 `deploy_all=true`로 전체 강제 배포 가능)
   - `iam/**`는 **의도적으로 필터에 없음** → 파이프라인이 자기 권한을 바꾸지 못하게 함(§3.2 참조, 수동 배포)
2. **backend 잡** (backend 변경 시)
   - Node 24 + SAM 설치
   - OIDC Role assume → **role chaining**으로 Backend Deploy Role assume
   - `sam build && sam deploy --role-arn <CfnServiceRole>` → CloudFormation이 **서비스 롤로** 리소스 생성
3. **frontend-public 잡** (public 변경 시)
   - OIDC Role → Frontend Deploy Role assume
   - 스택 Outputs에서 API/WS URL 조회 → `.env` 생성 → `public` 빌드
   - WebBucket sync → 공개 CloudFront 무효화
4. **frontend-master 잡** (master 변경 시)
   - 동일 패턴으로 `master` 빌드 → MasterWebBucket sync → 마스터 CloudFront 무효화

> 프론트 잡은 백엔드 스택 Outputs를 **런타임에 조회**하므로, 백엔드가 바뀌지 않아도 프론트만 단독 배포된다(기존 스택 참조).

```yaml
permissions:
  id-token: write   # OIDC에 필수
  contents: read
```

### 4.1 SAM 패키징 버킷 (최초 1회 주의)
`sam deploy --resolve-s3`는 `aws-sam-cli-managed-default`라는 **별도 CloudFormation 스택**으로 패키징 버킷을 자동 생성한다. 이 스택은 `--role-arn` 없이 호출자(Backend Deploy Role) 권한으로 만들어지는데, 얇은 Deploy Role엔 그 권한을 넓게 주지 않았다.

따라서 **최초 1회는 로컬 admin으로 백엔드를 배포**해 패키징 버킷을 만들어 두는 것을 권장한다:
```bash
cd backend
cp samconfig.toml.example samconfig.toml   # profile 등 입력 (gitignore됨)
sam build && sam deploy --guided            # 1회 (managed 패키징 버킷 생성)
```
이후부터는 managed 버킷이 이미 존재하므로 파이프라인의 얇은 Deploy Role로 문제없이 배포된다. (대안: 패키징 버킷을 직접 만들고 워크플로우에서 `--s3-bucket <bucket>`을 지정)

## 5. 수동 트리거

워크플로우는 `workflow_dispatch`도 지원하므로, Actions 탭에서 수동 실행할 수 있다.

## 6. 보안 노트

- **장기 액세스 키 없음**: 모든 자격증명은 OIDC 단기 토큰 기반.
- **브랜치 제한**: OIDC 신뢰 정책의 `sub` 조건이 `refs/heads/main`으로 고정 — 다른 브랜치/포크는 assume 불가.
- **권한 분리 (2중)**: ① OIDC Role은 assume만, 배포 Role은 OIDC Role만 신뢰. ② Backend Deploy Role은 CloudFormation 조작 + PassRole만 가지고, 실제 리소스 생성 권한은 **CloudFormation Service Role**에 격리(파이프라인 자격증명이 직접 Lambda/DynamoDB를 만들 수 없음).
- **PassRole 제한**: Backend Deploy Role의 `iam:PassRole`은 CfnServiceRole 하나로 한정되고 `iam:PassedToService=cloudformation.amazonaws.com` 조건이 걸려, 서비스 롤을 다른 서비스에 넘길 수 없다.
- **운영 강화(선택)**: GitHub Environment + 배포 보호 규칙(승인/브랜치 제한), CfnServiceRole 권한 추가 축소(와일드카드 → 액션 열거), CloudTrail로 AssumeRole/PassRole 감사.

## 7. 로컬 수동 배포(대안)

CI 없이 수동 배포도 가능(기존 방식):
```bash
# 백엔드
cd backend && sam build && sam deploy --profile haram
# 프론트 (스택 Outputs의 버킷/배포 ID 사용)
cd frontend/public && npm run build && aws s3 sync dist/ s3://<WebBucket>/ --profile haram
# + cloudfront create-invalidation
```

## 8. 체크리스트

- [ ] 저장소 생성 + main에 코드 push (`samconfig.toml`은 gitignore, `.example`만 커밋)
- [ ] SSM 마스터 키 파라미터 존재
- [ ] `iam/samconfig.toml.example` → `samconfig.toml` 복사·수정 후 `sam deploy`(수동, OIDC 중복 시 `CreateOidcProvider=false`)
- [ ] (최초 1회) `backend/samconfig.toml.example` → `samconfig.toml` 복사 후 로컬 admin `sam deploy --guided` (패키징 버킷 생성)
- [ ] GitHub Secrets 4개 등록(OIDC/Backend/CfnService/Frontend)
- [ ] main push → Actions에서 변경된 컴포넌트만 배포되는지 확인(path filter)
- [ ] 배포된 CloudFront 도메인 접속 확인
