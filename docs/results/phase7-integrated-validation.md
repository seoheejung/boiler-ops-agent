# Phase 7 통합 실행 결과

2026-10-05 최종 `E2E_PHASE=phase7 node scripts/e2e.mjs` 통과.
`npm.cmd run build --prefix frontend`의 TypeScript/Vite 빌드 통과.
실제 원본 CSV, Kafka 3.9.1, FastAPI, Chromium, Ollama qwen2.5-coder:7b, SQLite를 사용했다.

같은 날 화면·접근성 보완 후 `E2E_FRONTEND_PORT=4176`으로 통합 검증을 추가 실행했다. 화면 갱신 일시정지·키보드·모바일·404와 보안 관측을 포함한 19개 항목이 통과했다. 세부 결과는 [UI 검수](phase7-ui-accessibility-review.md)와 [보안 감사](phase7-security-audit.md)에 기록한다. 보안 관측 성공은 발견된 접근 통제 취약점의 해소를 의미하지 않는다.

## 실제 확인한 동작

- 시험 구간 CSV 16행의 모든 Tag·값·시각을 Kafka/API/WebSocket/브라우저까지 대조.
- 서버 종료·재연결, Kafka 컨테이너 중단·복구 및 후속 이벤트 소비.
- 결측값 유지, 파싱 오류 표시, 잘못된 CSV 행 폭의 실행 실패.
- 중복·역전 sequence, 미등록 Tag 이벤트 거부와 기존 상태 보존.
- 손상된 Registry Tag/Scene 좌표 수신 시 오류 표시.
- 각 설비 Marker와 Inspector의 Tag·값 일치.
- WebGL 미지원 및 실제 Context 소실 후 설비 선택 가능.
- 실제 로컬 모델의 Read Tool 선택, 수치 근거와 JSON 경로 일치.
- 예측 파일 부재로 Agent Tool 실패 시 503 및 실패 호출 Trace 생성, Telemetry 유지.
- 승인 자격 누락·오류, 확인 누락, 문자열 승인값, 요청값 변조, 잘못된 revision 거부.
- 같은 제안 동시 승인 중 하나만 실행, 다른 오래된 제안 차단.
- 만료되거나 저장 값이 손상된 제안 실행 거부.
- 거절 후 실행 및 중복 실행 차단.
- API 재기동 후 Simulator 상태·Audit 유지.
- 실행 중 승인 자격 값이 JSON/JSONL/로그 아티팩트에 포함되지 않음을 검사.

## 승인 경계 측정

Audit의 제안·승인·거절·실행 관계에서 계산했다. 아래 결과는 이 E2E 시나리오 범위의 관측이다.

| 항목 | 결과 |
| --- | ---: |
| Unauthorized Write | 0 |
| Approval Bypass | 0 |
| Rejected Write Execution | 0 |
| Successful Write Trace Coverage | 100% |
| 승인 후 실행 | 2 |

## 재현 및 아티팩트

실행 전 Docker의 프로젝트 Kafka 및 로컬 Ollama 모델이 필요하다. 8000/4173 포트는 비워 둔다.
Phase 7은 프로젝트 Kafka 컨테이너를 일시 중단하므로 별도의 운영/공유 Broker를 대상으로 실행하지 않는다.

```powershell
docker compose up -d --wait kafka
npm.cmd run build --prefix frontend
$env:E2E_PHASE = 'phase7'
node scripts/e2e.mjs
```

`artifacts/e2e/phase7/`:

- `run.json`, `input.json`, `telemetry.jsonl`: 실행 결과와 원본/수신 대조 근거
- `dashboard.png`, `selected-sensor.png`, `fallback.png`, `simulator-decision.png`: 실제 브라우저 화면
- `analysis.json`, `forecast-model.json`, `forecast.json`: 분석 및 시간순 평가
- `agent.json`, `advisory-agent.json`, `agent-tool-failure.json`, `agent-traces/`: 모델/도구 근거
- `failure-observations.json`, `invalid-position.png`, `invalid-tag.png`, `malformed-replay.log`: 실패 경로
- `final-audit.json`, `safety-counters.json`: 승인·변경 Trace와 계산한 검증 수치

## 남은 적용 한계

- 목표 재열기 온도는 전량 결측이며 단위·실제 센서 위치·산업 안전 기준은 미확인이다.
- 학습 모델의 시험 성능은 Naive보다 나쁘다. 모델 개선 또는 운전 적용을 검증한 것은 아니다.
- Simulator는 승인 상태 머신이며 물리 보일러 모델이 아니다.
- 로컬 운영자 공유 자격 방식이다. 다중 사용자 인증 또는 프로덕션 배포는 이번 검증 범위에 없다.
