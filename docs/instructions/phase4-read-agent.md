# Phase 4 — Read-only AI Operations Agent

기존 로컬 Ollama `qwen2.5-coder:7b`를 이용한다. 외부 서비스 또는 시크릿 없이 실제 모델 호출을 검증한다.
모델은 허용된 Read Tool을 선택하고, 도구 결과에서 응답에 사용할 근거 ID를 선택한다.
수치는 서버가 선택된 근거에서 렌더링한다. 자유 생성 수치와 원인 단정은 응답 계약에서 허용하지 않는다.
장비 Context는 UI가 선택한 Registry 장비로 제한하며, Agent는 CSV·Kafka에 접근하지 않는다.

Trace에 질문, 장비, 모델, 도구 요청/결과, 근거 ID, 최종 응답, 실패를 남긴다.
E2E에서 실제 로컬 모델 응답, 근거 수치 일치, 존재하지 않는 Tag 거부, Read-only 경계를 확인한다.
