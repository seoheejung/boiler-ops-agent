# BoilerOps Agent

> 한국중부발전 보일러 운전데이터를 실시간 스트림으로 재현하고, 모니터링부터 AI 기반 운전 지원과 승인 제어까지 단계적으로 검증하는 산업 운영 시스템

## 프로젝트 정보

| 항목 | 값 |
| --- | --- |
| 프로젝트명 | BoilerOps Agent |
| 디렉토리명 | `boiler-ops-agent` |
| GitHub Repository | `boiler-ops-agent` |
| Frontend | React + TypeScript + Vite |
| Backend | FastAPI |
| Streaming | Apache Kafka + WebSocket |
| 데이터 제공기관 | 한국중부발전(주) |
| 데이터 출처 | 공공데이터포털 |

## 현재 상태

**기획 완료 / 구현 전**

현재 구현 대상은 **Phase 1 — Realtime Boiler Monitoring**이다.

AI Agent, 온도 예측, 제어 권고, Write Tool은 아직 구현 범위가 아니다.

## 사용 데이터

```text
한국중부발전(주)_(AI 친화 데이터)분 단위 발전설비(보일러) 운전데이터_20250404.csv
```

분 단위 보일러 운전데이터의 출력, 급탄, 공기, 급수, 증기, 과열기, 재열기, 배기가스 관련 Tag를 사용한다.

원본 CSV는 저장소에 포함하지 않는다.

```text
data/raw/*.csv
```

## Phase 1 목표

정적인 CSV를 시간 순서대로 재생하고, Kafka와 FastAPI를 거쳐 WebSocket으로 React 화면에 전달한다.

```text
Boiler CSV
    ↓
Replay Producer
    ↓
Apache Kafka
    ↓
FastAPI
    ↓
WebSocket
    ↓
React Monitoring UI
```

화면에서 확인할 항목:

- Kafka / WebSocket 연결 상태
- 현재 Source Time
- Event Sequence
- 실제 출력값 / 목표 발전량
- 주증기 유량·압력
- 과열기 온도
- 급수·연소·배기가스 대표값
- 논리 보일러 계통도
- 검증 가능한 Sensor Pin
- 최근 Live Telemetry

## 보일러 화면 범위

화면의 보일러 구조는 실제 발전소 P&ID 복제가 아니다.

현재 데이터의 컬럼명과 공개된 일반 보일러 구조자료를 기준으로 아래 계통을 논리적으로 구분한다.

```text
Coal Feeder
    ↓
Combustion / Furnace
    ↓
Superheater / Reheater
    ↓
Economizer
    ↓
SCR / Flue Gas
```

실제 센서 장착 좌표가 확인되지 않은 Tag는 정확한 위치를 임의로 만들지 않는다.

## Phase Roadmap

| Phase | 목표 | 상태 |
| --- | --- | --- |
| 1 | CSV → Kafka → FastAPI → WebSocket → React 실시간 모니터링 | 예정 |
| 2 | Boiler Domain / Sensor Mapping | 예정 |
| 3 | 운전 Trend / Target / Deviation 분석 | 예정 |
| 4 | Read-only AI Operations Agent | 예정 |
| 5 | Temperature Forecast / Control Advisory | 예정 |
| 6 | Human Approval 기반 Simulator Write | 예정 |
| 7 | 통합 E2E / 실패 경로 검증 | 예정 |

각 Phase 범위는 `.project/plan.md`와 해당 `docs/instructions/phaseN-*.md`에서 관리한다.

## 문서 구조

```text
.project/plan.md          프로젝트 전체 기획과 Phase 경계
AGENTS.md                 저장소 작업 규칙
DESIGN.md                 현재 UI 설계 기준
docs/instructions/        Phase별 구현 지침
docs/results/             실제 구현·검증 결과
```

구현되지 않은 기능은 README에서 완료된 기능처럼 표현하지 않는다.

## 데이터 처리 원칙

- 원본 시간축 보존
- Replay 발행 시각 별도 기록
- Event `sequence` 단조 증가
- 결측값 임의 보정 금지
- 단위 추측 금지
- 정상·위험 임계값 임의 생성 금지
- 실제 센서 위치 추측 금지
- 실제 발전설비 Write 연결 금지

## 테스트 원칙

프로젝트 테스트 기준은 `AGENTS.md`를 따른다.

Phase 완료 여부는 단위 테스트 개수가 아니라 **실제 사용자 흐름을 재현하는 E2E 테스트와 검증 가능한 실행 아티팩트**로 판단한다.

## 참고 자료

- 공공데이터포털: https://www.data.go.kr/
- Apache Kafka: https://kafka.apache.org/intro/
- FastAPI WebSockets: https://fastapi.tiangolo.com/advanced/websockets/
- React: https://react.dev/
- Babcock & Wilcox Radiant Boiler 구조 참고: https://www.babcock.com/assets/PDF-Downloads/Steam-Generation/E101-3193-RB-Boiler-Babcock-Wilcox.pdf

Babcock & Wilcox 자료는 대상 발전설비의 실제 도면이 아니며, 일반적인 보일러 계통 관계를 이해하기 위한 참고자료로만 사용한다.
