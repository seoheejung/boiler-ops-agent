- 코드를 작성한 후에 절대 단위 테스트를 작성하지 마십시오.
- 유일한 테스트 메커니즘으로 E2E 테스트를 강력히 선호하십시오. 복잡한 기능이 작동하는지 확인하기 위해 이를 사용하십시오. E2E 테스트 끝에 검증 가능하고 반복 가능한 아티팩트를 생성하십시오.
- 시스템을 격리된 상태에서 테스트해야 한다면, 먼저 그것이 실패할 수 있는 모든 방법을 작성한 후에 코드를 작성하십시오.

테스트 주도 개발로 구현할 때 에이전트 지침에 추가하세요:

- 중복 테스트는 해롭다고 여겨집니다.
- 변경 감지 테스트는 해롭다고 여겨집니다.
- 진정한 동작 테스트의 격차 없이 버그 수정에 대한 회귀 테스트를 생성하지 마세요.

# AGENTS.md

## 1. 문서 우선순위

충돌이 발생하면 아래 순서를 따른다.

```text
사용자의 현재 명시적 지시
        ↓
.project/plan.md
        ↓
현재 Phase 지침서
        ↓
DESIGN.md
        ↓
AGENTS.md
        ↓
README.md
```

사용자가 기획 변경을 명시하지 않은 경우 `.project/plan.md` 범위를 벗어나지 않는다.

`DESIGN.md`는 현재 UI 구현 기준이며 기능 범위의 최종 기준이 아니다.

## 2. Phase 범위

- 현재 Phase에 필요한 코드와 문서만 수정한다.
- 이후 Phase 기능을 선반영하지 않는다.
- 미래 Phase용 API, DB, Tool, 화면, Interface를 미리 만들지 않는다.
- 현재 Phase 완료 기준을 충족하기 전 이후 Phase를 시작하지 않는다.
- 구현 결과는 실제 실행·검증 후 `docs/results/`에 기록한다.
- 구현 전 기능을 README나 결과 문서에서 완료된 것처럼 표현하지 않는다.

## 3. 현재 프로젝트 기준

프로젝트명:

```text
BoilerOps Agent
```

저장소:

```text
boiler-ops-agent
```

데이터 파일:

```text
한국중부발전(주)_(AI 친화 데이터)분 단위 발전설비(보일러) 운전데이터_20250404.csv
```

현재 구현 대상:

```text
Phase 1 — Realtime Boiler Monitoring
```

Phase 1 경로:

```text
CSV
→ Replay Producer
→ Kafka
→ FastAPI
→ WebSocket
→ React
→ React Three Fiber Boiler View
```

Phase 1에서 AI Agent, Prediction, Write Tool, Human Approval 기능을 작성하지 않는다.

## 4. 데이터 규칙

- 원본 CSV를 저장소에 커밋하지 않는다.
- 데이터 경로는 환경 변수로 관리한다.
- 원본 CSV Column Name을 임의로 변경하거나 의미를 재해석하지 않는다.
- 내부 영문 식별자가 필요하면 원본 Tag Mapping을 명시적으로 유지한다.
- 결측값을 `0` 또는 임의 평균값으로 자동 치환하지 않는다.
- 원본 값 파싱 실패를 숨기지 않는다.
- 측정 단위를 추측하지 않는다.
- 정상·주의·위험 임계값을 근거 없이 생성하지 않는다.
- 고장 Label이 없는 데이터를 고장 데이터라고 표현하지 않는다.
- 관측 상관관계를 제어 인과관계라고 표현하지 않는다.

## 5. 보일러 도메인 규칙

- 공개된 일반 보일러 구조도를 대상 한국중부발전 설비의 실제 P&ID로 취급하지 않는다.
- 센서 위치는 Column Name 또는 공식 자료로 확인 가능한 범위까지만 사용한다.
- 정확한 위치가 불명확한 Tag는 논리 계통 수준으로만 Mapping한다.
- 실제 계측기 좌표, DCS Tag, PLC Address를 임의 생성하지 않는다.
- Sensor Mapping 근거를 `verified-by-tag`, `logical-group`, `unverified`로 구분한다.
- `unverified` Tag를 정밀 Sensor Point처럼 표시하지 않는다.
- 설비 구조 사실을 추가할 때 근거를 확인한다.
- 물리 Process Model이 없는 상태에서 Digital Twin이라고 표현하지 않는다.

## 6. Streaming 규칙

Phase 1 기준:

- Kafka Topic 기본값은 `boiler.telemetry.raw`다.
- 전체 Event 순서 검증을 위해 단일 Partition으로 시작한다.
- Event `sequence`는 단조 증가한다.
- 원본 시각 `source_time`과 발행 시각 `emitted_at`을 분리한다.
- Replay 속도는 환경 변수로 관리한다.
- Consumer가 처리하지 않은 Event를 처리한 것으로 표시하지 않는다.
- 중복 Event와 Sequence 역전을 숨기지 않는다.
- WebSocket 재연결 상태를 UI에 표시한다.
- 연결 단절 후 오래된 값을 최신값처럼 표시하지 않는다.
- Stale 판단 기준은 구현 시 한 곳에서 관리한다.

