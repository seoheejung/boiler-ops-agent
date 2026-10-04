# Phase 1 실행 결과

- 실행일: 2026-10-05 (Asia/Seoul)
- `npm --prefix frontend run build`: TypeScript 및 Vite 빌드 통과.
- `node scripts/e2e.mjs`: 실제 Kafka 3.9.1, FastAPI, Chromium E2E 통과.
- 원본 CSV 50,400행, 2025-03-01 00:00 ~ 2025-04-04 23:59. 숫자 파싱 오류 없음.
- `목표 재열기 온도` 50,400행 모두 결측. 단위 정의는 미확인.
- 첫 16행의 원본 Tag, 원본 값, 숫자 값, sequence, source_time을 WebSocket 수신 결과와 대조.
- KPI/Scene Marker/Inspector 일치, 실제 서버 종료·재기동 이후 재연결과 상태 복구, stale 표시, WebGL 불가 fallback 통과.
- Chromium offline 설정만으로 기존 WebSocket이 종료되지 않아 실제 서버 종료로 실패 조건을 교정했다.
- 아티팩트: `artifacts/e2e/phase1/{input.json,run.json,telemetry.jsonl,dashboard.png,selected-sensor.png,fallback.png}`.

현재 Scene은 논리적 계통 탐색 화면이다. 실제 P&ID·계측기 좌표·단위·산업 안전 임계값을 주장하지 않는다.
