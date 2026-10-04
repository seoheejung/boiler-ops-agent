# Phase 1 — Realtime Boiler Monitoring

실제 `data/raw/` CSV를 읽고 단일 파티션 Kafka → FastAPI → WebSocket → React/R3F를 검증한다.
원본 Tag의 후행 공백도 보존한다. 단위는 미확인으로 유지한다. 결측값과 파싱 실패를 구분한다.

## 구현과 검증

- Python: FastAPI, Uvicorn, aiokafka, python-dotenv. `uv.lock`으로 고정한다.
- Frontend: React, TypeScript, Vite, Three.js, React Three Fiber. `frontend/package-lock.json`으로 고정한다.
- E2E: Playwright Chromium, 실제 Kafka Docker 컨테이너, 실제 CSV 입력. 단위 테스트를 만들지 않는다.
- 필요한 로컬 의존성 설치는 모든 Phase 구현·자체 검증을 요청한 현재 작업 범위에 포함한다.
- `artifacts/e2e/phase1/`에 입력 해시, 수신 이벤트, 검증 결과, 스크린샷을 저장한다.
- 순서, 원본 시각, KPI/Marker/Inspector 동일 값, Kafka/WS 상태, stale, 재연결, WebGL fallback을 확인한다.

## 실패 경로

필수 환경 변수 누락, CSV 헤더 중복·행 너비 불일치·시각 누락, 숫자 파싱 실패, 결측,
Kafka 연결 실패·중단, 중복/역전 sequence, WebSocket 종료, 느린 구독자,
잘못된 Tag 또는 Scene 위치, WebGL 생성 실패, 선택 값 불일치를 숨기지 않는다.

Phase 1 실행 검증이 통과한 뒤 Phase 2로 진행한다.