## 7. Backend 규칙

- Backend는 FastAPI를 사용한다.
- API, Domain, Replay, Streaming, WebSocket 책임을 분리한다.
- Raw Kafka Message를 React에 그대로 전달하지 않는다.
- Event Parsing과 Domain Mapping은 Backend 책임이다.
- Frontend가 CSV Column 해석 규칙을 소유하지 않게 한다.
- AI Agent가 추가되어도 Kafka를 직접 읽지 않는다.
- AI Agent는 검증된 Backend Tool/API 경계를 사용한다.
- Phase 6 이전에 Write Endpoint 또는 제어 인터페이스를 만들지 않는다.
- 오류를 넓은 `except`로 숨기지 않는다.
- Runtime Error에는 재현 가능한 Context를 남긴다.

## 8. Frontend 규칙

- Frontend는 React + TypeScript + Vite를 사용한다.
- Next.js로 변경하지 않는다.
- Phase 1 3D Scene은 React Three Fiber를 사용한다.
- prerelease React Three Fiber 버전을 사용하지 않는다.
- 3D는 Monitoring Navigation Layer로만 사용한다.
- 실제 발전소를 사실적으로 복제하려고 하지 않는다.
- 복잡한 외부 3D Asset Pack을 Phase 1에 추가하지 않는다.
- 단순 Geometry와 재사용 가능한 Component를 우선한다.
- Scene과 일반 React UI 책임을 분리한다.
- Camera는 고정 Isometric 시점을 기본으로 한다.
- 자유 회전, 1인칭 이동, Fly Camera를 Phase 1에 넣지 않는다.
- 제한된 Zoom과 Pan은 허용한다.
- Scene 객체 클릭으로 Write 또는 제어를 실행하지 않는다.
- Sensor 위치와 Tag Metadata를 Scene Component 내부에 반복 하드코딩하지 않는다.
- WebSocket lifecycle을 명시적으로 관리한다.
- Connection, Stale, Error 상태를 숨기지 않는다.
- 색상만으로 상태를 전달하지 않는다.

## 9. React Three Fiber 규칙

- `BoilerScene`과 UI Panel을 분리한다.
- WebSocket Event마다 Scene 전체를 재생성하지 않는다.
- 변경된 Tag와 관련된 Sensor Marker만 갱신할 수 있는 상태 구조를 사용한다.
- 렌더 루프 안에서 전역 React State를 지속적으로 갱신하지 않는다.
- 정적 Geometry와 Material은 가능한 범위에서 재사용한다.
- 동일 형태가 반복되는 Sensor Marker는 필요 시 Instancing을 검토한다.
- Phase 1에서 성능 문제를 측정하기 전 성급한 최적화 패키지를 추가하지 않는다.
- 장식 목적의 Particle, Bloom, Glow, Cinematic Motion을 넣지 않는다.
- Process Flow Animation은 공정 흐름 이해에 필요한 경우만 제한적으로 사용한다.
- WebGL 초기화 실패 시 사용자에게 식별 가능한 Fallback을 제공한다.

## 10. UI 상태 규칙

Phase 1에서 허용하는 운영 상태:

```text
LIVE
STALE
DISCONNECTED
ERROR
SELECTED
UNMAPPED
```

근거가 확보되기 전 아래 상태를 만들지 않는다.

```text
NORMAL
WARNING
CRITICAL
DANGER
```

산업 안전 의미를 가진 색상을 임의로 사용하지 않는다.

## 11. 환경 변수

환경별 값은 가능한 한 `.env` 기반으로 관리한다.

Phase 1 최소 환경 변수:

```text
BOILER_DATASET_PATH=
REPLAY_INTERVAL_MS=
KAFKA_BOOTSTRAP_SERVERS=
KAFKA_TOPIC=
```

필수 환경 변수가 없으면 명확한 오류로 실행을 중단한다.

Secret, Token, Password를 코드·README·로그·E2E 아티팩트에 기록하지 않는다.

## 12. 의존성 관리

- 필요하지 않은 패키지를 추가하지 않는다.
- prerelease 버전을 사용하지 않는다.
- 패키지 설치 전 설치 목적과 변경되는 lock file을 확인한다.
- 승인 없이 대규모 Dependency 교체를 수행하지 않는다.
- 기존 도구로 해결 가능한 문제에 새 라이브러리를 추가하지 않는다.
- 3D 편의를 이유로 불필요한 Helper Library를 먼저 추가하지 않는다.

## 13. 테스트 전략

### 기본 원칙

- 단위 테스트 개수로 품질을 증명하지 않는다.
- 실제 사용자 흐름과 시스템 경계를 통과하는 E2E를 우선한다.
- 테스트는 구현 세부사항이 아니라 관찰 가능한 동작을 검증한다.
- 내부 함수 호출 횟수, 특정 DOM 구조, private implementation을 고정하는 테스트를 만들지 않는다.
- 같은 동작을 여러 계층에서 반복 검증하지 않는다.
- 3D Scene은 내부 Mesh 구조가 아니라 사용자에게 보이는 상태와 Sensor 선택 결과를 검증한다.

