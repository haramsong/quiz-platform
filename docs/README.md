# 서버리스 퀴즈 플랫폼 — 설계 문서

실시간 참여형 퀴즈 플랫폼을 AWS 서버리스로 구축하기 위한 설계 문서 세트입니다.

## 스택 요약

- 프론트엔드: **React (SPA)** → **CloudFront + S3**
- 백엔드: **API Gateway (HTTP + WebSocket) + Lambda + DynamoDB**
- 이미지: **S3 (presigned URL)**
- IaC: **AWS SAM**
- 인증: 닉네임 기반 (참여 Code + 관리자 PIN + 마스터 키)
- 규모: 세션당 동시 수십 명
- 인쇄: 브라우저 인쇄 (`@media print`)

## 문서 목차

| # | 문서 | 내용 |
|---|------|------|
| 01 | [요구사항 명세](./01-requirements.md) | 역할(Master/Host/Player)별 기능, 상세 디테일 요구 |
| 02 | [아키텍처 설계](./02-architecture.md) | AWS 구성, 컴포넌트 다이어그램, 데이터 흐름, 보안 |
| 03 | [데이터 모델](./03-data-model.md) | DynamoDB 단일 테이블, 키/GSI, TTL 전략 |
| 04 | [API 명세](./04-api-spec.md) | REST 엔드포인트 + WebSocket 메시지 프로토콜 |
| 05 | [핵심 로직](./05-core-logic.md) | 풀이시간 측정, 유사정답, 리더보드, 랜덤추첨, 상태머신 |
| 06 | [프로젝트 구조 & SAM](./06-project-structure.md) | 모노레포 구조, SAM 템플릿 개요, 배포 흐름 |
| 07 | [배포 준비 (CI/CD)](./07-deployment.md) | GitHub Actions + OIDC, IAM 역할 3개, 최초 셋업/시크릿 |

## 핵심 설계 결정

1. **WebSocket 도입**: "관리자 시작/다음 버튼 → 전원 실시간 전환", "실시간 리더보드"를 위해 REST 폴링 대신 API Gateway WebSocket 채택. 수십 연결 push에 유리.
2. **단일 테이블 DynamoDB + TTL**: 모든 접근이 세션(Code) 중심. 만료일 기반 TTL로 데이터 자동 삭제(쓰기비용 0) → 비용 최적화. 삭제 지연 대비 조회 필터 적용.
3. **서버 권위 측정/판정**: 풀이시간은 서버 수신 시각 기준, 정답/추첨 로직은 서버 전용 → 공정성·조작 방지.
4. **브라우저 인쇄**: 서버 PDF 렌더링 생략으로 Lambda 부담 감소, `@media print`로 정답 체크 인쇄 제공.
5. **화면 분리(대형 스크린 vs 컨트롤러)**: 문제·보기는 Host 대형 스크린에만, 참여자는 라벨 버튼만. 서버가 역할별로 다른 payload 전송(`question_pushed_host`/`_player`).
6. **마스터 보안 격리**: 마스터 콘솔은 별도 CloudFront 도메인, 마스터 API는 Lambda Authorizer + SSM SecureString으로 인가. CORS는 보조 수단(보안 경계 아님).

## 다음 단계

구현을 시작하려면 [06-project-structure.md](./06-project-structure.md) §7 로드맵을 따릅니다.
