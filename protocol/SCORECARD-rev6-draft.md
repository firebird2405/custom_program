# 채점표 rev.6 초안 (draft-2) — 출시 트랙 · 쁘띠캘린더/PetitCalendar

레드팀 3렌즈 35건 반영본. 승인 후 2단계에서 잠금 해제 절차로 SCORECARD.md 병합 + 채점기 확장(tests/a42~a50) + SHA 재기록.

## 트랙 구분 (명시)

- 앱 동작 계약(A1~A12, A14~A15, A17~A37, A41 등 ~50개)은 같은 HTML 파일을 file://로 계속 채점 — Electron이 **바이트 동일 파일**을 loadFile 하는 한 정직한 회귀 게이트 (동일성은 A42가 강제).
- **A13·A16·A38·A39·A40은 Edge 로컬 트랙 레거시 게이트로 존치** (로컬 사용 지속 전제) — Electron 제품의 대응 검증이 아님.
- 온보딩·마이그레이션 UI는 **Electron 셸 전용 레이어**(preload 주입/쿼리 활성화)로만 존재 — file:// 채점에는 미노출이라 fresh 기본값 계약(55개)과 충돌하지 않는다.

## A. 자동 판정 항목 (A42~A50)

| # | 기준 ("X하면 Y가 관찰된다") | 실행 명령 |
|---|---|---|
| A42 | Playwright `_electron.launch`(개발 트리, 패키지 exe는 EnableNodeCliInspectArguments fuse 유지)로 기동하면: BrowserWindow 2개, 각 getTitle()에 앱 이름 포함, 기본 창 ≥1024×700, 각 창 리사이즈·이동·독립 종료 가능. **출시-소스 동일성**: 패키지 리소스의 calendar.html·postit.html이 저장소 원본과 SHA256 동일(빌드 변형·인젝션 금지). **임계 서브셋 실검증**: A5·A6·A8·A9·A25·A26 시나리오를 Electron 컨텍스트(고정 userData, 환경변수 오버라이드 훅으로 격리)에서 재실행 — 완전 종료 후 재기동 보존 포함 | `npm test -- -g "A42:"` |
| A43 | 마이그레이션: 도구가 소스 프로필 경로 인자를 받고(채점기는 tmpdir 픽스처 프로필을 msedge로 시딩 — 실사용 .edge 불가침), **전 범위 이전**이 항목별 관찰된다 — 모든 `cal-*`/`postit-*` localStorage 키(다중 보드 postit-notes-b*, 보드 이름, cal-repeats, 설정, 창 상태) + IndexedDB `postit-decor`·`cal-decor` 전수(배경 이미지·사진 스티커). 원본 불가침(읽기 전용) + 사본 독립성(원본 수정 후 사본 불변). **병합·멱등**: Electron 저장소에 선-데이터가 있어도 무손실 병합, 2회 실행 중복 0. **발견성**: 기존 .edge 프로필 감지 시 첫 실행에 이전 제안 UI([data-migrate]) visible, 거절 후에도 설정에서 재진입 가능 | `npm test -- -g "A43:"` |
| A44 | 외부 요청 0 — 감시 범위 = **렌더러 전 세션 + main 프로세스 + 모든 자식 프로세스**: ① electronApp.evaluate로 defaultSession+전 파티션 webRequest 카운터 설치 → 대표 시나리오 조작 → http(s) 0건, ② main·preload 정적 검사 — http/https/net/dns/dgram/tls require·net.request·autoUpdater 0건, ③ 실행 중 앱 PID 트리 아웃바운드 소켓 OS 레벨(netstat) 0건. (각주: MS Store 결제·업데이트는 WinRT 브로커/스토어 프로세스 소관 — 앱 내 통신 0과 양립) | `npm test -- -g "A44:"` |
| A45 | Free/Pro 경계 — **Free 하한 = 2026-08-18 동결 빌드의 실제 기능 집합 전체**(사진 첨부·사진 스티커·배경 업로드·스티커 3세트·스킨 3종·꾸미기 전부·보드 3개까지 포함). 회귀 안티-테스트: 이 중 하나라도 잠기면 FAIL. **Pro = 순수 신규 가치만**: 신규 스티커 ≥2팩(팩당 ≥8종, 기존과 중복 0, 매니페스트로 검증)·신규 프리미엄 스킨/테마 ≥2종(기존과 색거리 ≥40)·보드 4개째부터·Electron 예약 자동 백업. 라이선스 = **서명 파일 방식**(앱엔 공개키만, WebCrypto 오프라인 검증): 잠금 UI([data-pro-lock]) 관찰 → 커밋된 테스트 라이선스([data-license-import]) 적용 → 즉시 해제+재기동 유지 → 바이트 변조 라이선스는 거부 | `npm test -- -g "A45:"` |
| A46 | 산출물 검사(채점기 fs 직접 측정 — 자기신고 스크립트 금지): 인스톨러 파일 ≤120MB + `dist/win-unpacked/` 총합 ≤300MB (dist 부재 시 명시적 SKIP). **개인 데이터 블랙리스트**: 산출물(인스톨러·포터블 ZIP)을 풀어 backups/·.edge/·protocol/·*.log·실사용 저장 데이터 부재를 정적 검사 — 지인 배포판도 동일 검사 통과가 1주차 완료 조건 | `npm test -- -g "A46:"` |
| A47 | 온보딩(Electron 셸 레이어, 훅 [data-onboarding]/[data-onboarding-target]/[data-onboarding-skip] — fail-closed): fresh 첫 실행에 표시되고, **스텝 = 채점기 발행 사용자 입력 액션 1회**(click/press/drag 각 1, fill 1필드 1 — 자동 전진 슬라이드 제외) 기준 ≤8스텝으로 첫 포스트잇 **실제 타이핑** + 첫 스티커 **실제 드래그 부착**이 완료되며, 콘텐츠는 사용자 입력분이 저장·유지된다(온보딩의 자동 생성 콘텐츠로 완료 계수 금지). 각 스텝 대상은 현재 단계의 [data-onboarding-target]과 일치. 건너뛰어도 앱 정상 + 설정에서 재실행 가능 | `npm test -- -g "A47:"` |
| A48 | 스토어 심사·자산 정적 검사: ① 아이콘 — `build/appx/{StoreLogo(50),Square44x44,Square150x150,Wide310x150}.png` 실존+PNG 치수 일치, scale-200·targetsize-{16,24,32,48,256} 변형 포함, 플레이스홀더 차단(고유색 수 하한), main·electron-builder 아이콘 경로 실파일; ② 매니페스트(.appx=zip 해제 → AppxManifest.xml) Identity 이름·게시자가 확정 브랜드(쁘띠캘린더/PetitCalendar)와 일치 — 플레이스홀더 리터럴 금지; ③ 개인정보처리방침(수집 0 명시) 존재 — 텔레메트리 0 판정은 A44 런타임 증명과 결합; ④ 스토어 자산 — 스크린샷 ≥4장(규격 해상도)·한국어 설명문 ≥200자; ⑤ **상업 라이선스**: ASSETS.md 전수(신규 스티커·스킨·아이콘 포함)가 상업 배포 허용 식별자(CC0·PD·OFL·MIT·CC BY)만 — NC/ND/불명 FAIL, 앱 정보 화면 [data-licenses] 고지 전수 일치 | `npm test -- -g "A48:"` |
| A49 | Electron 보안 3중 검증: ① 렌더러 — 각 창 evaluate로 `typeof require==='undefined' && typeof process==='undefined'`; ② main 정적 — nodeIntegration:true·contextIsolation:false·sandbox:false·webSecurity:false·allowRunningInsecureContent:true·webviewTag:true·loadURL(http 리터럴) 전부 0건, setWindowOpenHandler deny-all + will-navigate 외부 차단 존재; ③ preload — contextBridge로 **이름 붙은 채널 화이트리스트 API만** 노출, require/fs/child_process/ipcRenderer 원본·무검증 shell.openExternal 노출 0건 | `npm test -- -g "A49:"` |
| A50 | 설치 실물: 빌드된 MSIX를 테스트 설치(Add-AppxPackage) → 시작 메뉴 엔트리 존재·표시 이름 브랜드 일치·아이콘 리소스 일치 → 테스트 후 제거. 대화형 데스크톱/설치 권한 불가 환경은 명시적 SKIP(+3주차 C 시사로 이중화) | `npm test -- -g "A50:"` |