### Phase 1 E2E

한 번의 실행으로 아래 흐름을 검증할 수 있어야 한다.

```text
CSV Row
→ Kafka Event
→ FastAPI Consumer
→ WebSocket Message
→ React State
→ R3F Sensor / KPI / Operations Feed
```

검증 항목:

- Sequence 순서
- Source Time 보존
- 대표 Sensor 값
- KPI 최신값
- Sensor 선택
- Inspector 값
- Live Operations Event
- Kafka 상태
- WebSocket 상태
- Stale 상태
- 재연결
- WebGL Fallback

### E2E 아티팩트

기본 경로:

```text
artifacts/e2e/phaseN/
```

Phase 1 권장 출력:

```text
run.json
telemetry.jsonl
dashboard.png
selected-sensor.png
```

아티팩트는 동일 입력으로 반복 실행했을 때 동일한 검증 기준을 적용할 수 있어야 한다.

### 격리 테스트가 불가피한 경우

코드를 작성하기 전에 실패 가능성을 먼저 작성한다.

검토 항목:

- 입력 누락
- CSV 파싱 실패
- 데이터 순서 오류
- Kafka 연결 실패
- Consumer 중단
- WebSocket 연결 종료
- 중복 Message
- Stale State
- 잘못된 Tag Mapping
- Scene Position Mapping 오류
- WebGL 초기화 실패
- Sensor 선택과 Inspector 불일치

E2E에서 검증할 수 없는 실제 동작 격차가 있을 때만 격리 테스트를 허용한다.

## 14. AI Agent 규칙

Phase 4 이전에는 AI Agent 코드를 작성하지 않는다.

Phase 4 기준:

- Raw CSV 직접 접근 금지
- Kafka 직접 접근 금지
- 검증된 Read Tool 사용
- 수치 주장의 Tool Result 추적 가능성 확보
- 존재하지 않는 Sensor·Tag 생성 금지
- 근거 없는 원인 단정 금지
- Tool Failure 숨김 금지

Write Tool은 Phase 6에서만 추가한다.

```text
Read Tool
→ 정책 범위 안에서 자동 실행 가능

Write Tool
→ Constraint Validation
→ Human Approval
→ Simulator 실행
→ Trace 기록
```

실제 발전설비 제어 연결은 프로젝트 범위에 포함하지 않는다.

## 15. 코드 규칙

- 코드 주석은 짧고 직접적인 명사형으로 작성한다.
- 사용자가 작성한 기존 주석 표현은 명시적 요청 없이 변경하지 않는다.
- 불필요한 추상화를 추가하지 않는다.
- 현재 Phase에서 한 번만 쓰이는 구조를 미래 확장성 명목으로 과도하게 일반화하지 않는다.
- 오류를 무시하거나 넓은 예외 처리로 숨기지 않는다.

주석 예:

```text
필수 환경 변수 값 조회
Replay 간격 환경 변수 변환
Kafka 메시지 역직렬화
WebSocket 연결 상태 갱신
Sensor Mapping 조회
Scene 상태 갱신
```

## 16. 문서 규칙

- `.project/plan.md`는 전체 기획과 Phase 경계를 관리한다.
- `docs/instructions/phaseN-*.md`는 현재 Phase 구현 범위와 완료 기준을 관리한다.
- `docs/results/phaseN-*.md`는 실제 실행·검증 결과만 기록한다.
- `README.md`는 현재 구현 상태를 기준으로 유지한다.
- `DESIGN.md`는 현재 구현 대상 UI 기준만 기록한다.
- 같은 규칙을 여러 문서에 불필요하게 반복하지 않는다.
- 구현되지 않은 기능을 현재 기능처럼 서술하지 않는다.
- 확인하지 못한 사실은 `미확인`으로 표시한다.

## 17. Git 규칙

- 현재 Phase 작업만 Commit에 포함한다.
- Phase 완료 전 임의 Push를 수행하지 않는다.
- Push는 사용자의 명시적 지시가 있을 때만 수행한다.
- Commit Message는 변경 목적과 Phase를 식별할 수 있게 작성한다.

권장 형식:

```text
feat: phase1-realtime-monitoring
fix: phase1-websocket-reconnect
fix: phase1-sensor-selection
```

## 18. 완료 판단

작업 완료 선언 전 확인:

- 현재 Phase 범위만 구현했는가
- CSV → Kafka → FastAPI → WebSocket → React → R3F 흐름이 실제로 동작하는가
- E2E가 실제 사용자 흐름을 검증하는가
- E2E 아티팩트가 생성되었는가
- Sensor Mapping 근거를 임의 생성하지 않았는가
- 실제 발전소 구조처럼 오인할 3D 표현이 없는가
- 산업 안전 Threshold를 임의로 만들지 않았는가
- README가 실제 구현 상태와 일치하는가
- 실행하지 않은 검증을 결과 문서에 기록하지 않았는가
- 작업 트리에 의도하지 않은 파일이 포함되지 않았는가
