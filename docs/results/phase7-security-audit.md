# Phase 7 적대적 환경 보안 감사

기준일: 2026-10-05. 대상: 현재 저장소의 Frontend, FastAPI, Kafka 수신, Ollama 연동, SQLite, Trace/모델 파일, 실행 구성과 고정 의존성.

이 프로젝트는 로컬 공개 데이터 데모로 구현되어 있다. 이 보고서는 사용자의 요청대로 **동기부여된 공격자가 접근할 수 있는 외부 배포 환경**을 가정한다. 현재 README의 loopback 실행과 Kafka의 `127.0.0.1` 바인딩은 원격 공격 노출을 줄인다. 보고서의 High가 현재 인터넷에서 즉시 공격 가능하다는 뜻은 아니다. 실제 발전설비 제어 연결은 없으며 영향은 관측·AI·로컬 Simulator에 한정된다.

보안 아키텍처 변경은 이번에 구현하지 않았다. 화면 수정과 구분해 취약점, 재현 근거, 수정 설계를 기록했다. 전체 취약점의 부재를 증명하는 완전 탐색이나 침투시험 인증은 아니다.

## 1. Vulnerability Summary

| 심각도 | 건수 | 범위 |
| --- | ---: | --- |
| Critical | 0 | RCE·실제 설비 제어 탈취는 확인하지 못함 |
| High | 5 | 데이터 접근 통제, WebSocket, 자원 고갈, Kafka 신뢰, 공유 승인 자격 |
| Medium | 5 | 제안 오염, 근거 재사용, 저장소 무결성, 모델 egress, 브라우저 보호 |
| Low | 1 | 상세 오류 노출 |
| 합계 | 11 | 코드에서 확인한 결함·설계 위험 9건 + 전제 조건이 필요한 잠재위험 2건(SEC-08/09) |

| ID | 제목 | 심각도 | 확인 수준 |
| --- | --- | --- | --- |
| SEC-01 | 조회·Trace·Audit의 무인증 노출과 객체 권한 부재 | High | 코드 + 실제 HTTP 재현 |
| SEC-02 | WebSocket 인증·Origin 검사 부재 | High | 코드 + 실제 브라우저 교차 출처 재현 |
| SEC-03 | 무제한 모델 작업·연결·영구 저장을 통한 자원 고갈 | High | 코드 확인, 부하 공격 미실행 |
| SEC-04 | Kafka 입력의 생산자 인증 부재와 run 교체 악용 | High | 구성·코드 확인, 브로커 접근 전제 |
| SEC-05 | 장기 공유 Bearer 자격의 전체 승인 권한과 재사용 | High | 코드 확인, 자격 획득/정당한 보유 전제 |
| SEC-06 | 무인증 제안 생성으로 승인 목록 오염·검토 방해 | Medium | 코드 + 실제 HTTP 재현 |
| SEC-07 | 성공 Trace의 무기한 재사용과 현재 문맥 미결합 | Medium | 코드 + 동일 Trace 재사용 재현 |
| SEC-08 | Trace·모델·Audit의 변조 탐지 및 보존 경계 부족 | Medium | 잠재위험, 파일 쓰기/백업 유출 전제 |
| SEC-09 | 로컬 모델 URL 검사 뒤 redirect·proxy egress 미통제 | Medium | 잠재위험, 로컬 서비스/실행 환경 통제 전제 |
| SEC-10 | 승인 UI framing·민감 응답 cache 정책 부재 | Medium | 코드·응답 헤더 확인 |
| SEC-11 | 내부 예외와 입력 내용의 API 오류 노출 | Low | 코드 확인 |

### 위협 모델

| 공격자 | 진입점 | 목표와 가능한 행동 |
| --- | --- | --- |
| 익명 사용자/API 소비자 | HTTP, WebSocket, 공개 OpenAPI | 관측·질문·제안 수집, 모델 실행과 저장 공간 소모 |
| 악성 사이트 운영자 | 피해자 브라우저의 WebSocket, iframe | 교차 출처 데이터 수집, 승인 화면 조작 유도 |
| 승인 자격 보유자/탈취자 | decision API | 다른 사람의 제안 승인·거절, 사용자 사칭 |
| 로컬 내부자/같은 호스트의 프로세스 | Kafka loopback, 파일, SQLite, Ollama | 데이터 위조, 증거 변경, 서비스 교체 |
| 의존성/모델 공급망 공격자 | 설치 스크립트, 컨테이너 이미지, 모델 응답 | 코드 실행 권한 또는 모델 응답·환경 영향 획득. 실제 침해 확인 없음 |

