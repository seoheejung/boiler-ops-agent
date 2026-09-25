# BoilerOps Agent UI Design

## 1. 적용 범위

이 문서는 **Phase 1 — Realtime Boiler Monitoring** 화면만 정의한다.

AI Agent Chat, 예측 결과, 제어 권고, Human Approval 화면은 현재 범위에 포함하지 않는다.

## 2. 화면 목적

사용자가 한 화면에서 세 가지를 확인할 수 있어야 한다.

1. 데이터가 실제로 실시간 수신 중인지
2. 현재 보일러의 주요 운전값이 무엇인지
3. 해당 값이 어느 논리 계통에 속하는지

화면은 발전소 제어실 DCS를 복제하지 않는다. 공개 데이터 기반 프로젝트에서 검증 가능한 범위만 표현한다.

## 3. 디자인 원칙

- 정보 밀도를 우선한다.
- 장식보다 상태 식별을 우선한다.
- 영상 Hero를 사용하지 않는다.
- 장식 목적의 3D 보일러를 사용하지 않는다.
- 지속적인 배경 애니메이션을 사용하지 않는다.
- 실시간 값 변경을 과도한 모션으로 표현하지 않는다.
- 계통도와 데이터 패널을 독립 컴포넌트로 구성한다.
- Tag 추가 시 화면 구조를 다시 작성하지 않도록 Metadata 기반으로 연결한다.
- 색상만으로 연결 상태나 오류 상태를 전달하지 않는다.
- 실제 센서 위치가 확인되지 않은 경우 정밀 좌표처럼 보이게 표현하지 않는다.

## 4. Desktop Layout

기본 대상은 데스크톱 모니터다.

```text
┌──────────────────────────────────────────────────────────────────────┐
│ BoilerOps Agent                STREAMING ●  KAFKA ●  WS ●           │
│ Source 2025-.. ..:..  Seq 1024                 Replay 1000 ms       │
├──────────────────────────────────────────────────────────────────────┤
│ Actual Output │ Target Output │ Main Steam │ Steam Pressure │ O2     │
├─────────────────────────────────────────────┬────────────────────────┤
│                                             │ Selected Sensor        │
│              BOILER SCHEMATIC               │                        │
│                                             │ Name                   │
│ Feeder → Furnace → SH/RH → Econ → SCR      │ Current Value          │
│    ●        ●        ●       ●      ●       │ Source Time            │
│                                             │ Mapping Confidence     │
│                                             │ Recent Trend           │
├─────────────────────────────────────────────┴────────────────────────┤
│ LIVE TELEMETRY                                                       │
│ Seq 1022 | Source Time | Output | Steam | Temperature | ...         │
│ Seq 1023 | Source Time | Output | Steam | Temperature | ...         │
│ Seq 1024 | Source Time | Output | Steam | Temperature | ...         │
└──────────────────────────────────────────────────────────────────────┘
```

## 5. 화면 영역

### 5.1 Header / Stream Status

표시 항목:

- `BoilerOps Agent`
- Streaming 상태
- Kafka 상태
- WebSocket 상태
- Source Time
- Event Sequence
- Replay Interval

상태 값:

```text
CONNECTED
RECONNECTING
DISCONNECTED
ERROR
```

화면의 값이 더 이상 갱신되지 않는 경우 `CONNECTED`처럼 보이지 않아야 한다.

### 5.2 KPI Strip

Phase 1 대표 KPI 후보:

- 실제 출력값
- 목표 발전량
- 총 주증기 유량
- 터빈용 주증기 압력
- 최종과열기 출구 온도 평균값
- 배기가스 산소 중간값
- 과열기 스프레이 총 유량
- 굴뚝용 질소산화물 분석기

원본 데이터 정의에서 단위를 확인하기 전까지 UI에 단위를 추정해 붙이지 않는다.

KPI Card 구성:

```text
Label
Value
Source Time
```

