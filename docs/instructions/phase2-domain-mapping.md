# Phase 2 — Boiler Domain & Sensor Mapping

원본 헤더 전체를 Registry에 등록한다. Tag 이름을 보존하고 Equipment/Section/역할/Mapping 근거/논리 Scene 위치를 제공한다.
Column에서 확인 불가능한 위치는 unverified, 단위는 미확인으로 둔다.
Equipment 계층과 논리 Process Flow를 제공하고, 선택한 Tag의 최근 관측 이력·관련 Tag를 표시한다.

검증: 실제 Kafka E2E에 전체 헤더 역추적, unverified 위치 없음, 선택 Tag/Inspector 일치, history 시각·값 일치 검증을 추가한다.
아티팩트는 `artifacts/e2e/phase2/`에 저장한다.