## B. 금지 조항 추가

- 텔레메트리·추적·원격 로깅 금지 — 판정은 A44 런타임(소켓 0) + A48 방침 문서 일치로 결합
- Electron 원격 코드 로드·webview·무차단 항해 금지 (A49)
- nodeIntegration 활성·contextIsolation 해제·sandbox 해제 금지 (A49)
- **무료 후퇴 금지(강화)**: Free 기준선은 "A1~A41"이 아니라 **2026-08-18 동결 빌드의 실기능 집합** — 기존 무료 기능·에셋의 Pro 재포장은 신규 계수 금지 (A45 안티-테스트가 감시)
- 마이그레이션 원본(.edge) 삭제·변형 금지 — 읽기 전용 (A43)
- HTML 빌드 변형 금지 — Electron은 저장소 원본과 바이트 동일 파일만 로드, 주입은 preload로만 (A42)
- 에셋 라이선스 문언 개정: "개인 사용 허용" → **"상업 배포 허용 명시"** 자료만 (A48⑤)

## C. 사람 시사 항목 추가

- 브랜드 감성: 쁘띠캘린더 이름·아이콘이 감성 문구 정체성에 맞는가 (2주차 시사)
- 스토어 자산: 스크린샷·설명문이 설치 욕구를 만드는가 (규격·존재는 A48이 게이트)
- **온보딩 체감**: 실제 시계로 60초 안에 "귀엽고 쉽다"고 느껴지는가 (스텝 수는 A47이 게이트)
- Pro 가치 체감: 잠긴 신규 팩을 보고 "사고 싶은가" (원망이 아니라)
- **실구매 검증(3주차 사용자 액션)**: 스토어 샌드박스 실구매 → 해제 → 재설치 복원 1회 수동 확인, 결과 STATUS 기록

