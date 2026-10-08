# BoilerOps Agent

공개 보일러 운전 CSV를 **Kafka → FastAPI → WebSocket → React**로 재생하고, 선택한 센서의 이력·AI 근거·온도 예측을 확인하는 로컬 프로젝트입니다. Simulator는 사람의 승인 절차를 검증하는 `demo_bias` 상태 머신입니다. 실제 발전설비에 연결하지 않습니다.

[그림으로 보는 프로젝트 지도](https://seoheejung.github.io/boiler-ops-agent/)를 브라우저로 열면 기능별 흐름, 타입·호출 계약, 코드와 검수 결과를 **같은 페이지에서** 읽을 수 있습니다.

## 실행은 이렇게 하세요

**Docker Desktop을 켠 뒤, 프로젝트 폴더에서 아래 명령 하나를 실행하세요.**

```powershell
npm start
```

터미널의 현재 폴더가 다른 곳이라면 먼저 다음 명령을 한 번 실행합니다.

```powershell
cd D:\01_Programming\08_AI\Agent\boiler-ops-agent
```

1. 준비가 끝나면 브라우저가 열립니다. 안 열리면 **http://127.0.0.1:5173**에 접속하세요.
2. 사용자 ID에 **operator**, 개인 접근 키에 **처음 발급받은 키**를 입력합니다. 처음 실행하는 PC에서는 키가 터미널에 한 번 표시됩니다. 기존 키는 바꾸지 않습니다.
3. 화면의 숫자와 시간이 바뀌면 실행된 것입니다. 끝낼 때는 실행한 터미널에서 **Enter** 또는 **Ctrl+C**를 누르세요.

여러 터미널을 열거나 Docker 명령을 따로 입력할 필요가 없습니다. `npm start`가 설정 확인 → Kafka → 모델 → 화면 → API → 데이터 재생을 순서대로 처리합니다. 처음 준비에는 시간이 걸립니다.

### 처음 한 번 준비

- **원본 CSV**를 `data/raw/` 폴더에 넣습니다. 데이터는 저장소에 포함되어 있지 않습니다. 기존 `.env`가 있으면 그 파일에 지정된 CSV를 사용합니다.
- 다른 PC라면 **Node.js 22.12 이상, Python 3.13과 uv, Docker Desktop, Ollama**를 먼저 설치합니다. 자세한 설치 확인은 [준비 안내](docs/local-development.md)를 참고하세요.
- Python·화면 의존성, 필요한 AI 모델과 예측 파일은 실행 명령이 준비합니다. AI 모델이 없는 PC는 최초에 약 4.7GB를 다운로드합니다.

### 안 될 때는 이 세 가지만 확인하세요

| 화면에 나온 안내 | 할 일 |
| --- | --- |
| Docker Desktop을 켜 주세요 | Docker Desktop을 켜고 엔진이 준비된 뒤 `npm start`를 다시 실행 |
| 원본 CSV가 없습니다 | `data/raw/`에 CSV를 넣고, 기존 `.env`가 있다면 파일 경로 확인 |
| 포트를 사용 중입니다 | 전에 실행한 이 프로젝트의 터미널에서 종료한 뒤 다시 실행 |

다른 오류는 터미널에 **실패한 단계와 로그 위치**가 표시됩니다. 개인 접근 키를 잃었다면 [로그인 키 안내](docs/local-development.md)를 확인하세요. 설정 파일을 삭제하면 Kafka 자격도 사라지므로 그대로 보존합니다.

`npm start`는 화면을 빌드해 여는 **로컬 확인용 실행**입니다. 코드 변경은 종료 후 다시 시작하면 반영됩니다. 저장 즉시 화면에 반영하는 개발 서버와 Docker 없이 기존 Kafka를 사용하는 방법은 [수동 개발 안내](docs/local-development.md)에 있습니다. 인증을 생략하는 모드는 없습니다.

실제 로그인·데이터 표시·종료를 포함한 [한 명령 실행 검증 7개 항목](docs/results/phase7-local-start.md)을 통과했습니다.

## 먼저 화면으로 보기

실제 CSV·Kafka·Ollama를 사용한 로컬 E2E에서 촬영한 화면입니다. 개인 접근 키와 세션 쿠키는 화면에 포함하지 않습니다.

![KPI, 보일러 계통도, 선택한 센서의 Inspector가 표시된 실제 운전 화면](docs/images/dashboard.jpg)

| 로그인 | 제안 검토와 승인 결과 |
| --- | --- |
| ![개인 사용자 ID와 접근 키로 로그인하는 화면](docs/images/login.jpg) | ![로컬 Simulator 제안을 사람이 확인하고 실행한 결과](docs/images/simulator.jpg) |

## 현재 구현과 한계

Phase 1~7: 실시간 관측, 원본 Tag Registry, 이력·분석, Read Tool Agent, 5분 온도 예측, 승인 Simulator, 실패 복구를 구현했습니다. **최신 검증: 질문 5개·경계 상황 6개, 통합 E2E 19개 항목·보안 경계 51개 관측 통과.** 답변 변경 전후와 재검증은 [질문별 검수 결과](docs/results/phase7-agent-answers.md), 기존 접근 통제의 구현 근거는 [보안 보완 결과](docs/results/phase7-security-hardening.md)를 참고하세요. 최초 감사의 발견 사항과 당시 증거는 [원본 감사](docs/results/phase7-security-audit.md)에 보존합니다.

- 50,400행: 2025-03-01 00:00 ~ 2025-04-04 23:59의 과거 공개 데이터입니다.
- 목표 재열기 온도, 측정 단위, 실제 센서 좌표, 산업 안전 임계값은 미확인입니다.
- 검증 MAE로 선택된 선형 모델의 시험 MAE는 0.105784이며 Naive 0.033211보다 나빴습니다. 예측은 실험·평가용입니다.
- 2.5D Scene은 논리적 탐색 지도이며 실제 도면이나 Digital Twin이 아닙니다.
- 기존 소유자 없는 Trace·제안·Audit는 사용자에게 공개하지 않습니다. 임의로 새 계정에 귀속하지 않습니다.

기획: [.project/plan.md](.project/plan.md) · UI: [DESIGN.md](DESIGN.md) · 검수 기록: [접근성](docs/results/phase7-ui-accessibility-review.md).
