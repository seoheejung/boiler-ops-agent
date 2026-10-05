# BoilerOps Agent

한국중부발전의 공개 CSV를 실제 Kafka → FastAPI → WebSocket → React/R3F로 재생하는 보일러 모니터링 프로젝트.

[그림으로 보는 프로젝트 지도와 실행 가이드](docs/index.html): `docs/index.html`을 브라우저에서 열면 코드 지도, 타입·호출 흐름, 구현 전 설계 절차, 확인 방법과 후속 과제를 볼 수 있다.

## 현재 상태

**Phase 1~7 구현, Phase별 README 갱신·개별 커밋 및 로컬 통합 E2E 검증 완료.**
실제 원본 CSV, Kafka, Chromium, Ollama 모델로 검증했다. 최종 결과는 [Phase 7 결과](docs/results/phase7-integrated-validation.md)에서 확인한다.

| Phase | 상태 | 내용 |
| --- | --- | --- |
| 1 | 검증 완료 | 원본 재생, Kafka, WebSocket, 2.5D Scene, 연결/결측 상태 |
| 2 | 검증 완료 | 전체 Tag Registry, 논리 매핑, 이력·관련 Tag |
| 3 | 검증 완료 | 실제·목표·제어값 비교, 변화율, 분포 편차 |
| 4 | 검증 완료 | 검증된 Read Tool과 수치 근거 Trace를 사용하는 로컬 AI Agent |
| 5 | 검증 완료 | 5분 온도 예측, 시간순 평가, Agent 예측 조회 |
| 6 | 검증 완료 | 명시적 인증·승인 후 로컬 Simulator 변경, SQLite Audit |
| 7 | 검증 완료 | Kafka·WebGL·Agent 실패 복구, 승인 경합·변조·만료 차단 |

## 실행

필수 도구: Python 3.13, uv, Node.js 22.12 이상, Docker Compose.
원본 CSV를 `data/raw/`에 배치한다. 원본은 Git에 포함하지 않는다.

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
uv sync --frozen
npm.cmd ci --prefix frontend
docker compose up -d --wait kafka
uv run python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Frontend 터미널:

```powershell
npm.cmd run dev --prefix frontend
```

Replay 터미널:

```powershell
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
$env:E2E_PHASE = 'phase7'
node scripts/e2e.mjs
```

E2E는 8000/4173 포트와 고유 Kafka Topic을 사용하고 종료 시 자신이 시작한 프로세스를 종료한다.
4173을 다른 프로젝트가 사용 중이면 `$env:E2E_FRONTEND_PORT = '4176'`처럼 빈 화면 포트를 지정한다. 사용 중인 포트는 테스트 시작 전에 오류로 중단한다.
Phase 7은 프로젝트 Kafka를 일시 중단·복구한다. 이 Compose Broker를 별도 운영 작업과 공유하지 않는다.
실제 입력 해시, 선택 구간의 16행, WebSocket 이벤트, 결과 JSON, 화면 캡처를 `artifacts/e2e/phaseN/`에 남긴다.
Phase 5~7은 학습 이후 시험 구간을 사용한다. `E2E_PHASE=phase1`부터 `phase7`까지 선택할 수 있다.
최종 승인 검증: 무승인 변경 0건, 승인 우회 0건, 거절 후 실행 0건, 실행 Trace 기록률 100%.
결과 문서는 `docs/results/`에서 확인한다. 단위 테스트는 만들지 않는다.

화면·접근성 결과: [Phase 7 UI 검수](docs/results/phase7-ui-accessibility-review.md). 문서 페이지의 브라우저 검수는 `node scripts/review-ui.mjs`로 별도 실행한다.
적대적 환경 검토: [보안 감사와 미해결 과제](docs/results/phase7-security-audit.md). 기존 승인 검증 통과는 외부 배포의 안전성을 의미하지 않는다.

## 로컬 AI Agent

Ollama에 `qwen2.5-coder:7b` 모델이 필요하다. `.env.example`의 `OLLAMA_BASE_URL`, `OLLAMA_MODEL`을 설정한다.
`ollama list`로 모델을 확인하고, 없다면 `ollama pull qwen2.5-coder:7b`로 준비한다.
외부 API 키는 필요하지 않다. 설비 또는 센서를 선택하고 Agent 조회를 실행한다.
모델은 허용된 Read Tool과 근거 ID를 선택하며, 수치는 실제 도구 결과로부터 렌더링된다.
Trace는 `artifacts/agent/traces/`에 저장한다. 모델 오류는 성공 응답으로 대체하지 않는다.

## 예측 모델

```powershell
uv run python -m backend.app.forecast.train
```

시간순 학습/검증/시험 분리와 모델 보고서를 `FORECAST_MODEL_PATH`에 저장한다.
모델 추론을 보려면 `REPLAY_START_ROW=42841`로 시험 구간을 재생한다. 모델 cutoff 이전 추론은 거부한다.
검증 MAE로 선택된 선형 모델은 시험 MAE 0.105784로 Naive 0.033211보다 나빴다.
현재 예측은 실험·평가용이며 단위와 제어 효과는 미확인이다. 자세한 결과는 `docs/results/phase5-temperature-forecast.md` 참고.

## 승인 기반 Simulator

Simulator는 승인 절차를 확인하는 `demo_bias` 상태 머신이며 물리 발전설비 모델이 아니다.
재열기 Agent 조회 후 별도 Control Panel에서 데모 변경을 제안하고, 값을 검토한 뒤 승인 또는 거절한다.
`SIMULATOR_APPROVAL_TOKEN`에 최소 32자의 임의 운영자 자격을 설정해야 승인이 활성화된다.
실제 자격 값은 Git·로그·결과 문서에 넣지 않는다. E2E는 임시 자격을 메모리에서 생성한다.
상태·제안·승인·실행 Audit는 `SIMULATOR_DB_PATH`에 보존한다.
제안은 5분 동안 유효하며 revision이 달라지거나 이미 결정된 제안은 실행하지 않는다.

## 데이터의 한계

- 50,400행: 2025-03-01 00:00 ~ 2025-04-04 23:59.
- `목표 재열기 온도`는 전체 결측. 숫자로 대체하지 않는다.
- 측정 단위, 실제 센서 좌표, 산업 안전 임계값은 미확인.
- 3D Scene은 논리적 계통 탐색용이며 실제 P&ID 또는 Digital Twin이 아니다.
- 현재 실행 환경은 로컬 개발·검증용이다. 다중 사용자 인증·프로덕션 배포는 미검증이며 실제 발전설비 제어 연결은 프로젝트 범위 밖이다.

기획: [.project/plan.md](.project/plan.md) · UI: [DESIGN.md](DESIGN.md) · 작업 규칙: [AGENTS.md](AGENTS.md).
