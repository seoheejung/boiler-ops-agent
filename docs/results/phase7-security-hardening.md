# Phase 7 보안 보완 결과

2026-10-05 23:33 KST 최종 통합 E2E 통과. 실제 공개 CSV, Kafka 3.9.1, FastAPI, Ollama qwen2.5-coder:7b, Chromium, SQLite를 사용했다. **통합 19개 항목과 보안 경계 50개 관측이 통과**했다. 의존성·lock은 변경하지 않았다.

## 1. Vulnerability Summary

최초 감사 11건 중 사용자가 지정한 여섯 묶음은 SEC-01~07에 해당한다. 아래 재현 경로를 차단했고, 추가로 브라우저 framing/cache 정책도 보완했다. 이 결과는 단일 프로세스·loopback의 현재 실행 구성에 대한 검증이다.

| 최초 심각도 | 요청 범위 | 수정·재현 결과 |
| --- | --- | --- |
| High | SEC-01~05 · 5건 | 조회·WS·자원 한도·Kafka·공유 승인 자격 경계 보완 및 E2E 통과 |
| Medium | SEC-06~07 · 2건 | 익명 제안·근거 재사용 경계 보완 및 E2E 통과 |
| 추가 보완 | SEC-09~11 일부 | 모델 redirect/proxy 차단, framing/cache 헤더, 자격 입력값 반사 제거 |
| 잔여 제약 | SEC-08 및 조건부 위험 | 로컬 저장소 변조 탐지, 운영 호스트 격리·비밀 교체, 배포 구성은 별도 검증 필요 |

최초 심각도와 공격 가정은 [최초 감사](phase7-security-audit.md)에 보존한다. 검증하지 않은 배포 환경에 대해 전체 취약점이 없다고 판정하지 않는다.

## 2. Detailed Findings — 수정과 재검증

| 발견 | 영향 구성 요소 | 적용한 수정 | 실제 확인 |
| --- | --- | --- | --- |
| SEC-01 · High: 익명 조회·Trace·Audit | HTTP API, 파일, SQLite | HttpOnly 만료 세션; Trace·제안·Audit의 owner 검사; 소유자 없는 legacy 기록 비공개 | 익명 401, 다른 사용자 Trace·결정 404, 타인 목록·Audit 빈 배열 |
| SEC-02 · High: 교차 출처 WS | WebSocket | 정확한 Origin, Host, 세션; 만료·로그아웃 중 열린 연결 회수 | 같은 IP의 다른 Origin에서도 연결 거부; 익명 거부; 회수 close 1008 |
| SEC-03 · High: 무제한 자원 소비 | 모델·HTTP·WS·Trace·DB·Kafka | 요청/크기/작업/연결/저장 한도; 취소되어도 모델 thread 종료까지 slot 유지; 저장량 초과 시 실패 | 14개 동시 모델 요청에서 최대 2개 실행; 초과 429; 연결 초과 거부; Trace·Audit 용량 507 |
| SEC-04 · High: 위조 입력·run 교체 | Kafka, Consumer, 상태 | 관리자·생산자·소비자 SASL 및 ACL; 수신 크기·UUID·시각 검사; emitted_at 역행과 미래 이벤트 거부 | 무자격 쓰기, consumer 쓰기, producer 읽기 거부; 캡처한 이전 run 재전송 후 최신 run 유지 |
| SEC-05 · High: 공유 승인 자격 | Simulator 결정 | 공유 Bearer 제거; 개인 operator 역할·본인 제안·명시적 확인; 개인 user_id Audit | viewer 결정 403; 다른 operator 결정 404; 정상 승인·거절·동시 승인·revision 검사 통과 |
| SEC-06 · Medium: 익명 제안 생성 | 제안·모델 | operator와 본인 Trace 필요; 생성·조회 소유권 분리 | 익명 401, viewer 모델 403, 다른 사용자 근거 404 |
| SEC-07 · Medium: 오래된 근거 재사용 | Trace·제안·결정 | 생성 시각 최대 5분, LIVE 상태, 관측 시각, 선택 Tag, 같은 run, 원자적 단일 사용; 승인 때 재검증 | 만료/STALE/실패/다른 Tag 409; 동일 근거 동시 제안은 200 한 건·409 한 건; run 변경 후 승인 409 |