민감 자산: 승인 토큰, 사용자 질문·의도, 관측값의 무결성, 성공 Trace, proposal/revision, SQLite Audit, 모델 보고서, CPU/GPU/메모리/디스크. 원본 CSV가 공개 데이터라는 이유로 사용자의 질문이나 승인 이력까지 공개 자산이 되지는 않는다.

신뢰 경계: 브라우저↔API, HTTP↔WebSocket 업그레이드, Kafka 생산자↔Consumer, API↔Ollama, 모델 출력↔허용된 도구, API↔SQLite/파일, 저장소↔실행 환경. 사용자·테넌트 식별자가 없어 수평 권한 경계 자체가 구현되어 있지 않다.

## 2. Detailed Findings

### SEC-01 — 조회·Trace·Audit 무인증 노출

- **심각도:** High. **컴포넌트:** [main.py](../../backend/app/main.py)의 health/state/registry/history/analysis/forecast/tools/trace/simulator/audit 라우트.
- **설명:** 읽기 라우트에 인증 dependency나 사용자별 자원 권한 검사가 없다. `/api/health`도 최소 liveness 대신 전체 snapshot을 반환한다. UUID는 조회 권한을 대신하지 못한다. Audit와 제안 목록에서 `source_trace_id`를 찾을 수 있다.
- **공격 순서:** ① 무자격으로 `/api/simulator/audit` 또는 `/api/simulator` 조회 → ② 공개된 source_trace_id 선택 → ③ `/api/agent/traces/{id}` 조회 → ④ 원래 질문, 도구 결과, 근거와 오류 정보 수집. state/history/tools에서도 인증 없이 관측값 수집 가능.
- **영향:** 다른 사용자의 의도·운영 문맥 노출, 제안 공격에 사용할 식별자 확보. 실제 UUID 전수 탐색은 필요하지 않다.
- **권장 수정:** 모든 읽기 경계에 인증, 역할·설비·Trace/제안 소유권 검사. health를 최소 응답으로 분리하고 권한 있는 진단 API를 별도로 설계. Trace/Audit에 필요한 필드만 반환.

### SEC-02 — WebSocket 인증·Origin 검사 부재

- **심각도:** High. **컴포넌트:** [main.py](../../backend/app/main.py)의 `websocket`, [hub.py](../../backend/app/websocket/hub.py).
- **설명:** `/api/ws`는 `ws.accept()`부터 실행하며 인증과 Origin allowlist 검사를 하지 않는다. HTTP 응답에 CORS 허용 헤더가 없다는 사실은 WebSocket 보호 근거가 아니다. 현재는 세션 탈취보다 **무인증 교차 출처 읽기**가 정확한 표현이다.
- **공격 순서:** ① 서비스에 네트워크로 접근할 수 있는 브라우저에서 다른 Origin의 페이지 방문 → ② `new WebSocket(...)` 생성 → ③ initial snapshot과 이후 telemetry 읽기. 연결 수 제한 부재와 결합하면 지속적인 자원 소모 가능.
- **영향:** 악성 사이트가 실시간 관측 데이터 수집. 브라우저의 mixed-content·Private Network Access 정책에 따라 공용 사이트→loopback 공격 가능성은 달라진다. 로컬 서로 다른 포트의 실제 Origin 경계를 검증 대상으로 삼았다.
- **권장 수정:** accept 전 신원·설비 권한·정확한 Origin allowlist 검사, WSS, 연결 한도·세션 만료 재검증. DNS rebinding 방어를 위한 Host 검증도 별도 적용. [OWASP WebSocket 지침](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)

### SEC-03 — 무제한 작업·연결·저장에 의한 DoS

