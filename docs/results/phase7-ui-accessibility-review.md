# Phase 7 화면 품질·웹 접근성 검수

기준일: 2026-10-05. 대상: 운전 현황 단일 페이지의 모든 패널, 앱 404, 프로젝트 문서, 문서 404.

[WCAG 2.2 Quick Reference](https://www.w3.org/WAI/WCAG22/quickref/)의 키보드, 대체 텍스트, 구조·이름, 상태 안내, 대비·리플로 항목을 기준으로 코드와 Chromium 사용자 흐름을 검토했다. 브라우저 접근성 트리를 검사하며 실제 NVDA/VoiceOver/TalkBack 낭독은 아직 검증하지 않았다. WCAG 전체 적합성 인증을 주장하지 않는다.

## 변경 내용

| 요청 | 처리 |
| --- | --- |
| 가로 스크롤·모바일 overflow | 최소 너비 제거, 반응형 KPI·패널·feed, 표의 좁은 화면 표시와 긴 문자열 줄바꿈 |
| 깨진 링크·푸터 | 문서의 실제 상대 파일/anchor 검사, 앱에는 존재하는 section 링크만 제공 |
| 모바일 메뉴·불필요한 navigation | 실제 패널만 연결, 메뉴 열림 상태·Escape 복귀·선택 후 대상 포커스 |
| favicon·페이지 제목·메타 설명 | 앱·문서·404 제목/설명과 작은 SVG favicon |
| 맞춤 404 | 앱의 미등록 경로 복귀 화면, 정적 docs/404.html |
| 저작권 연도·로고 | 현재 연도 표시, 홈 링크에 명확한 접근 가능한 이름 |
| 이미지 압축 | 앱/문서의 bitmap 자산 없음. 새 그림은 SVG/CSS, E2E PNG는 검증용 생성물 |
| 버튼·성공·오류 | 비어 있는 제안과 비활성 승인 차단, Agent·Simulator 상태 안내, 실패한 registry를 무한 로딩으로 표시하지 않음 |
| placeholder | 검색은 실제 label로 안내. 질문/요청의 기본 문장은 동작 가능한 실제 입력값으로 유지 |
| 키보드 | 본문 건너뛰기, 전체 focus-visible, 설비 버튼, native details/select, 메뉴 복귀 |
| 스크린리더 | main/nav/section 이름, form label, SVG 이름·요약, 추이 원본 표, 표 caption/scope, live status |
| 움직임·자동 갱신 | reduced-motion 대응, 관측 표시 일시정지/재개. 서버 수집·조회 작업은 계속됨 |
| 텍스트 대비 | 작은 보조 텍스트의 전경색을 진하게 조정. 모든 픽셀·disabled 상태까지 자동 인증한 것은 아님 |

Canvas는 시각적 탐색에 사용하고 동일 설비를 HTML 버튼과 센서 목록에서 선택할 수 있다. 작은 화면에서는 겹치는 3D marker label 대신 설비 목록을 사용한다. SVG 추이에는 전체 관측값 표를 제공한다.

## 재현 명령

```powershell
npm.cmd run build --prefix frontend
$env:E2E_PHASE = 'phase7'
$env:E2E_FRONTEND_PORT = '4176' # 4173이 다른 프로젝트에서 사용 중인 경우
node scripts/e2e.mjs
node scripts/review-ui.mjs
```

첫 E2E에는 실제 Kafka·CSV·Ollama·SQLite 경계를 사용하며 앱의 키보드/모바일 검수를 포함한다. 마지막 명령은 테스트가 시작·종료하는 loopback 서버에서 문서·문서 404만 제공하여 Chromium으로 검수한다. 저장소 전체를 정적 웹 루트로 공개하지 않는다. Chromium의 file URL 접근 오류 후 이 방식을 사용했다.

아티팩트: `artifacts/e2e/phase7/ui-review/`의 JSON 관측, 접근성 YAML, desktop/mobile PNG. 결과 판정은 `app-result.json`과 `docs-result.json`, 전체 기능은 상위 `run.json`에서 확인한다.

## 실제 검증 결과

- TypeScript/Vite 빌드 통과. R3F를 포함한 JS chunk 크기 경고는 남아 있다.
- 문서와 404: 320/375/768/1440px, 내부 파일 링크·anchor·제목·메타·landmark·이름·키보드 메뉴·기본 텍스트 대비 통과.
- 실제 앱: 320/375/768/1280px, 가로 overflow 없음. 320px에서 글자/단어 간격·행간을 늘린 검사 통과. main 건너뛰기, 설비 선택, 모바일 메뉴 열기/Escape 복귀/section 이동, 분석 select를 키보드로 확인.
- 표의 row/columnheader/cell과 SVG 이름·설명은 Chromium 접근성 트리에 노출됨. 양식 control의 이름 누락 없음.
- 실제 WebSocket 수신 중 표시 일시정지와 재개 시 최신값 복원, Agent·승인·거절·실패 경로 통과.
- 전체 Phase 7 E2E는 19개 항목 통과. 보안 관측 항목의 성공은 검사가 실행되었다는 뜻이며 발견된 취약점 해소를 뜻하지 않음.

## 사람이 추가 확인할 순서

1. 마우스를 쓰지 않고 첫 Tab→본문 건너뛰기→메뉴→설비→검색→분석 select→Agent 질문→승인 입력까지 이동한다. Enter/Space로 조작하고 역방향 Shift+Tab도 확인한다.
2. NVDA+Firefox/Chrome 또는 VoiceOver+Safari에서 heading·landmark·form 탐색을 사용한다. 센서 Tag·단위 미확인·선택 상태·차트 설명·표의 시각과 값이 읽히는지 확인한다.
3. Agent 응답·제안 생성·승인·거절·오류가 반복적인 telemetry 낭독에 묻히지 않는지 확인한다. 필요하면 화면 자동 갱신을 일시정지한다.
4. 200%/400% 확대, 실제 터치 기기·가로 방향·고대비 모드에서 잘림과 포커스 가림을 확인한다. 320 CSS px 검수는 400% 리플로에 대한 근거이며 실제 모든 브라우저 확대 방식의 대체가 아니다.

## 범위와 제약

- 앱 404는 Vite SPA fallback 뒤 클라이언트에서 표시한다. HTTP 404 상태는 정적 호스팅/프록시 배포 시 별도 설정이 필요하다. docs/404.html도 호스팅 서비스의 error-page 연결이 필요하다. 현재 배포는 수행하지 않았다.
- 외부 웹사이트 링크의 미래 가용성까지 보장하지 않는다. 저장소 내부 링크는 실제 파일/anchor로 검사한다.
- 스크린리더 음성 출력·실제 모바일 OS·강제 색상·모든 WCAG 성공 기준은 별도 수동 검수 대상이다.