Phase 1에서는 전 행 대비 증감률, 정상·위험 Badge를 임의로 추가하지 않는다.

## 6. Boiler Schematic

### 6.1 목적

보일러 구조도는 값을 실제 설비 문맥으로 이해하기 위한 **논리 계통도**다.

실제 한국중부발전 설비의 P&ID, DCS 화면, 배관 위치를 재현한다고 표현하지 않는다.

### 6.2 초기 계통

```text
Fuel / Feeder
      ↓
Combustion / Furnace
      ↓
Superheater / Reheater
      ↓
Economizer
      ↓
SCR / Flue Gas
```

급수·증기 흐름은 계통도 안에서 별도 라인으로 구분할 수 있다.

```text
Feedwater
    ↓
Economizer
    ↓
Furnace / Waterwall
    ↓
Superheater
    ↓
Main Steam

Turbine Return
    ↓
Reheater
    ↓
Reheated Steam
```

실제 배관 연결을 확정할 근거가 없는 세부 연결은 그리지 않는다.

### 6.3 Component 구조

```text
BoilerSchematic
├─ FeederSection
├─ FurnaceSection
├─ SuperheaterSection
├─ ReheaterSection
├─ EconomizerSection
├─ ScrSection
├─ FlowLine
└─ SensorPin
```

SVG 또는 DOM 기반 컴포넌트로 구현한다.

센서가 추가될 때 보일러 SVG 자체를 수정하지 않도록 `SensorPin`은 Metadata 기반으로 배치한다.

## 7. Sensor Mapping

Sensor Metadata 최소 구조:

```text
tag
label
equipment
section
measurement_type
unit
mapping_confidence
ui_position
```

`unit`은 미확인 상태를 허용한다.

`ui_position`은 실제 물리 좌표가 아니라 화면의 논리 계통 위치다.

### 7.1 Mapping Confidence

#### `verified-by-tag`

컬럼명이 위치를 직접 설명하는 경우.

예:

```text
절탄기 입구 급수 온도 중간값
→ Economizer / Inlet

최종과열기 출구 온도 평균값
→ Final Superheater / Outlet

선택적 촉매 환원장치A 배기가스 입구 온도 평균값
→ SCR A / Inlet

급탄기 A 속도 평균값
→ Feeder A
```

#### `logical-group`

계통은 확인할 수 있지만 실제 계측 지점은 확인할 수 없는 경우.

#### `unverified`

공개 정보로 위치를 판단할 수 없는 경우.

`unverified` Tag는 계통도 위에 정밀 Sensor Pin으로 배치하지 않는다.

## 8. Selected Sensor Panel

Sensor Pin을 선택하면 우측 패널에 표시한다.

```text
Sensor Label
Original Tag
Current Value
Unit
Source Time
Equipment
Section
Mapping Confidence
Recent Trend
```

Phase 1 Recent Trend는 현재 세션에서 수신한 최근 데이터 범위만 사용해도 된다.

DB 저장이나 장기간 Historical Query는 Phase 1 범위가 아니다.

## 9. Live Telemetry

목적은 Kafka → WebSocket → UI 순서를 사람이 눈으로 검증할 수 있게 만드는 것이다.

표시 컬럼:

```text
Sequence
Source Time
Emitted At
대표 측정값
```

규칙:

- 최신 Event가 식별 가능해야 한다.
- 동일 Sequence 중복 수신을 식별할 수 있어야 한다.
- 순서가 역전된 Event를 정상처럼 섞어 표시하지 않는다.
- 화면 성능을 위해 표시 행 수를 제한할 수 있다.
- 표시 제한 때문에 E2E 검증용 원본 Event Trace를 삭제하지 않는다.

## 10. Connection / Error State

### Kafka 오류

Backend가 Kafka를 소비하지 못하는 경우 UI에 Backend Stream 상태를 오류로 전달할 수 있어야 한다.

