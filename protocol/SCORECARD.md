# 채점표 — 캘린더 + 포스트잇 월 (v1 rev.7 — A42 병합 1창 탭 모드 재정의)

전체 실행 한 줄: `npm test` (protocol/grader/ 안에서, Playwright 헤드리스. A13·A16 포함 — Edge/바탕화면 접근 불가 환경에서는 명시적 SKIP 출력)
개별 항목: `npm test -- -g "A4:"` 형식

## 트랙 구분 (명시)

- 앱 동작 계약(A1~A12, A14~A15, A17~A37, A41 등 ~50개)은 같은 HTML 파일을 file://로 계속 채점 — Electron이 **바이트 동일 파일**을 loadFile 하는 한 정직한 회귀 게이트 (동일성은 A42가 강제).
- **A13·A16·A38·A39·A40은 Edge 로컬 트랙 레거시 게이트로 존치** (로컬 사용 지속 전제) — Electron 제품의 대응 검증이 아님.
- 온보딩·마이그레이션 UI는 **Electron 셸 전용 레이어**(preload 주입/쿼리 활성화)로만 존재 — file:// 채점에는 미노출이라 fresh 기본값 계약(55개)과 충돌하지 않는다.

## A. 자동 판정 항목

| # | 기준 ("X하면 Y가 관찰된다") | 실행 명령 |
|---|---|---|
| A1 | http(s) 요청을 전부 차단·감시하고 두 앱을 file://로 열면: http(s) 요청 0건, console error 0건 + pageerror 0건, 캘린더는 날짜 셀 28개 이상 visible, 보드는 visible이며 창 면적의 90% 이상 | `npm test -- -g "A1:"` |
| A2 | "+ 새 포스트잇" 클릭 → visible 노트 1개 증가(렌더 크기 ≥ 120×120px, 보드 내부). 줄바꿈 2개 이상 포함 200자 문자열을 입력하면 textContent가 입력과 일치하게 표시(font-size ≥ 12px, 글자색 ≠ 배경색) | `npm test -- -g "A2:"` |
| A3 | 팔레트에 4색 이상, 모든 색 쌍의 RGB 유클리드 거리 ≥ 100. 노트 2개 이상 상태에서 한 노트의 색을 바꾸면 그 노트의 computed background-color만 선택 색으로 변경(타 노트 불변, 질감은 background-image 레이어로 유지 가능) | `npm test -- -g "A3:"` |
| A4 | 보드 좌상단 기준 (137,211)·(613,97)·(311,449)로 드래그(mouse.down→move steps≥10→up)하면 노트 좌상단이 각 ±2px 이내. 드래그 도중 3회 샘플링에서 노트가 커서 ±30px 추종. (351,275)→(352,276) 재드래그 시 최종 위치 차가 정확히 (1,1) — 격자 스냅 차단. 1600×900 뷰포트에서도 1회 성공. 드래그 후 내용·색 불변 | `npm test -- -g "A4:"` |
| A5 | 위치 이동·색 변경·텍스트 입력 각각이 2초 내 localStorage 폴링으로 확인됨. persistent context 재기동 후 모든 노트의 위치·색·내용 동일. 노트 30개 생성 후 재기동 시 정확히 30개 보존(조용한 상한 차단) | `npm test -- -g "A5:"` |
| A6 | 캘린더에 페이지 내 DOM 입력요소로 일정 추가(전 테스트 공통 dialog 0건) → 재기동 → 같은 날짜에 관찰. 일정 30건 생성 후 재기동 시 전량 보존 | `npm test -- -g "A6:"` |
| A7 | 채점기에 내장된 2026–27 대한민국 공휴일 전체 목록(대체공휴일 포함)을 월 이동으로 전수 검사: 각 셀에 공휴일 이름이 visible(font-size ≥ 10px)하고 computed color가 적색 우세(r ≥ 150이고 r ≥ 1.5×max(g,b)) | `npm test -- -g "A7:"` |
| A8 | 같은 앱을 한 컨텍스트의 두 페이지로 열고 창A 추가 → 저장 폴링 → 창B 추가 → 최종 저장소에 두 항목이 각각 정확히 1건(중복 0), 한 창 새로고침 후 둘 다 UI에 visible. 캘린더·포스트잇 각각 검사 (storage 이벤트 의존 금지) | `npm test -- -g "A8:"` |
| A9 | 전용 컨텍스트에서 addInitScript로 저장 키에 비JSON 주입 후 열면(dialog 자동 수락) 크래시·pageerror 0건, 직후 노트 생성→표시→저장이 성공하며, `<원래키>-corrupt-<타임스탬프>` 키로 손상 원본이 보존(기존 백업 미덮어쓰기) | `npm test -- -g "A9:"` |
| A10 | assets/ 하위 전 파일이 ASSETS.md 마크다운 표(파일명\|출처 URL\|라이선스)와 전수 일치하고, 라이선스가 허용 목록(CC0·Public Domain·OFL·MIT·CC BY 등 개인 사용 허용 식별자)에 매치(빈 값·'불명' FAIL). 런타임: document.fonts.ready 후 assets/ 폰트가 loaded이고 본문 computed font-family로 사용되며, 보드의 computed background-image가 assets/ 질감(파일 ≥ 5KB, 렌더 영역 ≥ 100×100px)을 가리킴 | `npm test -- -g "A10:"` |
| A11 | HTML 특수문자·태그 문자열(img onerror·svg onload·iframe srcdoc·javascript: href 등 4종 이상)을 노트/일정에 입력하고 reload(저장분 재렌더)해도: dialog 0건, 콘텐츠 컨테이너 내부 img·svg·script 요소 0개, window.__pwned 센티널 미설정, 입력 문자열이 문자 그대로 표시(과잉 새니타이즈 차단) | `npm test -- -g "A11:"` |
| A12 | 채점기 해시 대상(protocol/grader/ 하위 전 파일, node_modules·test-results·playwright-report 제외, 상대경로 정렬·CRLF→LF 정규화 연결)의 SHA256이 본 채점표 하단 기재값과 일치. 채점기 자기 출력은 참고용 — 독립 검증은 하단의 PowerShell 한 줄로 사용자가 직접 수행 | `npm test` 시작 시 자동 |
| A13 | (사전: .edge 프로필을 쓰는 기존 msedge 정리) launch_all.vbs 실행 → 15초 폴링 내 msedge CommandLine에 `--app=file:///D:/custom_program/calendar.html`과 `--app=file:///D:/custom_program/postit.html`이 각각 존재, 서로 다른 고정 `--user-data-dir` 2개(2회 연속 실행에도 동일 경로), 프로필에 심은 localStorage 마커가 재실행 후 유지(임시 프로필 증발 차단). 정리는 해당 CommandLine PID만 종료 | `npm test -- -g "A13:"` |
| A14 | 기존 일정의 시간·텍스트를 수정하면 재기동 후 수정본이, 삭제하면 재기동 후 부재가 관찰된다 | `npm test -- -g "A14:"` |
| A15 | 일정 2건 입력 → 내보내기 클릭 시 JSON 다운로드 발생 → 저장소 비움 → 그 파일 가져오기 → 동일 일정 복원 | `npm test -- -g "A15:"` |
| A16 | make_shortcuts.ps1 실행 후 바탕화면([Environment]::GetFolderPath)에 .lnk가 존재하고, WScript.Shell로 해석한 TargetPath/Arguments가 실존하는 launch 스크립트를 가리킴 | `npm test -- -g "A16:"` |
| A17 | 각 노트의 computed box-shadow ≠ none, transform에 0이 아닌 회전각(노트별 상이 허용), 노트 폰트가 assets/의 @font-face로 resolve, 보드 배경에 assets/ 질감 적용 — C는 "그 결과물이 취향에 맞는가"만 판정 | `npm test -- -g "A17:"` |
| A18 | 재기동 후 기존 노트를 클릭해 내용을 수정하면 수정본이 표시·유지되고, 노트를 삭제하면 visible 노트 수 1 감소 + localStorage 제거 + 재기동 후 미복귀 | `npm test -- -g "A18:"` |
| A19 | 포스트잇에 텍스트·색·위치가 서로 다른 노트 2개 생성 → 내보내기([data-export]) 클릭 시 `.json` 다운로드가 발생하고 파일이 두 노트를 포함한 유효 JSON → `postit-notes` 제거+reload로 visible 노트 0 확인 → 그 파일을 가져오기([data-import]→filechooser)하면 저장소에 정확히 2건 복원되고 두 노트의 텍스트·색·위치(±2px)가 UI에 표시된다. dialog 0건 | `npm test -- -g "A19:"` |
| A20 | 두 앱 각각: 항목(노트/일정) 삭제 직후 2초 내 저장소에서 해당 항목이 부재(지연 삭제 차단)하면서 [data-toast]에 textContent "실행 취소" 버튼([data-undo])이 2초 내 표시되고 최소 5초 유지 → 클릭하면 항목이 UI와 저장소에 복원되고 재기동 후에도 유지된다. 버튼을 누르지 않으면 항목은 계속 부재 | `npm test -- -g "A20:"` |
| A21 | 노트·보드 빈 영역·날짜 셀·일정 각각에 cancelable contextmenu 를 디스패치하면 defaultPrevented=true(브라우저 기본 메뉴 대체)이고 pageerror 0건 + [data-ctx-menu] 가 visible, 바깥 클릭으로 닫힌다. 메뉴 항목([data-ctx-item]) 최소 구성: 노트=색상·복제·맨 앞으로·삭제 / 보드=여기에 새 포스트잇 / 셀=이 날짜에 일정 추가 / 일정=수정·삭제·복제. 동작 검증: 노트 복제=visible +1·새 id·좌상단 오프셋 ≥10px·텍스트 동일, 노트 삭제=A18 과 동일 결과, 셀 메뉴의 '이 날짜에 일정 추가'=그 날짜가 선택되고 document.activeElement 가 일정 입력창 | `npm test -- -g "A21:"` |
| A22 | `- [ ] ` 로 시작하는 줄 2개+일반 줄 1개인 노트는 체크박스 input 정확히 2개를 렌더하고 일반 줄은 리터럴 textContent 로 표시된다. 체크박스 클릭 → 2초 내 저장 반영(원문 마커가 `- [x]` 로) + 그 줄 computed text-decoration 에 line-through → 재기동 후 체크 상태·취소선 유지, 편집기 재진입 시 원문 마커 텍스트가 보존된다 | `npm test -- -g "A22:"` |
| A23 | 노트 활성 후 [data-resize-handle] 을 (+100,+100) 드래그하면 offsetWidth/Height 각 ≥40px 증가, (−999,−999) 드래그에도 120×120 미만으로 줄지 않고 (+999,+999) 에도 480×480 을 넘지 않으며, 리사이즈 중 노트 좌상단은 ±2px 불변, 재기동 후 크기 ±2px 보존, 이후 A4식 자유 드래그가 그대로 성립한다 | `npm test -- -g "A23:"` |
| A24 | 노트 3개(그중 2개에 키워드 포함) 상태에서 [data-search] 에 키워드 입력 → 2초 내 비매칭 노트의 유효 opacity(조상 누적) < 0.5, 매칭 노트 ≥ 0.9, 저장소는 불변(검색이 삭제로 구현되지 않음) → 입력을 비우면 전 노트 ≥ 0.9 로 복귀 | `npm test -- -g "A24:"` |
| A25 | [data-board-switcher] 의 [data-add-board] 로 보드 2 생성 → 보드 2에서 추가한 노트는 `postit-notes` 가 아닌 `postit-notes-` 접두 신규 키에 저장되고 보드 1 전환 시 비표시(보드 1 노트는 표시), 역방향도 성립. 재기동 후 활성 보드(보드 2)와 각 보드 노트 구성이 유지되고 `postit-notes` 의 보드 1 데이터는 그대로다(하위호환) | `npm test -- -g "A25:"` |
| A26 | 노트 메뉴의 이미지 첨부(filechooser)로 큰 이미지(≥1200×900) 선택 → 노트 내부 img 의 src 가 `data:image/` 로 시작하고 naturalWidth>0, 저장된 데이터 URI 길이 ≤ 300×1024 바이트(다운스케일), 재기동 후 동일 표시. 비이미지 파일 선택 시 img 미생성 + 비모달 안내([data-toast]) 표시 + dialog·pageerror 0건 | `npm test -- -g "A26:"` |
| A27 | [data-skin] 선택지 ≥3(기본/줄노트/모눈) — 한 노트를 줄노트로 바꾸면 그 노트의 computed background-image 문자열만 변경(타 노트 불변)되고, 모눈은 기본·줄노트 어느 쪽과도 상이하며, 재기동 후 노트별 스킨이 보존된다 | `npm test -- -g "A27:"` |
| A28 | 노트 6개를 겹치게 배치 후 [data-arrange] 클릭 → 5초 내 위치가 안정화(300ms 간격 2회 샘플 동일)되고 모든 노트 쌍의 경계상자 겹침 면적 0 + 전 노트 보드 내부, 정리 결과가 재기동 후 보존되며, 이후 A4식 드래그((x,y)→(x+1,y+1) 1px 보존 포함)가 그대로 성립한다(스냅 상시화 차단) | `npm test -- -g "A28:"` |
| A29 | 채점기가 `memo-notes` 키에 memo.html 스키마(`[{id,text,pinned,updatedAt}]`) 메모 3건(줄바꿈 포함)을 주입한 상태에서 메모 가져오기([data-import-memo]) 실행 → visible 노트 정확히 +3, 각 노트 textContent 가 원문 그대로, 재기동 후 보존, `memo-notes` 원본 키는 파괴되지 않는다 | `npm test -- -g "A29:"` |
| A30 | 추가 폼 [data-repeat] 에서 '매주' 를 선택해 일정 생성 → 그 날짜와 +7일·+14일 셀에 동일 텍스트가 표시(월 경계 넘김 포함) → +7일 발생분만 삭제([data-del-one]) → +7일 셀에서만 사라지고 원일·+14일은 유지, 재기동 후 반복 규칙과 예외가 모두 보존되며 기존 단발 일정(cal-events)은 불변이다 | `npm test -- -g "A30:"` |
| A31 | 채점기 시계 기준 n일 뒤(테스트는 n=3) 날짜의 일정을 [data-dday] 로 기념일 지정 → [data-dday-badge] 텍스트가 채점기가 자기 시계로 산출한 "D-3" 과 일치(당일 지정 시 "D-day"), 재기동 후 유지된다 | `npm test -- -g "A31:"` |
| A32 | 현재 분(도래 직전 분)의 시각으로 일정을 UI 입력하면 도래 후 60초 내 [data-toast] 에 그 일정 텍스트를 포함한 알림이 표시된다(앱 폴링 주기 ≤15초 함의). dialog 0건·pageerror 0건 | `npm test -- -g "A32:"` |
| A33 | 각 날짜 셀의 [data-lunar] 음력 표기에서: 여섯 앵커(설날 2026-02-17·2027-02-07=음1/1, 추석 2026-09-25·2027-09-15=음8/15, 석가탄신일 2026-05-24·2027-05-13=음4/8 — lib/holidays.js 원장 기준)의 (월,일)이 전부 일치하고, 검사한 각 달의 모든 셀에서 음력 일이 전일 대비 +1 또는 1로 리셋으로만 진행하며(앵커만 하드코딩 차단), 표기가 visible(font-size ≥ 9px)이다 | `npm test -- -g "A33:"` |
| A34 | [data-category] 카테고리 색 ≥3(쌍별 RGB 유클리드 거리 ≥ 100) — 특정 카테고리로 일정 생성 시 그 일정의 그리드 점/배지([data-event-dot])의 computed 색이 선택 카테고리 색과 채널별 ±3 이내로 일치하고 다른 카테고리 일정과 상이하며 재기동 후 유지된다 | `npm test -- -g "A34:"` |
| A35 | [data-week-view] 토글 → [data-view-mode="week"] + 그 주의 날짜 셀 정확히 7개, 해당 주 3건의 일정 텍스트가 그대로 표시 → 재토글 시 month 복귀(셀 28개 이상, 일정 무손실) → 주간 상태로 재기동하면 주간 뷰로 열린다 | `npm test -- -g "A35:"` |
| A36 | 두 앱 각각 [data-theme-preset] ≥3(코르크+파스텔 기본/다크+비비드/미니멀 화이트) — 프리셋 간 문서 배경 computed color 쌍별 RGB 거리 ≥ 40, 다크는 상대 휘도 < 0.35·화이트는 > 0.85, 선택이 앱별 키로 저장되어 재기동 후 유지, 기본 프리셋에서 보드 background-image 는 여전히 assets/ 질감을 가리킨다(A10·A17 불변) | `npm test -- -g "A36:"` |
| A37 | 두 앱 각각 [data-volume] range(0~100)를 30으로 조작 → 2초 내 `postit-sound-vol`/`cal-sound-vol` = "30" 저장, 마스터 게인 노출값(body[data-volume-gain] 또는 window.__getMasterGain())이 0.30±0.01 → 재기동 후 슬라이더 값 30·게인 0.30, 0으로 내리면 게인 0 | `npm test -- -g "A37:"` |
| A38 | install_startup.ps1 실행(exit 0) → 시작프로그램 폴더([Environment]::GetFolderPath('Startup'))에 `캘린더.lnk` 와 `포스트잇 월.lnk` 가 존재하고 각각 WScript.Shell 해석 결과가 실존하는 launch 스크립트를 가리킴 → uninstall_startup.ps1 실행 → 정확히 그 두 .lnk 만 제거된다(전후 스냅샷 차집합 = 두 파일, 타 .lnk 불변) | `npm test -- -g "A38:"` |
| A39 | 앱 고정 프로필(.edge\calendar·.edge\postit)에 채점기가 마커 데이터를 심은 뒤 backup_snapshot.ps1 실행(exit 0, 120초 내) → `D:\custom_program\backups\` 에 두 앱 몫의 타임스탬프 파일명 `.json` 이 새로 생성되고 각각 유효 JSON 이며 심은 마커 값을 포함, 재실행 시 새 타임스탬프 파일이 추가된다(기존 파일 미덮어쓰기) | `npm test -- -g "A39:"` |
| A40 | 두 앱 창(launch_all.vbs)과 디코이 Edge 앱 창(별도 임시 프로필·custom_program 외 HTML)이 떠 있는 상태에서 pin_top.ps1 실행 → 두 앱 창의 GWL_EXSTYLE 에 WS_EX_TOPMOST(0x8) 비트가 set 되고 디코이 창은 unset → unpin.ps1 실행 → 두 앱 창의 비트가 clear 된다. (Edge/대화형 데스크톱 부재 시 명시적 SKIP) | `npm test -- -g "A40:"` |
| A41 | 노트 메뉴 '날짜 지정'([data-note-date] date 입력)으로 날짜 D 저장 → 2초 내 cal-events 의 D 에 `{id, time:"", text:"📌 "+노트텍스트}` 가 정확히 1건 생기고 같은 프로필로 calendar.html 을 열면 D 셀에 그 텍스트가 visible → 같은 날짜를 다시 저장해도 여전히 1건(중복 0), 날짜를 D2 로 바꾸면 D 의 연동 일정은 제거되고 D2 에 1건, 날짜 해제 시 연동 일정이 제거되어 재기동 후에도 부재, 기존 수동 일정은 불변이다 | `npm test -- -g "A41:"` |
| A42 | (rev.7) Playwright `_electron.launch`(개발 트리, 패키지 exe는 EnableNodeCliInspectArguments fuse 유지)로 기동하면: **fresh 기동 = BrowserWindow 정확히 1개(병합 모드)** — 제목에 앱 이름 포함, 기본 크기 ≥1024×700, 셸 탭바([data-shell-tabbar], 탭 [data-tab="postit"]·[data-tab="calendar"], 분리 [data-split]) + **기본 활성 탭 = 포스트잇**(보드 visible). 탭 전환: [data-tab="calendar"] → 날짜 셀 ≥28 visible, 포스트잇 탭 복귀 시 **작성 상태가 리로드 없이 보존**(webContents 유지). 분리: [data-split] → BrowserWindow 2개(각 제목 브랜드·리사이즈·이동·독립 종료 — rev.6 계약), 재병합([data-merge]) → 1개 복귀. 설정 영속: 셸 설정([data-shell-settings])에서 모드(separate)·기본 탭(calendar) 변경 후 재기동 시 각각 반영. **출시-소스 동일성**: 패키지 리소스의 calendar.html·postit.html이 저장소 원본과 SHA256 동일(빌드 변형·인젝션 금지). **임계 서브셋 실검증**: A5·A6·A8·A9·A25·A26 시나리오를 Electron 컨텍스트(병합 기본 모드, 고정 userData, 환경변수 오버라이드 훅 격리)에서 재실행 — 완전 종료 후 재기동 보존 포함 | `npm test -- -g "A42:"` |
| A43 | 마이그레이션: 도구가 소스 프로필 경로 인자를 받고(채점기는 tmpdir 픽스처 프로필을 msedge로 시딩 — 실사용 .edge 불가침), **전 범위 이전**이 항목별 관찰된다 — 모든 `cal-*`/`postit-*` localStorage 키(다중 보드 postit-notes-b*, 보드 이름, cal-repeats, 설정, 창 상태) + IndexedDB `postit-decor`·`cal-decor` 전수(배경 이미지·사진 스티커). 원본 불가침(읽기 전용) + 사본 독립성(원본 수정 후 사본 불변). **병합·멱등**: Electron 저장소에 선-데이터가 있어도 무손실 병합, 2회 실행 중복 0. **발견성**: 기존 .edge 프로필 감지 시 첫 실행에 이전 제안 UI([data-migrate]) visible, 거절 후에도 설정에서 재진입 가능 | `npm test -- -g "A43:"` |
| A44 | 외부 요청 0 — 감시 범위 = **렌더러 전 세션 + main 프로세스 + 모든 자식 프로세스**: ① electronApp.evaluate로 defaultSession+전 파티션 webRequest 카운터 설치 → 대표 시나리오 조작 → http(s) 0건, ② main·preload 정적 검사 — http/https/net/dns/dgram/tls require·net.request·autoUpdater 0건, ③ 실행 중 앱 PID 트리 아웃바운드 소켓 OS 레벨(netstat) 0건. (각주: MS Store 결제·업데이트는 WinRT 브로커/스토어 프로세스 소관 — 앱 내 통신 0과 양립) | `npm test -- -g "A44:"` |
| A45 | Free/Pro 경계 — **Free 하한 = 2026-08-18 동결 빌드의 실제 기능 집합 전체**(사진 첨부·사진 스티커·배경 업로드·스티커 3세트·스킨 3종·꾸미기 전부·보드 3개까지 포함). 회귀 안티-테스트: 이 중 하나라도 잠기면 FAIL. **Pro = 순수 신규 가치만**: 신규 스티커 ≥2팩(팩당 ≥8종, 기존과 중복 0, 매니페스트로 검증)·신규 프리미엄 스킨/테마 ≥2종(기존과 색거리 ≥40)·보드 4개째부터·Electron 예약 자동 백업. 라이선스 = **서명 파일 방식**(앱엔 공개키만, WebCrypto 오프라인 검증): 잠금 UI([data-pro-lock]) 관찰 → 커밋된 테스트 라이선스([data-license-import]) 적용 → 즉시 해제+재기동 유지 → 바이트 변조 라이선스는 거부 | `npm test -- -g "A45:"` |
| A46 | 산출물 검사(채점기 fs 직접 측정 — 자기신고 스크립트 금지): 인스톨러 파일 ≤120MB + `dist/win-unpacked/` 총합 ≤300MB (dist 부재 시 명시적 SKIP). **개인 데이터 블랙리스트**: 산출물(인스톨러·포터블 ZIP)을 풀어 backups/·.edge/·protocol/·*.log·실사용 저장 데이터 부재를 정적 검사 — 지인 배포판도 동일 검사 통과가 1주차 완료 조건 | `npm test -- -g "A46:"` |
| A47 | 온보딩(Electron 셸 레이어, 훅 [data-onboarding]/[data-onboarding-target]/[data-onboarding-skip] — fail-closed): fresh 첫 실행에 표시되고, **스텝 = 채점기 발행 사용자 입력 액션 1회**(click/press/drag 각 1, fill 1필드 1 — 자동 전진 슬라이드 제외) 기준 ≤8스텝으로 첫 포스트잇 **실제 타이핑** + 첫 스티커 **실제 드래그 부착**이 완료되며, 콘텐츠는 사용자 입력분이 저장·유지된다(온보딩의 자동 생성 콘텐츠로 완료 계수 금지). 각 스텝 대상은 현재 단계의 [data-onboarding-target]과 일치. 건너뛰어도 앱 정상 + 설정에서 재실행 가능 | `npm test -- -g "A47:"` |
| A48 | 스토어 심사·자산 정적 검사: ① 아이콘 — `build/appx/{StoreLogo(50),Square44x44,Square150x150,Wide310x150}.png` 실존+PNG 치수 일치, scale-200·targetsize-{16,24,32,48,256} 변형 포함, 플레이스홀더 차단(고유색 수 하한), main·electron-builder 아이콘 경로 실파일; ② 매니페스트(.appx=zip 해제 → AppxManifest.xml) Identity 이름·게시자가 확정 브랜드(쁘띠캘린더/PetitCalendar)와 일치 — 플레이스홀더 리터럴 금지; ③ 개인정보처리방침(수집 0 명시) 존재 — 텔레메트리 0 판정은 A44 런타임 증명과 결합; ④ 스토어 자산 — 스크린샷 ≥4장(규격 해상도)·한국어 설명문 ≥200자; ⑤ **상업 라이선스**: ASSETS.md 전수(신규 스티커·스킨·아이콘 포함)가 상업 배포 허용 식별자(CC0·PD·OFL·MIT·CC BY)만 — NC/ND/불명 FAIL, 앱 정보 화면 [data-licenses] 고지 전수 일치 | `npm test -- -g "A48:"` |
| A49 | Electron 보안 3중 검증: ① 렌더러 — 각 창 evaluate로 `typeof require==='undefined' && typeof process==='undefined'`; ② main 정적 — nodeIntegration:true·contextIsolation:false·sandbox:false·webSecurity:false·allowRunningInsecureContent:true·webviewTag:true·loadURL(http 리터럴) 전부 0건, setWindowOpenHandler deny-all + will-navigate 외부 차단 존재; ③ preload — contextBridge로 **이름 붙은 채널 화이트리스트 API만** 노출, require/fs/child_process/ipcRenderer 원본·무검증 shell.openExternal 노출 0건 | `npm test -- -g "A49:"` |
| A50 | 설치 실물: 빌드된 MSIX를 테스트 설치(Add-AppxPackage) → 시작 메뉴 엔트리 존재·표시 이름 브랜드 일치·아이콘 리소스 일치 → 테스트 후 제거. 대화형 데스크톱/설치 권한 불가 환경은 명시적 SKIP(+3주차 C 시사로 이중화) | `npm test -- -g "A50:"` |

### 채점 메커니즘 공통 규정 (2단계 채점기 구현 지침)
- 재기동 = `chromium.launchPersistentContext(전용 user-data-dir)` → 저장 폴링 확인 후 close → 같은 dir로 재기동. (plain newContext는 file:// localStorage를 잃으므로 금지)
- 네트워크: `route(/^https?:/)` abort — file:// 서브리소스(assets/)는 통과.
- 전 테스트 공통: dialog 이벤트 감시(A9 외 0건 단언), viewport 1280×800·deviceScaleFactor 1 기본.
- 앱 코드 정적 검사: window.onerror/onunhandledrejection/console.* 재정의 금지(에러 은폐 차단).
- A13·A16: Node child_process + PowerShell(Get-CimInstance Win32_Process / WScript.Shell COM). Edge 미탐지 시 명시적 SKIP.

#### rev.5 추가 (A19~A41)
- 컨텍스트 메뉴 판정: `dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,…}))` 반환값(false=preventDefault)으로 기본 메뉴 대체를 판정 — 네이티브 메뉴는 headless에서 관찰 불가.
- 시계: 클록 모킹(page.clock) 금지 — A31·A32는 실시간·채점기 자기 산술 기준. A32는 test.setTimeout(150000) 개별 부여.
- A38·A39·A40: Node child_process + System32 절대 경로 PowerShell(-NoProfile -NonInteractive), Edge/대상 폴더/대화형 데스크톱 미탐지 시 명시적 SKIP(A13·A16과 동일 형식). A39·A40은 실프로필(.edge\*)을 다루므로 마커·디코이·채점기 생성 파일만 정리하고 사용자 데이터는 불가침.
- 신규 훅은 폴백 셀렉터 없음: data-속성 부재 = 즉시 FAIL(한국어 메시지에 요구 훅 명시) — fail-closed 원칙.
- 기존 A1~A18은 기본 프리셋·월간 뷰·보드 1 기준으로 계속 전 항목 green이어야 한다(회귀 게이트).

## B. 금지 조항

- 런타임 외부 네트워크 요청 금지 (CDN·웹폰트·원격 이미지·API — A1이 전 구간 감시)
- 채점기 변조 금지: protocol/grader/ 전체(소스·package.json·lockfile·node_modules 포함)와 본 채점표 수정 금지 + 실행 환경 후킹 금지(NODE_OPTIONS·.npmrc·npm config 프리로드 등), 채점은 정돈된 환경변수로 실행
- 사용자 텍스트를 위험 싱크에 삽입 금지: innerHTML·outerHTML·insertAdjacentHTML·document.write(ln)·DOMParser·createContextualFragment·eval·new Function·setAttribute("on…") — textContent/createElement만 (정적 검사 병행)
- 기존 v1 데이터 스키마(cal-events) 파괴적 변경 금지 — 기존 일정 보존, 변경 필요 시 자동 마이그레이션 + 백업 키
- 라이선스 불명 에셋 번들 금지 (개인 사용 허용 명시 자료만)
- window.prompt/alert/confirm을 필수 UI 경로로 사용 금지
- 발주 완료 기준과 무관한 파일 수정 금지 (스코프 크리프 차단)

**rev.5 추가 단서 (발주 #2):**
- (A26 데이터 URI 예외) 위험 싱크 금지 조항 단서: 앱이 파일 판독 후 `data:image/(png|jpeg|webp);base64,` 접두를 검증한 데이터 URI를 `createElement('img')` 요소의 src에 대입하는 것은 허용(앱 생성 마크업). 사용자 텍스트의 innerHTML 계열 삽입 금지는 그대로이며 `javascript:`·`http(s):` src는 금지.
- (backups/ 쓰기 허용) `D:\custom_program\backups\` 하위 신규 타임스탬프 파일 생성은 A39의 정규 산출물로 허용. backups/ 내 기존 파일의 삭제·덮어쓰기는 금지. backups/는 채점기 해시 대상이 아니다.
- (스키마 보호 확장) `cal-events`와 `postit-notes`(보드 1) 모두 파괴적 변경 금지 — 신규 기능은 additive 필드 또는 신규 키(`cal-*`/`postit-*` 접두)로만 확장, 변경 필요 시 자동 마이그레이션 + 백업 키.
- (시스템 스크립트 범위 제한) install/uninstall_startup.ps1·backup_snapshot.ps1·pin_top.ps1·unpin.ps1은 자기 계약 범위 밖의 파일·바로가기·창·프로세스에 어떤 변경도 가하지 않는다.
- (전역 노출 제한) A37의 `window.__getMasterGain` 외 신규 전역 노출 금지 — 노출은 읽기 전용 게터 또는 data-속성 반영만.

**rev.6 추가 (출시 트랙):**
- 텔레메트리·추적·원격 로깅 금지 — 판정은 A44 런타임(소켓 0) + A48 방침 문서 일치로 결합
- Electron 원격 코드 로드·webview·무차단 항해 금지 (A49)
- nodeIntegration 활성·contextIsolation 해제·sandbox 해제 금지 (A49)
- **무료 후퇴 금지(강화)**: Free 기준선은 "A1~A41"이 아니라 **2026-08-18 동결 빌드의 실기능 집합** — 기존 무료 기능·에셋의 Pro 재포장은 신규 계수 금지 (A45 안티-테스트가 감시)
- 마이그레이션 원본(.edge) 삭제·변형 금지 — 읽기 전용 (A43)
- HTML 빌드 변형 금지 — Electron은 저장소 원본과 바이트 동일 파일만 로드, 주입은 preload로만 (A42)
- 에셋 라이선스 문언 개정: "개인 사용 허용" → **"상업 배포 허용 명시"** 자료만 (A48⑤)

## C. 사람 시사 항목 (자동 판정 불가 — 사용자의 눈)

- 감성 판정: A17이 '존재'만 보장하는 질감·그림자·기울임·손글씨 폰트의 **결과물이 취향에 맞는가**
- 드래그 손맛: 부드러움·반응의 자연스러움 (추종 자체는 A4가 검사)
- 두 앱 통일감: 한 세트 제품으로 보이는가
- 캘린더 개선 체감: v1 대비 좋아졌는가
- **취향 앵커 요청**: 분위기 선택 — 코르크보드+파스텔 / 다크 보드+비비드 / 미니멀 화이트 (또는 기준 이미지)
- (C5, 2026-08-12 사용자 지시로 신설) UIUX 효과: 마이크로 인터랙션(생성/삭제/드래그 들어올림·정착 애니메이션)이 존재하되 절제되어 있는가, 사운드 효과(사용자 제스처 시에만, 음소거 토글 필수)가 기분 좋은가, prefers-reduced-motion 존중·드래그 중 위치 transition 금지(A4 계약과 충돌 금지) 하에 60fps 체감인가

**rev.6 추가 (출시 트랙):**
- 브랜드 감성: 쁘띠캘린더 이름·아이콘이 감성 문구 정체성에 맞는가 (2주차 시사)
- 스토어 자산: 스크린샷·설명문이 설치 욕구를 만드는가 (규격·존재는 A48이 게이트)
- **온보딩 체감**: 실제 시계로 60초 안에 "귀엽고 쉽다"고 느껴지는가 (스텝 수는 A47이 게이트)
- Pro 가치 체감: 잠긴 신규 팩을 보고 "사고 싶은가" (원망이 아니라)
- **실구매 검증(3주차 사용자 액션)**: 스토어 샌드박스 실구매 → 해제 → 재설치 복원 1회 수동 확인, 결과 STATUS 기록

## D. 굿하트 점검 (기준을 통과하며 의도를 배반하는 경로 → 차단 조항)

| 배반 경로 | 차단 조항 |
|---|---|
| 보이지 않는 노트·1px 보드로 DOM 존재만 충족 | A2 visible·크기·보드 면적 90% 요건 |
| 격자 스냅으로 '자유 배치' 흉내 | A4의 1px 차이 보존 검사 (2px 이상 어떤 격자도 통과 불가) |
| 저장을 종료 시점에만 수행 (크래시 유실) | A5 변경 유형별 2초 내 폴링 확인 |
| 검사 좌표·날짜만 하드코딩 | A4 중간 추종 샘플링 + 2뷰포트, A7 공휴일 전수 검사 |
| 꾸미기 생략·죽은 CSS 규칙으로 A10 통과 | A10 런타임 폰트/질감 검증 + A17 computed style 검사 |
| dialog만 피하는 XSS·과잉 새니타이즈 | A11 페이로드 4종 + reload 후 검사 + 리터럴 보존 단언 |
| node_modules 패치·NODE_OPTIONS 후킹으로 채점기 무력화 | B 채점기 변조 금지(전체 범위) + A12 사용자 독립 해시 검증 |
| 실행마다 임시 프로필 → 실사용 데이터 증발 | A13 고정 프로필 + 마커 유지 검사 |
| 저장 개수 조용한 상한(오래된 메모 드롭) | A5/A6 30개 전량 보존 |
| 수정·삭제 불가능한 노트/일정 | A14·A18 수정/삭제 왕복 검사 |
| 삭제를 미뤄두고 undo를 흉내(저장은 토스트 소멸 후) | A20 삭제 직후 2초 내 저장소 부재 단언 |
| 검색·보드 전환을 삭제/재생성으로 구현 | A24 저장소 불변, A25 키 분리+양방향 재전환 단언 |
| 보드 2가 같은 키의 필터 플래그일 뿐 | A25 `postit-notes`에 보드 2 노트 부재 단언 |
| 음력 여섯 앵커 날짜만 하드코딩 | A33 검사 월 전 셀 연속성(+1/1 리셋) 검사 |
| D-day 배지 문자열 하드코딩 | A31 채점기 실행 시점 산술과 대조 |

**rev.6 추가 (출시 트랙):**

| 배반 경로 | 차단 조항 |
|---|---|
| 기존 무료 기능을 Pro로 재포장 (신규 가치 0) | A45 동결 빌드 하한 안티-테스트 + Pro 신규성 매니페스트 검증 |
| main 프로세스 소켓/자식 프로세스로 텔레메트리 발신 | A44 ③ OS 레벨 PID 트리 소켓 0건 + ② 정적 import 금지 |
| 빌드가 변형본 HTML을 실어 "테스트한 것 ≠ 출시한 것" | A42 SHA 동일성 + B 빌드 변형 금지 |
| 마이그레이션이 좁은 키만 이전 (꾸미기·다중 보드 증발) | A43 전 범위 항목별 검사 (IDB 포함) |
| 온보딩이 사용자 대신 콘텐츠 자동 생성해 "완료" | A47 실제 입력·부착 + 입력 콘텐츠 보존 검증 |
| 아이콘·매니페스트 플레이스홀더로 A48 통과 | A48 브랜드 일치·고유색 하한·리터럴 금지 |
| preload 브리지로 god-object 노출 (플래그는 규격대로) | A49 ③ 채널 화이트리스트 검사 |
| 크기 상한 맞추려 에셋·폰트 품질 파괴 | A10/A17 런타임 검증 유지 + C 감성 시사 이중 게이트 |

## E. 출시 후 운영 게이트 (신설)

- 출시일을 기산일로 STATUS에 기록. **주 1회** Partner Center 지표(다운로드·평점·리뷰 수)를 STATUS 표에 기록(사용자 액션).
- 3개월 시점 3지표 동시 판정: 다운로드 ≥1,000 · 평점 ≥4.5 · 리뷰 ≥10 → 충족 시 2차(순위 공략) 발주 개방, 미충족 시 원인 분석 발주.

## 주차별 게이트

| 주차 | 완료 기준 |
|---|---|
| 1주차 | A42·A43·A44 green + 기존 55개 회귀 green + A46 개인 데이터 검사(지인 배포판 포함) |
| 2주차 | A45·A47 green + C 브랜딩 시사(이름·아이콘) |
| 3주차 | A48·A49·A50 green + 스토어 등록·샌드박스 실구매 검증(사용자 액션) |
| 4주차 | 제출. 각 주 종료 시 게이트 미충족이면 다음 주 진입 전 중단·보고 |

## 확정문 역반영 대기 조항 (채점표 승인 시 확정문에 함께 추가됨)

- 2-a. 같은 앱을 실수로 두 창 열어 각각 입력해도 양쪽 항목이 모두 보존된다 (→ A8의 근거)
- 2-b. 저장 데이터가 손상되어도 앱은 크래시 없이 열리고 손상 원본은 백업 키로 보존된다 (→ A9의 근거)

**rev.6 추가 (확정문 v2 역반영 대기 조항 — 승인 시 확정문에 편입):**
- 2-c. 앱은 렌더러 격리(contextIsolation·nodeIntegration off·sandbox)와 원격 코드 미로드의 보안 기본선을 지킨다 (→ A49 근거)
- 2-d. 설치 산출물은 경량 유지(인스톨러 ≤120MB·설치 후 ≤300MB — 다운로드 전환율 근거)하며 개인 데이터를 절대 동봉하지 않는다 (→ A46 근거)
- 3-a. 온보딩 60초는 사람 시사 기준으로 판정하고, 자동 게이트는 "안내 지목 대상에 대한 사용자 입력 액션 ≤8스텝"으로 번역한다 (→ A47 근거)

---
채점기 SHA256 기대값: 9479bbe3170d107834ced1614229a3a72f2fcc55379bfd9bc085ed7f76fa57b2
(기록: 2026-08-20, rev.7 A42 병합 탭 모드 재정의(a42 재작성 + a49 확대 + 헬퍼 추가 전용) 동결 — 이 줄 위의 기대값 줄은 64자리 hex만 허용됨. Node lib/hash.js와 INDEPENDENT_HASH.txt PowerShell 한 줄 이중 계산 일치 확인. 직전 rev.6 값: aef15ad1…)

독립 검증 명령 (환경변수가 깨끗한 **새 PowerShell 창**에서 실행 — 채점기 자기 출력은 참고용일 뿐, 아래 한 줄의 출력이 위 기대값과 일치하는지 사용자가 직접 확인):

```powershell
$g='D:\custom_program\protocol\grader'; [string[]]$rels=@(Get-ChildItem -LiteralPath $g -Recurse -File -Force | ForEach-Object { $_.FullName.Substring($g.Length+1) -replace '\\','/' } | Where-Object { ($_ -cnotmatch '(^|/)(node_modules|test-results|playwright-report)(/|$)') -and ($_ -cnotmatch '(^|/)\.last-run\.json$') }); [Array]::Sort($rels,[System.StringComparer]::Ordinal); $sb=New-Object System.Text.StringBuilder; foreach($r in $rels){ [void]$sb.Append($r).Append("`n").Append(([System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes("$g\$($r -replace '/','\')")) -replace "`r`n","`n")).Append("`n") }; ([System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($sb.ToString()))) -replace '-','').ToLower()
```

잔여 위험 완화 권고: node_modules 변조는 해시 사각지대(명세상 제외)이므로, 최종 채점 전 `protocol\grader`에서 `node_modules` 삭제 후 `npm ci` 재설치를 권장 (package-lock.json은 해시로 보호됨).