제안은 로컬 `demo_bias`만 변경한다. 기존 정책(−10~10, 한 번에 최대 1), 확인·revision·만료·중복 결정 방지는 유지했다. 승인·거절 API에 요청값을 덧붙이는 대량 할당은 422로 차단한다.

### 현재 한도

| 자원 | 한도·동작 |
| --- | --- |
| 세션 | 기본 30분, 설정 60~3600초; 사용자 5개·전체 100개; 서버 재시작 시 재로그인 |
| 계정 | 최대 50개, viewer/operator; 서로 다른 고엔트로피 개인 키의 해시 |
| HTTP | IP 분당 600회, 사용자 분당 480회, 로그인 IP 분당 10회 |
| 요청 본문 | 8 KiB, 읽기 제한 시간 5초 |
| 모델 | 전역 동시 2개, 사용자 분당 12회; 호출 timeout 180초, 응답 256 KiB |
| WS | 사용자 4개·전체 32개; 사용자 메시지 분당 30회, 앱 메시지 1 KiB |
| 서버 실행 | README의 Uvicorn 동시 요청 64, WS frame 1 KiB·queue 8, keep-alive 5초 |
| Trace | 최대 1,000개·64 MiB, 개별 256 KiB; 동시 저장 예약 후 검사 |
| Simulator | 제안 1,000개, Audit 5,000행; 초과하면 507, 자동 삭제 없음 |
| Audit 조회 | 기본 50행, 최대 100행; after_id로 다음 페이지 |
| Kafka | 단일 partition; 레코드 64 KiB; 보관 설정 24시간·64 MiB, segment 16 MiB |

Kafka 보관량은 segment 회전·삭제 주기에 따른 설정 목표이며 정확한 디스크 hard quota가 아니다. 컨테이너 로그와 호스트 전체 디스크의 운영 quota는 별도 구성 대상이다.

## 3. Attack Chains — 차단 결과

1. **익명 Audit → Trace 수집 → 재제안 → 타인 결정**: 첫 조회부터 401. 다른 계정을 가진 경우에도 소유권 검사로 Trace·결정을 404 처리한다.
2. **악성 페이지 → 피해자 세션을 이용한 WS 수신/변경**: 같은 사이트의 다른 Origin도 정확한 Origin 검사에서 거부한다. 쿠키는 HttpOnly·SameSite Strict이며 HTTPS Origin에서는 Secure가 설정된다. 로그아웃/만료 시 이미 열린 WS도 닫힌다.
3. **재사용 Trace → 동시 제안 → 중복 승인**: used_evidence의 고유 키와 SQLite 트랜잭션으로 한 제안만 저장한다. 결정 상태·revision·기존값 검증으로 한 변경만 실행한다.
4. **Kafka consumer 자격 → 위조 쓰기 → 재생 세션 교체**: Topic Write ACL이 없어 거부한다. 실제 생산자 자격으로 과거 이벤트를 다시 보내도 emitted_at 역행 검사가 현재 run의 교체를 거부한다.
5. **로그인 사용자 → 모델 burst → 저장소 고갈**: 동시 작업·빈도·연결·저장 한도로 증가를 제한한다. 용량이 차면 감사 기록을 지우지 않고 507로 중단한다.

## 4. Secure Design Recommendations — 남은 운영 경계

