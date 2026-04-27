# Realtime Stock Viewer

Node.js + TypeScript + React 기반의 실시간 주식 모니터링 웹앱입니다.  
테스트/CI-CD/Docker/Terraform 보일러플레이트까지 포함되어 있습니다.

## 핵심 기능

- 실시간 체결가 스트리밍(WebSocket, Finnhub)
- 시계열 가격 차트
- 기술적 분석 지표: RSI(14), MACD(12/26/9), Volume
- 심볼 변경 및 지표 표시 토글
- 백엔드에서 과거 캔들 + 지표 계산 제공

## 기술 스택

- Frontend: React + TypeScript + Vite + Recharts + socket.io-client
- Backend: Express + TypeScript + Socket.IO + Yahoo Finance + technicalindicators
- Realtime Provider: Finnhub WebSocket

## 빠른 시작

### 0) 루트(워크스페이스)

```bash
npm install
```

### 1) 백엔드

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

`.env`에서 `FINNHUB_API_KEY`를 넣어야 실시간 tick 스트림이 활성화됩니다.

### 2) 프론트엔드

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

브라우저에서 `http://localhost:5173` 접속.

### 3) 한 번에 품질 체크

```bash
npm run test
npm run build
```

## API

- `GET /api/health` : 서버/실시간 제공자 상태
- `GET /api/history/:symbol?range=5d&interval=5m` : 과거 데이터 + RSI/MACD/Volume

## Test Boilerplate

- Backend: `Vitest + Supertest` (`backend/test/health.test.ts`)
- Frontend: `Vitest + Testing Library` (`frontend/src/App.test.tsx`)
- 실행:
  - `npm run test -w backend`
  - `npm run test -w frontend`

## CI/CD Boilerplate

- GitHub Actions
  - `/.github/workflows/ci.yml`
    - backend typecheck/test
    - frontend lint/test/build
  - `/.github/workflows/cd.yml`
    - GHCR 이미지 빌드/푸시
    - Terraform init/validate/plan

## Docker Boilerplate

- `backend/Dockerfile`
- `frontend/Dockerfile`
- `docker-compose.yml`

```bash
docker compose up --build
```

## Terraform Boilerplate (AWS ECS/ECR)

- 경로: `terraform/`
- 포함 리소스:
  - ECR repositories (backend/frontend)
  - ECS cluster
  - ECS task definition (backend)
  - IAM execution role

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform validate
terraform plan
```

> 주의: `terraform/main.tf`의 SSM 파라미터 ARN, 도메인, 네트워크(VPC/Subnet/ALB)는 실제 환경 값으로 보완해야 합니다.

## 참고

- 무료/빠른 실시간 소스로 Finnhub를 사용했습니다.
- 과거 캔들 데이터는 Yahoo Finance를 사용합니다.
