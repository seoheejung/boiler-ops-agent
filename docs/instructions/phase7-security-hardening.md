# Phase 7 보안 보완

## 구현 전 계약

```text
Login(user_id, access_key)
  → Session(opaque_id, principal, expires_at)
  → Principal(user_id, role: viewer | operator)

HTTP / WS
  → Origin + Host + body/rate limits
  → session validation
  → operation role + resource ownership

AgentQuery + Principal + frozen observation context
  → bounded model work
  → Trace(owner, created_at, run_id, sequence, selected_tag, status)

ProposalRequest(trace_id, intent) + Principal
  → owned, fresh, same-run evidence
  → single-use evidence + immutable proposal
Decision(confirm, approve, expected_revision) + Principal
  → ownership + evidence revalidation + transaction + identified Audit

Kafka admin → Topic/ACL initialization
Kafka producer → SASL + write-only Topic permission
Kafka consumer → SASL + read-only Topic/group permission
```

관측은 공통 보일러 데이터이며 인증 사용자가 함께 조회한다. 사용자 질문·Trace·제안·Audit는 사용자별로 분리한다.
operator가 본인의 제안을 직접 승인하는 현재 데모 범위를 유지하며 별도의 2인 승인 절차를 추가하지 않는다.

## 실패 가능성

- 인증 설정 누락, 잘못된 해시/역할/Origin, 빈 자격, 잘못된 로그인, 세션 만료·로그아웃.
- 익명 HTTP/WS, viewer 쓰기, 다른 사용자의 UUID, legacy 소유자 없는 데이터.
- 잘못된 Origin/Host, 쿠키만 있는 교차 출처 변경, 과대 본문과 burst 요청.
- 모델 포화 중 신규 작업·취소 후 남은 작업, WebSocket 전체/사용자별 연결 한도.
- Trace 저장 한도, 제안/Audit 저장 한도, 오류 후 용량 예약 해제, 읽기 페이지 한도.
- Kafka 무자격 연결, 소비자 자격을 이용한 쓰기, 생산자 자격을 이용한 읽기, 오래된 run 시작 이벤트 재전송.
- 오래된/실패한/STALE/다른 사용자/다른 run 근거, 같은 근거의 동시 제안, 생성 도중 run 변경.
- 승인 중 근거 만료/회수/세션 변경, revision 경합·재실행, API 재시작 후 소유권 유지.

## 검증

실제 Kafka·Ollama·FastAPI·브라우저·SQLite를 사용한 E2E로 검증한다. 테스트 자격은 메모리에서 생성하고 결과에 기록하지 않는다.
기존 phase7 아티팩트와 별도로 보안 차단 상태·한도·소유권 관측을 JSON에 남긴다.
새 패키지를 설치하거나 lock을 변경하지 않는다. 실제 `.env`와 자격 파일은 읽거나 덮어쓰지 않는다.
기존 무인증 경로의 200/연결 성공 관측을 401/403/429 등의 서버 차단 검증으로 교체한다.
