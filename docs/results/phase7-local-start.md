# Phase 7 — 한 명령 실행 검증 결과

2026-10-08 23:06 KST, Windows에서 실제 `npm start` 실행과 브라우저 검증 7개 항목을 통과했다. 별도 Kafka 프로젝트 `boiler-ops-start-e2e`, 원본 CSV, 로컬 Ollama, 실제 API·Chromium을 사용했다.

## 사용자가 실행하는 순서

```text
Docker Desktop 켜기 → 프로젝트에서 npm start → 브라우저 로그인
                                                ↓
                              관측 확인 → Enter로 함께 종료
```

`npm start`가 필요한 설정·키·예측 파일 준비와 화면 빌드, Kafka·API·화면·CSV 재생을 묶어서 실행한다. 기존 `.env`와 `.env.security`는 덮어쓰지 않는다. 이미 실행 중이던 Kafka·Ollama도 종료하지 않는다.

## 실제 확인한 결과

| 검증 | 결과 |
| --- | --- |
| 첫 실행 | 개인 키 생성, Kafka 권한 설정, 예측 파일 학습, 화면 빌드, API·화면·재생 시작 |
| 브라우저 | 생성된 개인 키로 로그인, WebSocket 연결, LIVE, 원본 CSV와 센서 값·시각 일치 |
| 중복 실행 | 사용 중인 8000 포트를 안내하고 종료. 기존 API 유지 |
| Enter 종료 | 실행한 프로세스와 새로 시작한 Kafka 종료. 8000·5173·19093 포트 해제 |
| 두 번째 실행 | 설정·키 파일의 바이트와 해시 보존. 먼저 켜 둔 Kafka·Ollama 유지 |
| API 시작 실패 | SQLite 경로를 잘못 지정했을 때 실패 단계·로그 안내. 시작한 Kafka·자식 정리 |
| CSV 누락 | 원본 파일 확인 안내와 실패 종료. 기존 키 보존 |

화면을 일시정지한 뒤 `총 주증기 유량`의 원본 시각 `2025-03-30 18:05`, 표시값 `-0.07`을 CSV와 대조했다. 검증용 개인 키는 로그와 결과에서 제외했으며, 임시 자격 파일과 테스트 컨테이너는 끝에 정리했다.

## 재현과 기록

```powershell
node scripts/check-start.mjs
```

Docker Desktop과 Ollama를 먼저 켜고, 8000·5173·19093 포트를 비워 둔다. 기존 프론트엔드 의존성과 Playwright Chromium이 필요하다. 원본 CSV는 `data/raw/`에서 찾으며, `BOILER_DATASET_PATH`로 별도 지정할 수 있다.

기록 경로는 `artifacts/e2e/phase7/local-start/<실행시각>/`이다.

- `run.json`: 원본 해시, 검증 7개 결과, 실제 센서 대조값, 실행 시간
- `running.jpg`: 로그인 후 실제 관측 화면
- `launcher.log`: 키 원문을 제거한 실행 단계와 종료 안내
- 단계별 `.log`: 빌드·Kafka·API·재생의 성공 및 의도한 실패 기록

사용한 CSV의 SHA-256은 `fb995b76ab26e11f2c66226c9b2aa54388e0c04e41d6ce3a8106cef804cd2419`다. 문서 브라우저 검수와 Python 구문 검사도 통과했다. 기존 통합 E2E 19개·보안 51개는 이전 실행 기록이며 이번에는 실행 도구의 흐름을 별도로 검증했다.

## 검증 범위

- 이 실행은 화면을 빌드해 제공한다. 코드 변경은 재시작 후 반영된다. Vite 개발 서버의 기존 esbuild 파일 접근 오류를 해결했다고 주장하지 않는다.
- 검증에서는 `--no-browser`로 자동 브라우저 열기를 생략하고 Playwright로 실제 화면에 접속했다. 종료는 Enter로 확인했다. Ctrl+C의 운영체제별 전달과 macOS/Linux는 별도 확인이 필요하다.
- 이미 설치된 도구·모델을 사용했다. 새 PC에서의 전체 설치, 최초 대용량 모델 다운로드, 네트워크 단절은 이번 실행에서 검증하지 않았다.