- **심각도:** High. **컴포넌트:** main.py의 `asyncio.to_thread`, [agent/service.py](../../backend/app/agent/service.py), simulator `audit_log`, Hub 구독.
- **설명:** Agent/proposal 요청은 인증·사용자별 rate limit·bounded admission queue 없이 모델 작업으로 전달된다. 모델 호출은 최대 180초를 기다리며 HTTP 클라이언트가 떠나도 thread 작업 취소를 보장하지 않는다. 성공/실패 Agent 요청이 각각 Trace 파일을 남긴다. 제안과 Audit 보존 한도가 없고 audit_log는 전체 테이블을 동기 읽기·역직렬화한다. 연결별 큐 128개는 전체 연결 수의 상한이 아니다.
- **공격 순서:** ① 유효한 equipment로 모델 요청 반복 → ② GPU·executor 대기열·파일 증가 → ③ 누적된 `/api/simulator/audit`를 반복 조회하거나 WebSocket 연결을 유지 → ④ 이벤트 루프·메모리·디스크 압박으로 정상 관측/승인 지연.
- **영향:** 서비스 가용성 저하와 저장 실패. 실제 자원 고갈량·초당 임계치는 측정하지 않았으며 대량 공격은 실행하지 않았다.
- **권장 수정:** 인증 전·후 요청 크기와 속도 한도, 전체/사용자별 모델 동시 작업·대기열 상한과 429, 취소 가능한 작업 수명, Trace/제안 보존 정책, Audit 페이지네이션·비동기 I/O, WebSocket 세션 상한.

### SEC-04 — Kafka 생산자 신뢰와 새 run 교체 악용

