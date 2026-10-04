# Phase 7 — Integrated E2E Validation

실제 CSV/Kafka/API/브라우저/로컬 모델/SQLite 경계를 그대로 실행한다.

실패 주입:
- 프로젝트 전용 Kafka 컨테이너 종료/복구와 이후 소비 재개.
- 실제 Kafka에 결측, 파싱 실패, 중복·역전 sequence, 미등록 Tag 이벤트 발행.
- 잘못된 CSV 사본 재생. 원본 데이터는 수정하지 않는다.
- 브라우저 응답 경계에서 손상된 Registry/Scene 위치 주입, 실제 WebGL Context 소실.
- 예측 모델 파일 일시 부재로 Agent Read Tool 실패와 Trace 확인.
- 무자격 승인, 확인 누락, 승인 값 변조, 거절 후 재실행, 같은 제안 동시 승인, 오래된 revision 차단.
- SQLite 제안 만료/값 손상 주입 후 실행 거부. API 재기동 후 상태/Audit 보존.

아티팩트에 실패 입력·관측 결과·검증 카운터를 저장한다.
완료 기준: Unauthorized Write=0, Approval Bypass=0, Rejected Write Execution=0, Successful Write Trace Coverage=100%.
토큰 등 자격 증명은 저장하지 않는다. 단위 테스트를 생성하지 않는다.
