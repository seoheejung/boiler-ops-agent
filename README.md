# BoilerOps Agent

한국중부발전의 공개 CSV를 실제 Kafka → FastAPI → WebSocket → React/R3F로 재생하는 보일러 모니터링 프로젝트.

## 현재 상태

Phase 1 구현 및 실제 Kafka/Chromium E2E 통과. 다음 작업은 Phase 2.

| Phase | 상태 | 내용 |
| --- | --- | --- |
| 1 | 검증 완료 | 원본 재생, Kafka, WebSocket, 2.5D Scene, 연결/결측 상태 |
| 2 | 예정 | 전체 Tag Registry, 논리 매핑, 이력·관련 Tag |
| 3 | 예정 | 실제·목표·제어값 비교, 변화율, 분포 편차 |
| 4 | 예정 | 검증된 Read Tool을 사용하는 AI Agent |
| 5 | 예정 | 온도 예측 평가와 운전 참고 정보 |
| 6 | 예정 | 명시적 승인 후 로컬 Simulator 변경 |
| 7 | 예정 | 통합 실패 경로 E2E |

## 실행

필수 도구: Python 3.13, uv, Node.js 22.12 이상, Docker Compose.
원본 CSV를 `data/raw/`에 배치한다. 원본은 Git에 포함하지 않는다.

```powershell
Copy-Item .env.example .env
uv sync --frozen
npm.cmd ci --prefix frontend
docker compose up -d --wait kafka
uv run python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

별도 터미널:

```powershell
npm.cmd run dev --prefix frontend
uv run python -m backend.app.replay.producer
```

Vite가 표시하는 로컬 URL에서 접속한다. `.env`의 `BOILER_DATASET_PATH`, `REPLAY_INTERVAL_MS`,
`KAFKA_BOOTSTRAP_SERVERS`, `KAFKA_TOPIC`은 필수다. CSV UTF-8 BOM과 원본 Tag의 공백을 보존한다.
재생 종료 시 STALE을 표시한다. 새 재생은 새 run_id에서 sequence 1로 시작한다.

## 검증

```powershell
npm.cmd run build --prefix frontend
cd frontend
npx.cmd playwright install chromium
cd ..
$env:E2E_PHASE = 'phase1'
node scripts/e2e.mjs
```

E2E는 8000/4173 포트와 고유 Kafka Topic을 사용하고 종료 시 자신이 시작한 프로세스를 종료한다.
실제 입력 해시, 원본 첫 16행, WebSocket 이벤트, 결과 JSON, 화면 캡처를 `artifacts/e2e/phaseN/`에 남긴다.
결과 문서는 `docs/results/`에서 확인한다. 단위 테스트는 만들지 않는다.

## 데이터의 한계

- 50,400행: 2025-03-01 00:00 ~ 2025-04-04 23:59.
- `목표 재열기 온도`는 전체 결측. 숫자로 대체하지 않는다.
- 측정 단위, 실제 센서 좌표, 산업 안전 임계값은 미확인.
- 3D Scene은 논리적 계통 탐색용이며 실제 P&ID 또는 Digital Twin이 아니다.
- 현재 실행 환경은 로컬 개발·검증용이다. 실제 발전설비 제어 연결은 프로젝트 범위 밖이다.

기획: [.project/plan.md](.project/plan.md) · UI: [DESIGN.md](DESIGN.md) · 작업 규칙: [AGENTS.md](AGENTS.md).
