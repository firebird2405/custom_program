# CLAUDE.md — 캘린더 + 포스트잇 월

이 저장소에서 작업하는 에이전트를 위한 지침이다. 판정 기준의 원문은 `protocol/SCORECARD.md`,
확정 목적문은 `protocol/STATUS.md` — 본 문서와 충돌하면 그쪽이 우선한다.

## 현재 상태 (2026-08-13)

- 발주 #1(v1 가동)·발주 #2(백로그 27건 전체) 완료. `postit.html`·`calendar.html` 모두 구현·확장 완료.
- 채점표 **rev.5 (A1~A41)** 가동 중 — 최종 전체 채점 55/55 전 항목 PASS (2026-08-13).
- 채점기 SHA256 기대값 `32f23f0e…` SCORECARD 하단에 동결 기재, A12 green. 잠금(deny) 복원 상태.
- 대기 게이트: 사용자 시사 #2 (`protocol/REVIEWS.md`).

## 목적 (확정문 요약)

- 바탕화면 바로가기 더블클릭 → **캘린더** 창과 **포스트잇 월** 창이 각각 주소창 없는 독립 창(Edge 앱 모드)으로 열린다. 인터넷이 끊겨 있어도 동일하게 동작한다.
- 포스트잇 월: "+ 새 포스트잇" 생성, 내용 입력, 색상 선택(최소 4색), 자유 드래그 배치. 재실행하면 모든 포스트잇이 같은 위치·색·내용으로 관찰된다.
- 캘린더: v1(월간 그리드 · 2026–27 공휴일 · 일정 추가/수정/삭제) 베이스 유지·개선. 일정 추가 후 재실행하면 같은 날짜에 관찰된다.
- 같은 앱을 실수로 두 창 열어 각각 입력해도 양쪽 항목이 모두 보존된다. 저장 데이터가 손상되어도 크래시 없이 열리고 손상 원본은 백업 키로 보존된다.
- 장식 에셋(코르크 질감·손글씨 폰트 등)은 개인 사용 허용 무료 라이선스 자료만 `assets/`에 로컬 번들하고 출처·라이선스를 `assets/ASSETS.md`에 기록한다.
- 이번 스코프: 위 기능 + 실행 스크립트/바탕화면 바로가기까지. 기존 memo.html(사이드바형)은 포스트잇 월로 대체.

## 스택

