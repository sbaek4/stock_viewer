# Realtime Stock Viewer

Node.js + TypeScript + React 기반의 실시간 주식 모니터링 웹앱입니다.

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

## API

- `GET /api/health` : 서버/실시간 제공자 상태
- `GET /api/history/:symbol?range=5d&interval=5m` : 과거 데이터 + RSI/MACD/Volume

## 참고

- 무료/빠른 실시간 소스로 Finnhub를 사용했습니다.
- 과거 캔들 데이터는 Yahoo Finance를 사용합니다.
