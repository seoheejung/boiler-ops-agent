# Phase 6 실행 결과

2026-10-05: 빌드 및 `E2E_PHASE=phase6 node scripts/e2e.mjs` 통과.

- 실제 Ollama 모델이 사용자의 데모 요청을 Simulator 제안으로 변환했다.
- 제안 생성만으로 상태가 바뀌지 않음을 확인했다.
- 자격 없는 승인 요청은 401, 결정 완료 후 재승인은 409로 거부했다.
- 브라우저에서 운영자 자격·명시적 확인·승인을 거쳐 0 → 1, revision 0 → 1로 변경했다.
- 두 번째 제안을 거절한 후 상태 1을 유지하고 거절 후 재승인을 차단했다.
- 실행 이벤트 1건에 대응하는 승인·제안·변경 결과 Audit가 모두 존재한다.
- 아티팩트: `artifacts/e2e/phase6/simulator-audit.json`, `simulator-decision.png`, `run.json`.

Simulator는 차원 없는 demo_bias 상태 머신이다. 실제 보일러 제어 범위나 물리 응답을 모델링하지 않는다.
승인 토큰은 실행 중에 생성해 테스트 프로세스에만 전달했고, 저장 아티팩트에 기록하지 않았다.