- **단일 파일 HTML** — `calendar.html`, `postit.html` (둘 다 구현 완료 — 발주 #1 신규, 발주 #2 확장). 프레임워크·번들러·빌드 단계 없음.
- **저장**: `localStorage` (file:// 오리진). 기본 키 `cal-events`·`postit-notes`, 신규 기능은 `cal-*`/`postit-*` 접두 키로만 확장 (SCORECARD B rev.5 단서).
- **실행**: Microsoft Edge 앱 모드(`--app=file:///…` + 고정 `--user-data-dir` `.edge\calendar`·`.edge\postit`), `launch_calendar.vbs`·`launch_postit.vbs`·`launch_all.vbs` + `make_shortcuts.ps1`. 시스템 스크립트: `install_startup.ps1`/`uninstall_startup.ps1`(자동 시작), `backup_snapshot.ps1`(→ `backups\`), `pin_top.ps1`/`unpin.ps1`(항상 위).
- **채점**: `protocol/grader/` — @playwright/test(JavaScript), Edge channel `"msedge"` 헤드리스, workers 1.

## 아키텍처 원칙

1. **오프라인 필수** — 런타임 http(s) 요청 0건. CDN·웹폰트·원격 이미지·API 금지 (A1이 전 구간 감시).
2. **에셋은 로컬 번들** — `assets/` 하위에만 두고 `assets/ASSETS.md` 표(파일명|출처 URL|라이선스)에 전수 기록 (A10).
3. **사용자 텍스트는 textContent만** — DOM 삽입은 `textContent`/`createElement`로만. innerHTML 계열 위험 싱크 전면 금지 (A11, 금지 조항 참조).
4. **스키마 하위호환** — 기존 `cal-events` 데이터 파괴적 변경 금지. 변경이 꼭 필요하면 자동 마이그레이션 + 백업 키.
5. **JSON은 항상 try/catch** — 저장 데이터 파싱 실패 시 크래시 없이 `<원래키>-corrupt-<타임스탬프>` 키로 손상 원본을 백업(기존 백업 미덮어쓰기)하고 새로 시작 (A9).
6. **변경 즉시 저장** — 위치·색·텍스트 변경이 2초 내 localStorage에 반영되어야 한다. 종료 시점 일괄 저장 금지 (A5).
7. **에러 은폐 금지** — `window.onerror`/`onunhandledrejection`/`console.*` 재정의 금지 (정적 검사 대상).

## 금지 조항 (SCORECARD B 전문)

> 원문: `protocol/SCORECARD.md` B절 — 아래는 전문 전재이며 원문이 우선한다.

- 런타임 외부 네트워크 요청 금지 (CDN·웹폰트·원격 이미지·API — A1이 전 구간 감시)
- 채점기 변조 금지: protocol/grader/ 전체(소스·package.json·lockfile·node_modules 포함)와 본 채점표 수정 금지 + 실행 환경 후킹 금지(NODE_OPTIONS·.npmrc·npm config 프리로드 등), 채점은 정돈된 환경변수로 실행
- 사용자 텍스트를 위험 싱크에 삽입 금지: innerHTML·outerHTML·insertAdjacentHTML·document.write(ln)·DOMParser·createContextualFragment·eval·new Function·setAttribute("on…") — textContent/createElement만 (정적 검사 병행)
- 기존 v1 데이터 스키마(cal-events) 파괴적 변경 금지 — 기존 일정 보존, 변경 필요 시 자동 마이그레이션 + 백업 키
- 라이선스 불명 에셋 번들 금지 (개인 사용 허용 명시 자료만)
- window.prompt/alert/confirm을 필수 UI 경로로 사용 금지
- 발주 완료 기준과 무관한 파일 수정 금지 (스코프 크리프 차단)

## 작업 루프

1. 구현한다.
2. 채점기를 돌린다 (`cd protocol\grader && npm test`).
3. 실패를 분석한다 — 실패 메시지는 전부 한국어이며 어떤 관찰이 어긋났는지 명시한다.
4. 수정하고 2로 돌아간다.

규칙:
- **같은 지점에서 3회 실패하면 중단**하고, 무엇을 시도했고 왜 막혔는지 상태를 정리해 보고한다. 임의 우회(테스트 수정·기준 완화)는 금지.
- 현재 기준선은 **55/55 전 항목 green** (2026-08-13 실증) — 어떤 변경 후에도 red가 생기면 회귀이며, 원인은 앱/스크립트 쪽에서 찾는다 (채점기 수정 금지).
- A12는 채점기 해시(`32f23f0e…`, SCORECARD 하단 기재)와 일치해야 green — 채점기 파일을 건드리면 즉시 red가 된다.

## 채점 명령

```
cd protocol\grader && npm test
```

- PowerShell 5.1에서는 `&&` 가 없으므로: `cd protocol\grader; npm test`
- 개별 항목: `npm test -- -g "A4:"` 형식 — **콜론 포함** (rev.3 개정: A1↔A10~A18 접두 충돌 해소).
- A13·A16·A38·A39·A40은 Edge/바탕화면/대화형 데스크톱 접근 불가 환경에서 명시적 SKIP으로 출력된다.

## DOM 계약 참조

각 항목의 DOM 계약(셀렉터·크기·저장 동작)의 정본은 **해당 테스트 스펙 파일(`protocol/grader/tests/aNN-*.spec.js`) 상단 주석**이다. 관련 코드를 수정하기 전 반드시 해당 주석을 읽고 그대로 맞출 것. 예:

- `a01-offline.spec.js` — 보드 셀렉터: `[data-board]`, `#board`, `.board`, 또는 `[data-role="board"]`; 보드는 visible + 창 면적 90% 이상.
- `a13-launcher.spec.js` — 런처 계약: `--app=file:///D:/custom_program/calendar.html`·`--app=file:///D:/custom_program/postit.html` + 서로 다른 **고정** `--user-data-dir` 2개 (실행마다 동일 경로, 임시 프로필 금지).
- rev.5 신규 훅(A19~A41)은 폴백 셀렉터 없음 — `data-` 속성 부재 = 즉시 FAIL (fail-closed).

계약과 구현이 어긋나면 **구현을 계약에 맞춘다** — 채점기 수정은 금지 조항 위반이다.