- **심각도:** High. **컴포넌트:** [docker-compose.yml](../../docker-compose.yml), [consumer.py](../../backend/app/streaming/consumer.py), [state.py](../../backend/app/domain/state.py).
- **설명:** Kafka PLAINTEXT 구성과 클라이언트에 SASL/TLS/ACL이 없다. `apply`는 새 문자열 run_id와 sequence=1이면 기존 run을 retire하고 이력을 비운다. 정상 재생을 지원하는 이 전환에 생산자 신원·허용된 세션 확인이 없다. `retired_runs` 집합도 상한이 없다.
- **공격 순서:** ① 동일 호스트/컨테이너 네트워크 또는 잘못 노출된 broker에 접근 → ② registry에 맞는 Tag 집합과 새 run_id, sequence=1, 문자열 수치를 발행 → ③ 위조 관측값 채택·실제 run retire → ④ 정상 생산자의 후속 이벤트 거부. 새 run을 반복하면 retired_runs와 오류 로그도 증가.
- **영향:** 화면·분석·예측·Agent 근거 오염과 정상 재생 방해. 인증된 제어 명령이나 실제 설비 쓰기가 생기는 것은 아니다.
- **권장 수정:** 생산자/소비자 계정 분리, SASL/TLS 및 Topic ACL, 네트워크 격리, 허가된 재생 세션을 서버가 관리. run 종료/전환·retired 집합 보존 정책 설계. 현재 loopback 바인딩은 유지. [Kafka 보안 기능](https://kafka.apache.org/39/security/)

### SEC-05 — 공유 승인 자격의 장기 전체 권한

- **심각도:** High. **컴포넌트:** simulator `authenticate`/`decide`, [SimulatorPanel.tsx](../../frontend/src/SimulatorPanel.tsx), 로컬 HTTP 실행 가이드.
- **설명:** 최소 길이의 공유 Bearer 문자열만 검증한다. 사용자/역할/제안 소유권/자격 만료·개별 폐기가 없고 actor는 항상 `authenticated-local-operator`다. 임의성을 강제하지 않아 반복 문자 32개도 설정 가능하다. 단일 로컬 데모의 설계가 적대적 다중 사용자 환경에서는 권한 경계를 제공하지 못한다.
- **공격 순서:** ① 공유 자격을 정당하게 받거나 별도 경로로 탈취 → ② 공개 목록의 pending 제안·revision 조회 → ③ UI를 거치지 않고 confirm=true로 승인/거절 → ④ 같은 자격을 다른 제안에도 재사용. HTTP를 외부에 그대로 노출하면 네트워크 공격자가 자격을 관측할 수 있다는 추가 전제가 생긴다.
- **영향:** 다른 사용자의 Simulator 제안까지 결정, 행위자 추적·선별적 철회 불가. 완료된 동일 제안을 재실행하는 공격은 revision/status 검사로 차단된다.
- **권장 수정:** 사용자 인증과 제안별 권한, 짧은 수명의 제한된 승인 자격·실제 actor 기록, TLS, 자격 회전·폐기, 중요한 승인 재인증. 체크박스는 서버가 신뢰할 수 있는 신원 증거가 아님.

### SEC-06 — 무인증 제안으로 검토 목록 오염

- **심각도:** Medium. **컴포넌트:** `/api/simulator/proposals`, Simulator.snapshot, SimulatorPanel의 `state?.proposals[0]`.
- **설명:** proposal 생성은 쓰기임에도 인증이 없다. 성공한 재열기 Trace만 있으면 새 제안과 Audit를 영구 저장한다. 최근 20개는 전역 목록이며 화면은 최신 한 개를 승인 대상으로 보여준다.
- **공격 순서:** ① SEC-01로 기존 성공 Trace 확보 → ② 변경 의도를 넣어 제안을 반복 생성 → ③ 정상 제안이 목록 뒤로 밀림 → ④ 사용자가 새로고침하면 공격자가 만든 최신 제안이 검토 대상으로 표시됨.
- **영향:** 승인 업무 방해와 혼동·사회공학. 자동 실행이나 토큰 없는 승인 우회는 확인되지 않았다. 현재 UI는 기존값/요청값을 표시하므로 사람이 검토할 기회가 있다.
- **권장 수정:** 생성 권한과 사용자별 목록, 선택한 proposal_id 고정, 요청자·근거·의도·시각 명시, 생성 한도. 서버 결정은 사용자가 검토한 제안과 결합.

### SEC-07 — 승인 근거의 재사용·문맥 불일치

- **심각도:** Medium. **컴포넌트:** Simulator.propose, App의 agentTrace, AgentPanel.
- **설명:** Trace에 response가 있고 equipment가 reheater인지 확인할 뿐 생성 시각·run_id·선택 센서·사용자·STALE 상태와 현재 관측 문맥의 일치는 확인하지 않는다. 제안의 5분 TTL은 **새 제안**의 수명이며 원본 Trace의 수명을 제한하지 않는다. UI도 같은 설비 안에서 센서를 변경할 때 기존 답변/trace가 남을 수 있다.
- **공격 순서:** ① 과거 성공 Trace ID 보유 → ② 재생 세션이 바뀌거나 오래 지난 뒤 같은 ID로 새 제안 생성 → ③ 새 TTL을 받은 제안에 오래된 근거 연결 → ④ 사용자가 현재 문맥의 권고로 오해해 승인.
- **영향:** 데이터와 변경 의사결정의 근거 불일치. 값 범위·revision·일회성 결정 검사는 유지되며 물리적 제어 효과가 발생하지 않는다.
- **권장 수정:** 근거에 사용자·설비·Tag·run/sequence·생성 시각을 묶고 허용 신선도와 상태 정책을 적용. 센서/질문 변경 시 UI 근거 무효화. 새 제안 TTL과 원본 근거 유효기간을 별도 검증.

### SEC-08 — 파일·Audit의 변조 탐지/보존 경계 부족 (잠재위험)

- **심각도:** Medium. **컴포넌트:** Trace JSON, 예측 JSON, SQLite 파일.
- **설명:** Trace 원문에 question과 전체 도구 결과를 평문 저장한다. 애플리케이션에서 ACL·보존/삭제·무결성 검증을 강제하지 않는다. 모델 파일의 dataset_sha256는 반환하지만 현재 입력 데이터와 대조하지 않는다. Audit는 같은 SQLite 파일의 수정 가능한 행이다.
- **공격 순서:** ① 별도 경로로 artifact 쓰기 권한 또는 부적절하게 공개된 백업 확보 → ② Trace의 success/equipment 내용이나 모델 계수·cutoff, 과거 Audit 변경 → ③ 서비스가 이를 신뢰하거나 감사자가 조작된 이력을 읽음. 백업 읽기만 가능해도 사용자 질문 노출 가능.
- **영향:** 증거 위조·예측 오염·포렌식 신뢰 저하. 현재 OS ACL, 백업 공개, 파일 침해는 확인하지 않았다. 파일 쓰기 권한 없는 원격 사용자의 직접 파일 변조는 입증되지 않았다.
- **권장 수정:** 별도 서비스 계정/최소 파일 권한, 서버 저장소를 정적 호스팅 루트에서 분리, 입력 데이터·모델 버전 결합, 원자적 쓰기, 민감 질문 최소 저장, 중앙 append-only 감사 또는 무결성 검증과 보존 정책.

### SEC-09 — 모델 endpoint의 redirect/proxy egress (잠재위험)

- **심각도:** Medium. **컴포넌트:** agent `model_json`의 urlparse와 `urllib.request.urlopen`.
- **설명:** 최초 URL의 hostname을 loopback으로 제한하지만 urllib의 redirect 목적지를 재검증하지 않고 proxy 환경과 응답 크기를 별도로 제한하지 않는다. 최초 주소 검사만으로 모든 후속 연결이 로컬임을 증명할 수 없다.
- **공격 순서:** ① 로컬 모델 포트의 서비스 또는 프로세스 실행 환경을 통제 → ② 외부/내부 다른 주소로 redirect 응답 제공 또는 proxy 경로 영향 → ③ API 요청이 최초 검사 경계를 넘어 연결. redirect의 HTTP method 변환에 따라 원래 JSON 본문이 그대로 전송되는지는 달라지므로 데이터 유출을 단정하지 않는다.
- **영향:** 제한된 SSRF/egress 정책 우회 가능성과 모델 입력·응답 신뢰 저하. 일반 원격 사용자는 URL을 요청 본문에서 지정할 수 없다. 로컬 서비스 장악·환경 변경 전제이며 실제 외부 연결 공격은 실행하지 않았다.
- **권장 수정:** redirect 금지 또는 매 hop 목적지 검증, 전용 proxy 없는 client, 응답 크기/시간 제한, 네트워크 egress 제한, 모델 서비스와 API를 별도 최소 권한으로 실행.

### SEC-10 — framing·cache 보호 부족

- **심각도:** Medium. **컴포넌트:** Frontend Vite 제공 화면, FastAPI 응답, 배포 구성.
- **설명:** 저장소에 CSP frame-ancestors/X-Frame-Options 설정과 Trace/Audit의 명시적 no-store 정책이 없다. 신뢰할 Host 제한과 HTTPS/HSTS 배포도 구성되어 있지 않다. HTTP 로컬 개발에서 HSTS 미설정 자체를 결함으로 보지는 않는다.
- **공격 순서:** ① 외부 배포된 승인 UI를 iframe에 넣을 수 있는 환경 → ② 사용자가 승인 자격을 입력하도록 유도하고 조작 요소를 겹침 → ③ 원치 않는 클릭 유도. 별개로 공유 cache를 잘못 설정하면 인증 추가 후에도 민감 응답이 남을 수 있다.
- **영향:** clickjacking 및 조건부 정보 잔존. XSS 주입점이나 실제 공유 cache 오염은 확인하지 않았다. CSP 부재만으로 XSS가 존재한다고 판정하지 않는다.
- **권장 수정:** 배포 서버에서 frame-ancestors 'none', 적절한 CSP·nosniff·Referrer-Policy, 민감 응답 no-store, Host allowlist, HTTPS/WSS와 HTTPS 환경의 HSTS. Vite dev/preview를 공용 운영 서버로 사용하지 않기. [OWASP REST 지침](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)

### SEC-11 — 상세 오류와 내부 정보 노출

- **심각도:** Low. **컴포넌트:** AgentFailure, main.py의 오류 문자열 반환, Trace 원문.
- **설명:** `str(error)`와 예외 타입, 모델/Pydantic 검증 실패 문맥이 API detail과 Trace에 남는다. 파일 경로·내부 서비스 오류·질문의 일부가 포함될 수 있다. 운영자에게 필요한 진단과 익명 사용자 응답의 경계가 없다.
- **공격 순서:** ① 존재하지 않는 근거·미훈련 예측·잘못된 입력으로 실패 유도 → ② API 오류와 공개 Trace 확인 → ③ 내부 구성과 입력 처리 특성을 수집.
- **영향:** 다른 공격의 사전 조사와 불필요한 입력 노출. 실제 시크릿 노출을 확인한 것은 아니며 시크릿 파일을 열어 검사하지 않았다.
- **권장 수정:** 외부에는 안정된 오류 코드·안전한 메시지·trace_id만, 내부 진단은 권한 있는 저장소에 보존하고 민감 입력을 마스킹.

### 확인한 방어와 확인하지 못한 공격

- SQL 쿼리의 사용자 값은 parameter binding 사용. 테이블명 등의 사용자 조합 없음. SQL injection 확인 못함.
- React의 일반 텍스트 렌더링, raw HTML/eval 사용 없음. 저장·반사·DOM XSS sink 확인 못함. 모델 출력도 허용된 evidence ID에서 구성.
- ProposalRequest/Decision/AgentQuery는 extra=forbid. Decision의 strict bool/int, UUID 경로, 정책 범위 재검사로 대량 할당·값 변조 일부 차단.
- 승인 Bearer는 React 메모리에만 보관하며 localStorage/sessionStorage/cookie 저장 없음. 성공 결정 후 비움. 오류 시 재시도용 메모리 잔존은 있음.
- 일반 교차 출처 HTML form만으로 유효한 Bearer 승인 요청을 만드는 CSRF는 확인 못함. 자동 전송 쿠키 세션이 없고 CORS wildcard도 없음. WebSocket 위험은 별도 SEC-02.
- BEGIN IMMEDIATE + revision/status 검사 + 트랜잭션 내 Audit로 같은 제안의 동시 중복 실행을 제한. 기존 E2E가 확인한 경계이며 모든 권한·업무 논리 검증을 뜻하지 않음.
- hmac.compare_digest 사용으로 통상적인 문자열 비교 타이밍 누출을 줄임. 실제 타이밍 공격 측정은 하지 않음.
- 파일 업로드, 비밀번호 재설정, OAuth 세션, NoSQL, 서버 템플릿, 클라우드 버킷, 서비스 워커가 없어 해당 경로는 적용 대상 없음. 외부 프록시/cache/클라우드 설정은 제공되지 않아 검증 불가.
- 사용자 문자열을 실행하는 subprocess 경로는 Backend에 없음. E2E 도구의 프로세스 실행은 로컬 테스트 도구이고 공개 API와 연결되지 않음.

## 3. Attack Chains

### A. 공개 Audit → 다른 사람의 근거 → 승인 목록 오염

```text
SEC-01: 익명 Audit 조회
  → source_trace_id 발견
  → SEC-07: 같은 근거로 새 제안 반복
  → SEC-06: 전역 최신 목록 교체/정상 제안 밀어내기
  → 사람이 혼동하여 검토·승인하는 경우 원치 않는 demo_bias 변경
```

마지막 단계에는 유효한 승인 자격과 사용자의 결정이 필요하다. 토큰 없는 실행 성공으로 과장하지 않는다.

### B. Kafka 위조 → 화면·AI 근거 오염 → 잘못된 문맥의 제안

```text
브로커 접근 권한 획득
  → SEC-04: 새 run_id, sequence=1로 위조 관측 채택
  → 정상 run retire + 과거 이력 소거
  → Agent가 위조된 관측을 '추적 가능한 근거'로 인용
  → SEC-07: 현재 데이터·신원과 근거의 연결 부족
```

근거의 JSON 경로가 맞는 것과 근거 원천이 진짜인 것은 다른 속성이다. 수치 Trace만으로 생산자 신뢰를 보장하지 못한다.

### C. 익명 모델 호출 → 디스크 증가 → Audit 조회 증폭

```text
SEC-01/06: 호출 가능한 공개 경로
  → SEC-03: 모델 작업·실패 Trace·제안/Audit 누적
  → 전체 Audit 읽기의 CPU·메모리 비용 증가
  → 정상 WebSocket/승인 응답 지연 및 저장 실패
```

### D. 교차 출처 읽기 → 운영 문맥 확보 → 공유 자격 남용

```text
SEC-02: 악성 Origin에서 관측 수집
  → 운영자·설비 문맥에 맞는 사회공학
  → 별도 경로로 자격 획득
  → SEC-05: 만료·사용자 범위 없는 공유 토큰 재사용
```

사회공학·자격 탈취 단계는 가정이며 이번에 실행하지 않았다.

## 4. Secure Design Recommendations

### 우선순위

1. **외부 공개 전:** 모든 HTTP/WS에 일관된 인증·권한, 정확한 Origin/Host 정책, 네트워크 경계와 TLS, 요청·모델 실행·연결 한도. 공개 API와 내부 health/진단을 분리.
2. **승인 경계:** 실제 actor, 제안 소유권/역할, 근거 신선도·세션·Tag 연결, 검토한 proposal 고정, 단기 자격과 폐기. 기존 원자적 결정/revision 보호는 유지.
3. **데이터 신뢰:** Kafka 계정·ACL/TLS, 허가된 run 전환, 모델/입력 버전 대조, 최소 파일 권한·보존 정책·변조 탐지 가능한 감사 저장.
4. **배포 검증:** reverse proxy의 보안 헤더/cache 정책, 모델 egress, 의존성/SBOM·컨테이너 digest/모델 출처, 백업 접근과 복구 검증. lock의 hash는 배포자 신뢰를 대체하지 않음.

### 구현 전 합의할 계약 — 미구현 제안

```text
Principal(user_id, roles)
  → authorize(action, equipment, resource_owner)
  → EvidenceContext(trace_id, actor, tag, run_id, sequence, created_at)
  → ProposalContext(proposal_id, owner, evidence, revision, expires_at)
  → transaction(decision, actor)
  → immutable receipt + UI status
```

신규 아키텍처·의존성 도입은 `.project/plan.md` 변경과 승인 후 진행한다. 이번 감사에서 라이브러리 설치나 lock 갱신은 하지 않았다.

### 검증 기록과 재현

- `npm.cmd audit --prefix frontend --json --package-lock-only`: 조회 성공, 알려진 취약점 0건. 패키지 설치·수정 없음.
- Python OSV 조회: 고정 패키지 23개, 알려진 advisory가 있는 패키지 0개. 최초 sandbox 네트워크 제한과 자동 승인 검토의 사용량 한도 때문에 실패했으나, 재시도 가능 시각 이후 승인된 조회가 성공했다.
- Python 고정 의존성은 `scripts/audit-dependencies.py`로 OSV querybatch를 조회한다. 최신 실행 결과는 `artifacts/e2e/phase7/security-review/python-dependencies.json`에 기록한다. [OSV API](https://google.github.io/osv.dev/api/)
- `E2E_PHASE=phase7 node scripts/e2e.mjs` 내 `security-review.mjs`: 실제 API·브라우저로 저용량 관측. `security-review/observations.json`에 HTTP 상태와 헤더·Origin 결과만 남기며 토큰은 기록하지 않는다.
- 실제 관측: state/registry/simulator/audit/OpenAPI 익명 조회는 모두 200. Audit에서 발견한 Trace 조회 200. 같은 Trace로 무자격 제안 두 번 생성 각각 200/pending. 무자격 결정은 두 번 모두 401. 실제 다른 loopback Origin에서 WebSocket telemetry 수신 성공. 임의 Host 요청 200이며 CSP/frame-options/cache-control 헤더 없음.
- 검증 대상: 익명 읽기, Audit→Trace 식별자 연결, 동일 Trace의 두 제안, 무인증 결정 거부, 별도 Origin WebSocket 수신, Host/헤더.
- 미실행: DoS 부하, 외부 서비스 공격, 실제 시크릿 열람, 파일 변조 침투, Kafka 위조 공격의 신규 재현, redirect egress 익스플로잇, 컨테이너 OS 전체 CVE 스캔, 모델 바이너리 공급망 인증. 증거 없이 취약점 악용 성공으로 집계하지 않는다.

자동 보안 관측의 `completed: true`는 **검사가 실행되었다**는 뜻이다. 취약한 응답을 의도적으로 기록하는 감사이므로 서비스가 안전하다는 pass가 아니다.