## D. 굿하트 점검 추가

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

## 확정문 v2 역반영 대기 조항 (승인 시 확정문에 편입)

- 2-c. 앱은 렌더러 격리(contextIsolation·nodeIntegration off·sandbox)와 원격 코드 미로드의 보안 기본선을 지킨다 (→ A49 근거)
- 2-d. 설치 산출물은 경량 유지(인스톨러 ≤120MB·설치 후 ≤300MB — 다운로드 전환율 근거)하며 개인 데이터를 절대 동봉하지 않는다 (→ A46 근거)
- 3-a. 온보딩 60초는 사람 시사 기준으로 판정하고, 자동 게이트는 "안내 지목 대상에 대한 사용자 입력 액션 ≤8스텝"으로 번역한다 (→ A47 근거)

---
개정 절차 메모: 승인 → 잠금 해제(사용자) → SCORECARD.md 병합(rev.6) + 채점기 확장(tests/a42~a50) + **A39 타임아웃 상향(45→120초) 및 신규 스펙 개별 setTimeout 동시 정비**(같은 잠금 해제 이벤트에 포함 — 별도 해제 절약) + SHA 재기록 → 잠금 복원. Electron 앱은 userData 환경변수 오버라이드 훅과 EnableNodeCliInspectArguments fuse 유지(채점 가능성 계약).
