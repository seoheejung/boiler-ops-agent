# Phase 6 — Controlled Simulator Write

실제 산업 제어 범위가 미확인이므로 실제 밸브/보일러 제어 모델을 생성하지 않는다.
Simulator는 승인 절차 검증용 차원 없는 `demo_bias` 상태 머신이다. 물리적 온도 반응은 모델링하지 않는다.
데모 정책 `local-demo-v1`: 값 [-10, 10], 한 번 변경 {-1, 0, 1} simulation_step. 이 값은 산업 안전 기준이 아니다.

Agent의 재열기 관측 Trace를 연결하고 로컬 모델이 사용자의 Simulator 요청에서 increase/hold/decrease를 선택한다.
Proposal 생성은 상태를 변경하지 않는다. 인증된 운영자의 별도 결정 요청에 명시적 확인이 있어야 실행한다.
승인 대상 값 수정 금지, 5분 만료, revision 일치, 거절 후 실행 금지, 중복 실행 금지.
SQLite 단일 트랜잭션으로 승인·상태 변경·Audit를 기록한다. API는 실제 설비 연결 기능을 제공하지 않는다.

`SIMULATOR_APPROVAL_TOKEN`은 사용자 환경에서 설정한다. E2E에서는 실행 중에만 임시 토큰을 생성하고 로그·아티팩트에 기록하지 않는다.
검증: 미승인 불변, 잘못된 자격 거부, 브라우저 승인, 거절, 재실행 차단, 변경 Trace.
