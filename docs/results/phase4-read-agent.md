# Phase 4 실행 결과

2026-10-05: 빌드 및 실제 로컬 `qwen2.5-coder:7b`를 사용하는 `E2E_PHASE=phase4 node scripts/e2e.mjs` 통과.

- 브라우저에서 선택한 Feeders Context로 실제 모델이 Read Tool과 근거 ID를 선택했다.
- 응답의 모든 수치를 도구 결과의 JSON 경로와 대조했다.
- 미등록 Tag와 허용 목록에 없는 Write Tool 요청을 422로 거부했다.
- 요청, 도구 호출, 결과, 근거, 모델, 최종 응답 Trace를 저장하고 HTTP 조회를 확인했다.
- Agent는 CSV/Kafka에 직접 접근하지 않는다. 자유 생성 수치·원인 단정을 허용하지 않는 구조화 응답이다.
- 로컬 모델을 포함한 전체 E2E 소요 약 96초. 모델이 없거나 실패하면 오류와 Trace를 반환한다.
- 아티팩트: `artifacts/e2e/phase4/agent.json`, `agent-traces/`, `run.json`.