### WebSocket 오류

표시:

```text
RECONNECTING
```

자동 재연결 시 기존 최신값을 즉시 삭제할 필요는 없지만, 값이 `stale` 상태임을 명확하게 표시한다.

### 데이터 파싱 오류

특정 Tag 오류 때문에 전체 Dashboard가 렌더링 실패하면 안 된다.

오류 Tag는 값 대신 식별 가능한 상태를 표시한다.

```text
INVALID
MISSING
```

`0`으로 대체하지 않는다.

## 11. Responsive 기준

### Desktop

- Schematic + Sensor Detail 2열
- KPI 가로 배치
- Live Telemetry 하단 전체 폭

### 좁은 화면

- KPI Wrap
- Schematic 단일 열
- Sensor Detail을 Schematic 아래 배치
- Live Telemetry 가로 스크롤 허용

모바일 전용 별도 IA는 Phase 1에서 만들지 않는다.

## 12. 접근성

- 상태를 색상 하나로 구분하지 않는다.
- Sensor Pin에 접근 가능한 Label을 제공한다.
- Keyboard Focus 상태를 제거하지 않는다.
- 실시간 갱신 때문에 현재 Focus가 이동하면 안 된다.
- 숫자 변경마다 Screen Reader에 과도한 Live Announcement를 발생시키지 않는다.

## 13. 성능 기준

분 단위 원본 데이터를 빠른 Replay 속도로 재생할 수 있으므로 UI는 Message마다 전체 페이지를 재구성하지 않는다.

- 최신 Boiler State와 Live Event 목록 상태를 분리한다.
- Schematic의 정적 구조와 Sensor 값 렌더링을 분리한다.
- Trend 데이터는 화면 표시 범위를 제한한다.
- 긴 Telemetry 목록은 필요한 시점에 Virtualization을 검토한다.
- Phase 1에서 필요하지 않으면 Virtualization 패키지를 선반영하지 않는다.

## 14. 시각 스타일

목표는 **산업 모니터링 화면**이다.

- 밝은 배경 또는 짙은 중립 배경 중 하나의 Theme만 Phase 1에서 선택
- 높은 정보 대비
- 일정한 숫자 정렬
- 단순한 Panel / Border / Divider
- 상태색 최소 사용
- 장식적 Gradient 최소화
- Glassmorphism 사용 금지
- 과도한 Shadow 사용 금지
- 숫자와 Tag Label 가독성 우선

실시간 상태 애니메이션은 연결 Indicator 정도로 제한한다.

## 15. Phase 1 화면에 넣지 않는 요소

- AI Chat Panel
- Agent Avatar
- AI Recommendation Card
- 고장 예측 점수
- 위험 확률
- 자동제어 Toggle
- Valve / Feeder 직접 제어 버튼
- 승인 Modal
- Digital Twin 표현
- 실제 발전소 P&ID처럼 보이는 정밀 배관도

해당 기능은 Phase가 시작된 뒤 설계한다.

## 16. 디자인 검증

Phase 1 E2E에서 최소 한 장의 Dashboard Screenshot을 아티팩트로 남긴다.

```text
artifacts/e2e/phase1/dashboard.png
```

Screenshot에서 확인 가능해야 하는 정보:

- 연결 상태
- Source Time
- Sequence
- 대표 KPI
- Boiler Schematic
- Sensor 값
- Live Telemetry 최신 Event

## 17. 구조 참고 자료

- Babcock & Wilcox Radiant Boiler: https://www.babcock.com/assets/PDF-Downloads/Steam-Generation/E101-3193-RB-Boiler-Babcock-Wilcox.pdf

해당 공개자료에서 Furnace, Superheater, Reheater, Economizer, SCR, Coal Feeder 등의 일반적인 계통 구성을 참고할 수 있다. 대상 한국중부발전 설비의 실제 물리 구조를 입증하는 자료로 사용하지 않는다.
