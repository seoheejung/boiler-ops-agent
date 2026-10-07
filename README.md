# BoilerOps Agent

공개 보일러 운전 CSV를 **Kafka → FastAPI → WebSocket → React**로 재생하고, 선택한 센서의 이력·AI 근거·온도 예측을 확인하는 로컬 프로젝트입니다. Simulator는 사람의 승인 절차를 검증하는 `demo_bias` 상태 머신입니다. 실제 발전설비에 연결하지 않습니다.

[그림으로 보는 프로젝트 지도](https://seoheejung.github.io/boiler-ops-agent/)를 브라우저로 열면 기능별 흐름, 타입·호출 계약, 코드와 검수 결과를 **같은 페이지에서** 읽을 수 있습니다.

## 먼저 화면으로 보기

실제 CSV·Kafka·Ollama를 사용한 로컬 E2E에서 촬영한 화면입니다. 개인 접근 키와 세션 쿠키는 화면에 포함하지 않습니다.

![KPI, 보일러 계통도, 선택한 센서의 Inspector가 표시된 실제 운전 화면](docs/images/dashboard.jpg)

| 로그인 | 제안 검토와 승인 결과 |
| --- | --- |
| ![개인 사용자 ID와 접근 키로 로그인하는 화면](docs/images/login.jpg) | ![로컬 Simulator 제안을 사람이 확인하고 실행한 결과](docs/images/simulator.jpg) |

## 개발 모드로 실행하려면

**화면은 `npm run dev`, API는 Python 개발 서버로 직접 실행합니다.** 이 저장소의 Docker Compose는 Kafka만 실행합니다. 화면·API 코드를 수정할 때 컨테이너를 다시 빌드할 필요가 없습니다.

| 확인하려는 범위 | 필요한 실행 |
| --- | --- |
| 로그인 화면과 프론트엔드 코드 수정 | Node.js·프론트엔드 의존성 설치 후 아래 명령 |
| 로그인·센서·이력·실시간 데이터 | 최초 1~4단계 준비 후 6단계의 API·화면·CSV 재생 |
| AI 답변·예측·승인까지 전체 흐름 | 최초 1~5단계 준비 후 6단계의 세 프로세스 |

화면 개발 서버만 먼저 띄우려면 프로젝트 루트에서 실행합니다. 의존성 설치는 최초 한 번만 필요합니다.

```powershell
npm.cmd ci --prefix frontend
npm.cmd run dev --prefix frontend -- --port 5173 --strictPort
```

**http://127.0.0.1:5173**으로 접속합니다. API를 실행하지 않았다면 로그인과 데이터 조회는 동작하지 않습니다. 실제 데이터로 개발하는 순서는 [6단계 개발 모드 실행](#6-개발-모드로-실행)을 따릅니다. Docker를 전혀 사용하지 않으려면 4단계에 설명한 별도의 개발용 Kafka가 필요합니다. 현재 Kafka를 생략하는 모의 데이터 모드는 없습니다.

## 1. 준비할 것

아래 절차는 **Windows PowerShell**, 프로젝트 루트에서 실행합니다. 현재 프로젝트 경로는 다음과 같습니다.

```powershell
Set-Location 'D:\01_Programming\08_AI\Agent\boiler-ops-agent'
```

| 도구 | 용도 | 설치 확인 명령 |
| --- | --- | --- |
| Python 3.13, uv | API·CSV 재생·예측 | `uv --version` |
| Node.js 22.12 이상 | React 화면·빌드 | `node --version` |
| Docker Desktop + Compose | 로컬 Kafka 실행. 별도 Kafka가 있으면 생략 가능 | `docker compose version` |
| Ollama | 로컬 AI 모델 | `ollama --version` |

Compose로 Kafka를 실행할 경우 **Docker Desktop을 먼저 실행**하고 엔진이 준비될 때까지 기다립니다. 화면만 개발하거나 별도 Kafka에 연결한다면 이 확인을 생략합니다.

```powershell
docker info --format '{{.ServerVersion}}'
```

숫자 버전이 나오면 준비된 것입니다. `dockerDesktopLinuxEngine` 연결 오류가 나오면 Docker Desktop의 실행 상태를 확인합니다.

원본 CSV를 `data/raw/`에 넣습니다. 원본 데이터는 저장소에 포함되지 않습니다. 사용한 파일 이름은 다음과 같습니다.

```text
한국중부발전(주)_(AI 친화 데이터)분 단위 발전설비(보일러) 운전데이터_20250404.csv
```

## 2. 의존성과 기본 설정 준비 — 최초 한 번

```powershell
uv sync --frozen
npm.cmd ci --prefix frontend
if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
}
notepad .env
```

`.env`에서 다음 값을 확인합니다. 경로·파일 이름은 실제 CSV와 일치해야 합니다. 따옴표를 사용하면 공백이 있는 경로도 명확하게 표현할 수 있습니다.

```dotenv
BOILER_DATASET_PATH="data/raw/한국중부발전(주)_(AI 친화 데이터)분 단위 발전설비(보일러) 운전데이터_20250404.csv"
REPLAY_INTERVAL_MS=1000
KAFKA_BOOTSTRAP_SERVERS=127.0.0.1:9092
KAFKA_TOPIC=boiler.telemetry.raw
CSV_ENCODING=utf-8-sig
CSV_TIME_COLUMN=일자
STALE_AFTER_MS=5000
HISTORY_LIMIT=3600
REPLAY_START_ROW=42841
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5-coder:7b
FORECAST_MODEL_PATH=artifacts/models/reheater.json
AGENT_TRACE_DIR=artifacts/agent/traces
SIMULATOR_DB_PATH=artifacts/simulator.sqlite
```

`42841`은 사용한 CSV의 예측 시험 구간 시작 행입니다. 관측만 처음부터 보고 싶다면 `REPLAY_START_ROW=1`로 바꿀 수 있습니다. 학습·검증 cutoff 이전 데이터에 대한 예측 요청은 거부됩니다. 원본 Tag 끝의 공백이나 결측값을 CSV에서 임의로 수정하지 마세요.

## 3. 개인 로그인 키와 Kafka 자격 생성 — 최초 한 번

```powershell
uv run python scripts/setup-security.py --origin http://127.0.0.1:5173
```

다음 두 계정의 **사용자 ID와 개인 접근 키가 한 번만** 터미널에 표시됩니다. 개인 키를 별도로 안전하게 보관합니다.

| 사용자 ID | 권한 | 가능한 작업 |
| --- | --- | --- |
| `operator` | 운영자 | 관측, Agent 조회, 본인 Trace·제안·승인·Audit |
| `viewer` | 조회 | 공통 관측·이력·분석·예측 읽기 |

생성된 `.env.security`에는 접근 키의 SHA-256 해시와 Kafka의 서로 다른 관리자·생산자·소비자 자격이 저장됩니다. 접근 키 원문은 저장하지 않습니다. 이 파일은 Git에서 제외됩니다. **기존 파일이 있으면 명령은 덮어쓰지 않고 중단합니다.** 매번 실행할 필요가 없습니다.

접근 키를 잃었다면 새로운 키와 해시를 발급해 해당 계정의 `key_hash`를 교체하고 API를 재시작해야 합니다. 기존 파일을 삭제해 Kafka 자격까지 무작정 바꾸지 마세요. 예전 `SIMULATOR_APPROVAL_TOKEN`은 더 이상 사용하지 않습니다.

브라우저는 반드시 `http://127.0.0.1:5173`으로 엽니다. `localhost`, 다른 포트, 다른 Origin은 동일한 주소로 취급하지 않습니다. 화면 주소를 바꿀 때는 `.env.security`의 `APP_PUBLIC_ORIGIN`도 함께 바꾸고 API를 재시작합니다.

## 4. Kafka 시작과 Topic 권한 설정

```powershell
docker compose --env-file .env --env-file .env.security up -d --wait kafka
docker compose --env-file .env --env-file .env.security exec -T kafka bash /opt/boiler/admin.sh init-topic boiler.telemetry.raw
```

첫 명령은 Kafka를 시작하고 healthy 상태를 기다립니다. 두 번째는 **단일 partition Topic과 ACL**을 만듭니다. `.env`의 `KAFKA_TOPIC`을 바꿨다면 두 번째 명령의 마지막 이름도 바꿉니다. 두 명령 모두 재실행할 수 있습니다.

```powershell
docker compose --env-file .env --env-file .env.security ps
```

Kafka가 `Up`·`healthy`이면 다음으로 진행합니다. 생산자는 이 Topic에 쓰기만, 소비자는 읽기만 할 수 있습니다. API나 재생 프로세스는 Topic을 자동 생성하지 않습니다.

Kafka 자격은 로컬 SASL 연결용이며 브로커 포트는 `127.0.0.1`에만 열립니다. 원격 브로커에는 인증서 검증이 있는 `SASL_SSL` 설정이 필요합니다. Compose의 현재 설정은 로컬 검증용입니다.

### Docker 없이 이미 준비된 Kafka에 연결할 때

별도로 설치했거나 제공받은 **개발용 Kafka**를 사용한다면 위 Compose 명령을 생략하고 다음 설정을 맞춥니다. 이 저장소에는 Kafka 자체의 네이티브 설치·시작 스크립트가 없습니다.

1. `.env`의 `KAFKA_BOOTSTRAP_SERVERS`와 `KAFKA_TOPIC`을 해당 브로커와 Topic으로 변경합니다. 브로커가 클라이언트에 알려주는 주소도 이 PC에서 접근 가능해야 합니다.
2. 브로커에 단일 partition Topic과 생산자·소비자 ACL이 준비되어 있어야 합니다. 필요한 권한은 `infra/kafka/admin.sh`의 `init-topic` 설정을 기준으로 맞춥니다. API·재생 프로세스가 이를 대신 생성하지 않습니다.
3. 현재 클라이언트의 사용자 이름은 `producer`·`consumer`, 인증 방식은 SASL/PLAIN입니다. `.env.security`의 `KAFKA_PRODUCER_PASSWORD`·`KAFKA_CONSUMER_PASSWORD`를 브로커에 등록된 값과 맞춥니다. 두 값은 각각 32자 이상이어야 합니다. 3단계에서 파일을 생성하는 것만으로 외부 브로커에 계정이 등록되지는 않습니다.
4. 같은 PC의 loopback 브로커는 `KAFKA_SECURITY_PROTOCOL=SASL_PLAINTEXT`를 사용할 수 있습니다. 원격 브로커는 `.env.security`에서 `SASL_SSL`로 변경하고, 사설 인증기관을 사용한다면 `KAFKA_CA_FILE`에 인증서 파일 경로를 지정합니다.
5. 5단계의 모델 준비와 6단계의 로컬 프로세스 실행을 진행합니다. 기존 브로커 연결은 설정에 따라 달라지며, 저장소의 통합 E2E는 Compose Kafka를 기준으로 검증했습니다.

## 5. AI 모델과 예측 모델 준비

Ollama 앱을 실행합니다. 앱 없이 서비스만 시작하려면 **별도 터미널**에서 다음 명령을 실행한 채 둡니다. 이미 Ollama가 실행 중이면 중복 실행하지 않습니다.

```powershell
ollama serve
```

다른 터미널에서 모델을 확인합니다.

```powershell
ollama list
```

목록에 `qwen2.5-coder:7b`가 없을 때만 다운로드합니다. 최초 다운로드와 첫 추론에는 시간이 걸릴 수 있습니다.

```powershell
ollama pull qwen2.5-coder:7b
```

프로젝트 루트에서 온도 예측 모델을 학습합니다.

```powershell
uv run python -m backend.app.forecast.train
```

`artifacts/models/reheater.json`이 생기고 평가 JSON이 출력되면 완료입니다. 다른 CSV를 사용했다면 보고서의 `test_start_row`에 맞춰 `.env`의 `REPLAY_START_ROW`를 조정합니다. 학습은 데이터가 바뀌지 않으면 매번 할 필요가 없습니다.

## 6. 개발 모드로 실행

최초 설정이 끝났다면 Kafka 연결과 Ollama 실행 상태를 확인하고 **PowerShell 터미널 세 개**를 엽니다. 아래 세 프로세스는 개발하는 동안 실행한 채 둡니다. 프론트엔드는 저장 즉시 변경을 반영하고, API는 Python 파일을 저장하면 자동 재시작합니다.

```text
브라우저 :5173 → Vite 개발 서버 → /api HTTP·WebSocket → API :8000
                                                        ↑
CSV 재생 프로세스 → Kafka ────────────────────────────────┘
                                                   API → Ollama :11434
```

### 터미널 A — API 자동 재시작

```powershell
Set-Location 'D:\01_Programming\08_AI\Agent\boiler-ops-agent'
uv run python -m uvicorn backend.app.main:app --reload --reload-dir backend --host 127.0.0.1 --port 8000 --ws-max-size 1024 --ws-max-queue 8 --limit-concurrency 64 --timeout-keep-alive 5
```

`Application startup complete`가 나오면 API 시작이 완료된 것입니다. Kafka 연결 여부는 이후 화면에서 별도로 확인합니다. `--reload --reload-dir backend`는 `backend/`의 Python 변경만 감시하므로 Trace·모델 파일 저장으로 재시작하지 않습니다. 자동 재시작 없이 확인하려면 두 옵션을 빼면 됩니다.

필수 인증 설정이 누락되면 시작하지 않습니다. API는 프로젝트 루트의 `.env.security`와 `.env`를 읽습니다. 인증 키나 환경 파일 내용을 로그에 붙여넣지 마세요.

### 터미널 B — 프론트엔드 개발 서버

```powershell
Set-Location 'D:\01_Programming\08_AI\Agent\boiler-ops-agent'
npm.cmd run dev --prefix frontend -- --port 5173 --strictPort
```

브라우저에서 **http://127.0.0.1:5173**을 열고 3단계의 `operator` 계정으로 로그인합니다. 이 시점에는 아직 재생 전이므로 값이 없거나 STALE일 수 있습니다.

`frontend/` 폴더에서 실행한다면 아래 명령도 같습니다. 두 방식 중 하나만 실행합니다.

```powershell
Set-Location 'D:\01_Programming\08_AI\Agent\boiler-ops-agent\frontend'
npm.cmd run dev -- --port 5173 --strictPort
```

명령은 `npm dev`가 아니라 **`npm run dev`**입니다. PowerShell 실행 정책 오류를 피하려고 위에서는 `npm.cmd`를 사용합니다. 루트에는 `package.json`이 없으므로 루트에서 실행할 때는 `--prefix frontend`가 필요합니다. Vite가 `/api` 요청과 WebSocket을 `127.0.0.1:8000`으로 전달하므로 브라우저에서는 5173 주소를 사용합니다.

### 터미널 C — CSV 재생

```powershell
Set-Location 'D:\01_Programming\08_AI\Agent\boiler-ops-agent'
uv run python -m backend.app.replay.producer
```

`sequence`가 증가하는 JSON 줄이 출력됩니다. 브라우저에서 Kafka·WebSocket이 `CONNECTED`, 관측 상태가 `LIVE`인지 확인합니다. Source Time은 현재 시각이 아니라 **CSV의 과거 시각**입니다.

짧게 관측만 시험하려면 `--limit 16`을 붙일 수 있습니다. 16행이 끝나면 STALE이 됩니다. Agent·승인까지 확인할 때는 모델이 근거를 만드는 동안 재생이 계속되도록 기본 명령을 사용하세요.

### 코드를 바꾼 뒤 확인하는 순서

| 수정 대상 | 반영 방법 |
| --- | --- |
| `frontend/src/`의 화면·스타일 | 저장 후 브라우저에서 확인. 개발 중 `npm run build`를 매번 실행할 필요 없음 |
| `backend/`의 API 코드 | 자동 재시작 로그를 기다린 뒤 브라우저 새로고침·재로그인. 필요하면 CSV 재생도 다시 시작 |
| CSV 재생 코드·설정 | 터미널 C에서 `Ctrl+C` 후 같은 재생 명령을 다시 실행 |
| `.env`·`.env.security` | 자동 감시 대상이 아니므로 API와 CSV 재생을 직접 종료·재실행 |
| `frontend/vite.config.ts` | 터미널 B의 개발 서버를 종료·재실행 |

API가 재시작되면 메모리의 로그인 세션과 관측 상태가 초기화됩니다. 재로그인 후 Kafka·WebSocket이 `CONNECTED`, 관측이 `LIVE`로 돌아오는지 확인합니다. 재생을 다시 시작했다면 이전 run의 근거 대신 새 `Agent 조회` 결과로 제안을 만듭니다. 포트 변경 시에는 3단계의 `APP_PUBLIC_ORIGIN`도 맞춰야 합니다.

## 7. 화면에서 차례로 확인

1. **관측**: 상단 KPI 값과 Sequence가 변하는지 확인합니다. `화면 자동 갱신 일시정지`로 읽는 값을 멈추고, `재개`로 따라잡을 수 있습니다.
2. **센서 탐색**: 설비 버튼이나 센서 목록을 선택합니다. Inspector의 원본 Tag·현재값·Source Time을 확인하고 이력 표와 비교합니다.
3. **예측**: 시험 구간에서 재열기 5분 예측을 확인합니다. 목표 온도는 원본 전체가 결측이므로 임의의 목표나 제어 권고를 표시하지 않습니다.
4. **AI 조회**: 재열기의 `최종재열기 입구 온도 평균값` 센서를 선택하고 `Agent 조회`를 누릅니다. 답변은 결론 → 근거와 원본 시각 → 한계 순서로 표시됩니다. [다섯 질문의 실제 답변과 검수 기록](docs/results/phase7-agent-answers.md)을 참고해 현재값·추이·목표 차이·예측 신뢰도·밸브 조작 가능 여부를 확인하세요. 모델 응답에 따라 수십 초 이상 걸릴 수 있습니다.
5. **제안**: 재열기 조회가 성공한 뒤 `Agent Simulator 제안 생성`을 누릅니다. 로컬 데모 변경 의도를 입력할 수 있습니다. 이때 Simulator 값은 아직 바뀌지 않아야 합니다.
6. **승인**: 기존값·요청값·Revision·만료 시각을 확인하고 확인 체크박스를 선택합니다. `승인 및 Simulator 실행`을 누르면 실행 결과, 새 값, Audit가 표시됩니다. `거절`하면 값은 유지됩니다.
7. **다음 제안**: 같은 Trace는 한 번만 사용합니다. 새 제안 전에는 `Agent 조회`를 다시 실행합니다. 오래된 근거, 다른 재생 세션의 근거, 다른 사용자 기록은 거부됩니다.
8. **로그아웃**: 상단의 계정·로그아웃 버튼을 누릅니다. 세션은 기본 30분이며 API 재시작 시 다시 로그인해야 합니다.

Trace·Audit 링크는 인증된 JSON 확인용입니다. 설명·평가·소스 코드는 [프로젝트 지도](docs/index.html)의 상세 보기에서 서식이 있는 문서로 읽을 수 있습니다.

## 8. 종료와 다음 실행

재생 → 화면 → API 순서로 각 터미널에서 `Ctrl+C`를 누릅니다. 이 프로젝트의 Kafka도 종료하려면 다음 명령을 사용합니다.

```powershell
docker compose --env-file .env --env-file .env.security stop kafka
```

다음 실행은 **4단계 Kafka 시작 → 5단계 Ollama 실행 확인 → 6단계 세 터미널**만 진행하면 됩니다. 개인 키 생성, 의존성 설치, 모델 다운로드·학습을 매번 반복하지 않습니다.

`stop`은 컨테이너를 보존합니다. `down`이나 컨테이너 교체는 현재 구성에서 Kafka 재생 데이터를 잃을 수 있습니다. API의 Simulator DB·Trace·예측 모델은 로컬 `artifacts/` 경로에 남습니다. Kafka의 오래된 재생 시작 이벤트가 보관 기간을 지나 사라졌다면 CSV 생산자를 다시 시작해 새로운 run을 만듭니다.

## 9. 막힐 때 확인할 곳

| 증상 | 확인·해결 |
| --- | --- |
| Python/Node 명령을 찾지 못함 | 도구 설치 후 새 터미널을 열고 1단계 버전 확인 |
| CSV 파일 없음 | `.env`의 경로, 현재 폴더, 파일 이름 확인 |
| `.env.security already exists` | 이미 발급된 키 사용. 재실행 시 생성 단계 생략 |
| 로그인 HTTP 403 | 주소가 `APP_PUBLIC_ORIGIN`과 정확히 일치하는지 확인 |
| 로그인 HTTP 401 | 사용자 ID와 개인 접근 키 확인. API 재시작 후 다시 로그인 |
| 로그인·모델 HTTP 429 | 요청·세션·모델 한도. 중복 요청을 멈추고 잠시 후 재시도 |
| 포트가 이미 사용 중 | 기존 본인 서버 상태 확인. 임의로 다른 프로젝트를 종료하지 않기 |
| Kafka DISCONNECTED | Docker healthy, SASL 자격, 4단계 Topic·ACL 설정 확인 |
| Sequence가 안 오름 | 재생 터미널 오류, CSV 설정, Kafka 권한 확인 |
| 관측 STALE | 재생이 끝났거나 중단됨. API가 있어도 새 데이터가 없으면 STALE |
| 예측 모델 없음 / cutoff 오류 | 5단계 학습 및 `REPLAY_START_ROW` 확인 |
| Agent HTTP 503 | Ollama 실행, 모델 설치, 실패 Trace의 도구 오류 확인 |
| 제안·승인 HTTP 409 | LIVE 상태에서 같은 재생 세션의 새 재열기 Agent 근거로 다시 제안 |
| HTTP 507 | Trace·제안·Audit 보관 한도 도달. 서비스 중지 후 백업·보관 정책에 따라 처리. Audit 자동 삭제 안 함 |
| `tsc`를 찾지 못함 | 루트에서 `npm.cmd ci --prefix frontend` 실행 |

세션·요청·모델 한도는 **단일 API 프로세스 기준**입니다. 여러 worker를 실행하지 않습니다. 외부 배포 전에는 공유 세션·한도 저장소, TLS 프록시, 계정 운영·비밀 교체·보관 정책을 별도로 설계해야 합니다.

## 10. 변경을 다시 검증하기

Docker Desktop과 Ollama를 준비합니다. E2E는 설치된 모델을 사용하며 자동 다운로드하지 않습니다. 한 번만 브라우저를 설치합니다.

```powershell
npm.cmd run build --prefix frontend
Set-Location frontend
npx.cmd playwright install chromium
Set-Location ..
$env:E2E_PHASE = 'phase7'
$env:E2E_FRONTEND_PORT = '4176'
node scripts/e2e.mjs
```

8000·4176·19092 포트가 비어 있어야 합니다. E2E는 별도 Compose 프로젝트 `boiler-ops-security-e2e`와 임시 자격을 만들고 실제 CSV·Kafka·Ollama·Chromium·SQLite를 검사합니다. Kafka 중단·복구는 이 테스트용 컨테이너에만 적용합니다. 종료 시 시작한 프로세스와 테스트 컨테이너를 정리합니다.

입력 해시, 원본 대조, WebSocket 기록, 실패 경로, 승인 Audit, 차단 결과와 화면 캡처는 `artifacts/e2e/phase7/`에 남습니다. 실행 요약은 `run.json`, 보안 경계 검증은 `security-review/boundaries.json`을 확인합니다. 저장소에는 문서에 필요한 화면을 압축 JPEG로 포함합니다.

질문별 답변만 검수하려면 같은 준비 상태에서 다음 명령을 실행합니다. 위 통합 E2E와 동시에 실행하지 않습니다.

```powershell
$env:E2E_AGENT_REVIEW = 'improved'
node scripts/e2e.mjs
Remove-Item Env:E2E_AGENT_REVIEW
```

`artifacts/e2e/phase7/agent-review/improved/questions.json`에 질문별 도구·근거·답변·처리 시간과 결측·이력 부족 등 경계 상황을 저장합니다. 데스크톱·모바일 답변 캡처도 같은 폴더에 남습니다. 변경 전 `baseline/questions.json`이 있으면 비교하고, 없으면 현재 답변을 독립 검증합니다. 현재 코드에서 `baseline` 모드를 실행하면 현재 코드의 관측 기록이므로 과거 결과를 재현한 것으로 취급하지 않습니다.

```powershell
uv run python scripts/build-guide.py
node scripts/review-ui.mjs
```

문서 코드·결과를 수정했다면 첫 명령으로 브라우저 내 상세 보기 데이터를 갱신하고 두 번째로 문서 메뉴·링크·모바일·키보드를 확인합니다. 실제 NVDA·VoiceOver 낭독 검수는 별도 작업입니다.

## 현재 구현과 한계

Phase 1~7: 실시간 관측, 원본 Tag Registry, 이력·분석, Read Tool Agent, 5분 온도 예측, 승인 Simulator, 실패 복구를 구현했습니다. **최신 검증: 질문 5개·경계 상황 6개, 통합 E2E 19개 항목·보안 경계 51개 관측 통과.** 답변 변경 전후와 재검증은 [질문별 검수 결과](docs/results/phase7-agent-answers.md), 기존 접근 통제의 구현 근거는 [보안 보완 결과](docs/results/phase7-security-hardening.md)를 참고하세요. 최초 감사의 발견 사항과 당시 증거는 [원본 감사](docs/results/phase7-security-audit.md)에 보존합니다.

- 50,400행: 2025-03-01 00:00 ~ 2025-04-04 23:59의 과거 공개 데이터입니다.
- 목표 재열기 온도, 측정 단위, 실제 센서 좌표, 산업 안전 임계값은 미확인입니다.
- 검증 MAE로 선택된 선형 모델의 시험 MAE는 0.105784이며 Naive 0.033211보다 나빴습니다. 예측은 실험·평가용입니다.
- 2.5D Scene은 논리적 탐색 지도이며 실제 도면이나 Digital Twin이 아닙니다.
- 기존 소유자 없는 Trace·제안·Audit는 사용자에게 공개하지 않습니다. 임의로 새 계정에 귀속하지 않습니다.

기획: [.project/plan.md](.project/plan.md) · UI: [DESIGN.md](DESIGN.md) · 검수 기록: [접근성](docs/results/phase7-ui-accessibility-review.md).