- **단일 로컬 프로세스**: 세션·요청 한도·연결 수·Trace 예약은 프로세스 메모리 기준이다. 여러 worker 또는 서버에서는 공유 세션·한도·작업 조정 계층이 필요하다. 현재 README는 단일 worker로 실행한다.
- **자격과 호스트 격리**: 각 Kafka 연결은 최소 권한 principal을 사용하지만, 로컬 설정 파일은 한 개발 호스트에 함께 있다. 호스트/파일 읽기 권한을 탈취하면 자격을 가져갈 수 있다. 운영에서는 프로세스별 비밀 배포와 OS 권한·키 교체 절차가 필요하다.
- **신뢰한 생산자**: 올바른 생산자 자격으로 새 emitted_at과 새 run을 만든 입력까지 원본 CSV와 암호학적으로 대조하지 않는다. 생산자 자격 탈취와 호스트 침해는 잔여 신뢰 경계다. Kafka run 연속성의 완전한 내구성 checkpoint도 구현하지 않았다.
- **보존·무결성**: DB/Trace/모델 파일을 쓸 수 있는 OS 공격자에 대한 서명·변조 탐지·불변 감사 저장소는 없다. 용량 초과는 fail-closed이며, 백업·승인된 보관·정리 절차를 운영에서 정해야 한다. legacy 기록은 임의로 새 사용자에게 귀속하지 않는다.
- **TLS와 배포**: 로컬 Kafka만 SASL_PLAINTEXT를 허용한다. 원격 Kafka는 SASL_SSL과 인증서 검증이 필요하다. 외부 UI/API는 HTTPS·프록시 Host/Origin·HSTS/CSP·본문/연결 한도를 별도로 검증해야 한다. 이번에 배포하지 않았다.
- **모델 경계**: Ollama는 loopback HTTP만 허용하고 환경 proxy와 redirect를 사용하지 않도록 보완했다. 실제 모델 경로는 E2E로 확인했지만 악성 redirect 서버·OS 네트워크 격리의 전수 시험은 하지 않았다.
- **오류·관측성**: 로그인 유효성 오류는 접근 키 원문을 반환하지 않는다. 다른 서비스의 상세 실패 Trace·예외에는 내부 경로 등이 남을 수 있으므로 인증 사용자에게만 공개한다. 외부 배포 전 오류 식별자·서버 로그 분리를 더 보완해야 한다.
- **승인 정책**: operator는 자신의 제안을 승인한다. 2인 승인, 조직별 권한·외부 IdP·계정 회수 UI는 현재 구현 범위가 아니다.

## 재현과 아티팩트

[README](../../README.md)의 준비와 실행 순서를 사용한다. 테스트는 기존 `.env`·개인 자격 파일을 덮어쓰지 않고 테스트 키를 메모리에서 만든다.

```powershell
npm.cmd run build --prefix frontend
$env:E2E_PHASE = 'phase7'
$env:E2E_FRONTEND_PORT = '4176'
node scripts/e2e.mjs
uv run python scripts/build-guide.py
node scripts/review-ui.mjs
```

- `artifacts/e2e/phase7/run.json`: 통합 19개 통과, 종료 `2026-10-05T14:33:21.183Z`.
- `security-review/boundaries.json`: 기대값/실측값을 가진 보안 관측 50개 통과.
- `safety-counters.json`, `final-audit.json`: 실패·경합 검증의 무승인 변경 0, 승인 우회 0, 거절 후 실행 0, 실행 Trace 연결 100%.
- `input.json`, `telemetry.jsonl`: 실제 CSV 입력 해시·16행의 원본 Tag·값·시각 대조.
- `ui-review/`: 앱과 문서의 320~1440px 관측, 키보드 검사, 접근성 트리·PNG. 실제 NVDA/VoiceOver 낭독은 미검증.
- `docs/images/`: README용 실제 화면 3장, 압축 JPEG 합계 약 189 KiB. 비밀값 제외.

TypeScript/Vite 빌드 통과. R3F가 포함된 약 1.14 MB JS chunk 경고는 남는다. 새로운 패키지·lock 변경, Push, 프로덕션 배포는 수행하지 않았다.
