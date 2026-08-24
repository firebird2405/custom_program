# store-assets — 쁘띠캘린더(PetitCalendar) 스토어 제출 자산

Microsoft Store(파트너센터) 리스팅과 확산 킷(LAUNCH-KIT)에 쓰는 스크린샷·데모·설명문 모음이다.
**모든 이미지는 스크립트로 재생성된다** — 손으로 찍은 것은 하나도 없다. 촬영기는 `tools/` 안에 있고
앱(`calendar.html`·`postit.html`)·Electron 셸·채점기 파일은 **읽기 전용으로 구동만** 한다.

> **2026-08-21 갱신 (발주 #26·#27).** ① 스토어 **제출용/보조용**을 §2 표로 갈랐다 — 합성 컷과
> 발주 #13 이전 구버전 UI 컷은 **제출 목록에서 뺀다**(파일은 남긴다). ② **영문 리스팅은 보류**다 —
> `en/` 판·`store-description.en.md` 는 삭제하지 않고 **UI 영문화 발주 이후 사용**한다(§5).
> 근거: `protocol/EXPERT-REVIEW.md` B5·B6 · 부록 C 4-4~4-6.

---

## 1. 자산 목록

### 1-1. 국문(원본) 스크린샷 — 1920×1080 PNG

| 파일 | 용량 | 장면 | 촬영 |
|---|---|---|---|
| `screenshot-01-postit-wall.png` | 2.1 MB | 포스트잇 월 기본 보드 | 수동 · **구버전 UI(#13 이전)** — 보조용 |
| `screenshot-02-calendar-month.png` | 80 KB | 캘린더 월간 그리드 | 수동 · **구버전 UI(#13 이전)** — 보조용 |
| `screenshot-03-decor-panel.png` | 2.1 MB | 🎨 꾸미기 패널 — 배경·스티커·테이프 | 수동 · **구버전 UI(#13 이전)** — 보조용 |
| `screenshot-04-theme-lavender.png` | 617 KB | 프리미엄 테마 · 라벤더 안개 | 수동 · **구버전 UI(#13 이전)** — 보조용 |
| `screenshot-05-theme-deepsea.png` | 593 KB | 프리미엄 테마 · 심해 블루 | 수동 · **구버전 UI(#13 이전)** — 보조용 |
| **`screenshot-06-drag-in-progress.png`** | 2.3 MB | **노트를 잡아 끄는 중** — 들린 그림자·진행 방향 기울임·grabbing 커서 | `tools/capture.js shots` |
| **`screenshot-07-note-date-menu.png`** | 2.4 MB | **노트 우클릭 메뉴 + `날짜 지정 2026-08-25`** (연동의 입력 쪽) | `tools/capture.js shots` |
| **`screenshot-08-calendar-linked.png`** | 88 KB | **캘린더에 📌 연동 일정 4건 + 수동 일정** · 8/25 선택 상태 | `tools/capture.js shots` |
| **`screenshot-09-board-seeded.png`** | 2.3 MB | 노트 12장 + 이모지 스티커 7개로 꽉 찬 보드 (01의 대체 컷) | `tools/capture.js shots` |
| **`screenshot-10-settings-search.png`** | 924 KB | **설정 중앙 모달 + 설정 검색**(“백업” 하이라이트·분류 배지) | `tools/capture.js shots` |
| `screenshot-11-link-flow.png` | 953 KB | **연동 합성 컷(국문)** — 두 화면 나란히 + 강조 링 + 확대 조각. **앱에 없는 화면**(합성) — 보조용 | `tools/compose.js` |
| `screenshot-11-link-flow.en.png` | 951 KB | 위 합성 컷의 **영문 카피 버전** — 합성 + 영문 리스팅 보류로 이중 보조용 | `tools/compose.js` |
| **`screenshot-12-onboarding-spotlight.png`** | 1.7 MB | **온보딩 스포트라이트** — 딤 + 분홍 링 + 삼각 포인터 + “1 / 4” 카드 | `tools/capture-shell.js` (Electron 셸) |

굵은 항목이 **발주 #13 이후 실제 화면을 촬영한 컷**이다 (06·07·08·09·10·12 — 스토어 제출용 6장).
01~05 는 발주 #13(툴바 4그룹 재구성 · 볼륨 슬라이더를 🔊 서랍으로 이동) **이전**에 찍혀 지금 빌드에 없는
인라인 볼륨 슬라이더가 그대로 박혀 있다 — 파일 타임스탬프(8/19)와 `protocol/STATUS.md` 발주 #13(8/20)로 확인.
11 은 두 장을 나란히 붙인 **마케팅 합성**이라 앱에서 재현되지 않는다.

### 1-2. 영문 리스팅용 캡션 컷 — `en/` · 1920×**1200** PNG — ⛔ **보류(제출 안 함)**

원본 1920×1080 위에 **가리는 것 없이** 아래 120px 캡션 띠를 덧붙인 판. 9장.
`en/screenshot-03/04/05/06/07/08/09/10/12-*.png` — 파일명은 원본과 같다.

**영문 리스팅을 이번 판에서 내지 않기로 했으므로 이 9장도 제출하지 않는다**(발주 #27 — §5 참조).
파일은 **삭제하지 않고 보관**하며, UI 영문화 발주 이후 그대로 쓴다.

### 1-3. 데모 애니메이션

| 파일 | 규격 | 내용 |
|---|---|---|
| `demo-drag.gif` | **550×310 · 30프레임 · 100ms · 3.0초 무한 루프 · 458 KB** | 노트를 잡아 왼쪽 위로 들었다가 제자리로 놓는 왕복 드래그. 커서·기울임·그림자가 그대로 보인다. |

`en/` 합계 13.3 MB · `store-assets\` 전체 32.5 MB (`tools\` 제외).
코르크 질감이 노이즈가 많아 PNG 가 크다 — 파트너센터 스크린샷은 PNG 만 받으므로 이대로 올린다.

### 1-4. 보조 자산

| 경로 | 용도 |
|---|---|
| `fragments/frag-note-date-row.png` (1002×144) | 합성 컷용 확대 조각 — 우클릭 메뉴의 `날짜 지정` 행 (dsf 3배 촬영) |
| `fragments/frag-cal-panel.png` (882×480) | 합성 컷용 확대 조각 — 캘린더 사이드 패널(수동 일정 + 📌) |
| `fragments/boxes.json` | 위 조각의 원본 좌표 (합성 컷의 강조 링 위치 계산용) |
| `extras/onboarding-step2.png` | 온보딩 2/4 단계 (보드가 비어 있어 리스팅 비권장 — 문서용) |
| `store-description.md` / `store-description.en.md` | 국문·영문 리스팅 설명문 |

---

## 2. 제출용 / 보조용 구분 + 리스팅 권장 순서

파트너센터 스크린샷 슬롯은 최대 10장이다. **제출용은 "지금 빌드를 켜면 그대로 나오는 화면"만** 올리되,
**실제 업로드는 `kr/` 의 국문 캡션판**(`tools/captionize-kr.js` 산출)으로 한다 — 목록 썸네일에서
캡션 띠 없이는 1초 안에 기능이 안 읽힌다 (SCORE-AUDIT I14). —
합성 컷과 구버전 UI 컷은 "설명과 다르다" 리뷰·환불 분쟁의 씨앗이라 목록에서 뺀다
(`protocol/EXPERT-REVIEW.md` B5 · 부록 C 4-4~4-6). 뺀 파일은 **지우지 않는다** — 문서·블로그·프레스킷용이다.

### 2-1. 구분표

| 파일 | 구분 | 사유 |
|---|---|---|
| `screenshot-09-board-seeded.png` | ✅ **제출용** | 발주 #13 이후 실화면. 코르크 + 노트 12장 + 스티커 7개 |
| `screenshot-06-drag-in-progress.png` | ✅ **제출용** | 실화면 + 실제 포인터 좌표에 커서 그림만 덧그림(§4-4 고지) |
| `screenshot-08-calendar-linked.png` | ✅ **제출용** | 실화면. 캘린더 + 📌 연동 일정 |
| `screenshot-10-settings-search.png` | ✅ **제출용** | 실화면. 설정 모달 + 설정 검색 |
| `screenshot-07-note-date-menu.png` | ✅ **제출용** | 실화면. 우클릭 메뉴 + `날짜 지정` |
| `screenshot-12-onboarding-spotlight.png` | ✅ **제출용** | 실화면(Electron 셸). 온보딩 1/4 스포트라이트 |
| `screenshot-11-link-flow.png` | ⛔ 보조용 | **합성**(두 스크린샷 + 강조 링 + 확대 조각 + 카피). 단일 창 탭 모드에서는 두 화면이 동시에 보이지 않는다 — 앱에서 재현 불가 |
| `screenshot-01-postit-wall.png` · `02` · `03` | ⛔ 보조용 | 발주 #13 **이전** UI(인라인 볼륨 슬라이더·구 툴바). 09·08·(재촬영 대기)로 갈음 |
| `screenshot-04-theme-lavender.png` · `05` | ⛔ 보조용 | 구버전 UI + **Pro 테마**. 첫 출시는 **무료 단독**이라 유료 전용 화면을 리스팅에 올리지 않는다. 코르크가 없어 제품 매력도 안 보인다 |
| `screenshot-11-link-flow.en.png` · `en/**` | ⛔ 보조용(보류) | 영문 리스팅 보류(발주 #27) |
| `extras/onboarding-step2.png` | ⛔ 보조용 | 보드가 비어 있어 리스팅 비권장 — 문서용 |
| `demo-drag.gif` | ⛔ 보조용 | 스토어 스크린샷 슬롯은 PNG/JPG만 — 랜딩·GitHub README·LAUNCH-KIT 용 |

### 2-2. 제출 순서 (한국어 리스팅 · 6장)

앞 3장이 갤러리 썸네일에 걸린다.

1. `screenshot-09-board-seeded.png` — 첫인상: 알록달록한 코르크 보드
2. `screenshot-06-drag-in-progress.png` — 핵심 손맛: 끌어서 붙이기
3. `screenshot-08-calendar-linked.png` — 캘린더 본체 + 📌 연동
4. `screenshot-10-settings-search.png` — 설정 검색
5. `screenshot-07-note-date-menu.png` — 우클릭 메뉴 · 날짜 지정(연동의 입력 쪽)
6. `screenshot-12-onboarding-spotlight.png` — 처음 켜도 헤매지 않음

`MARKET.md` D-7 체크리스트는 6~8장을 요구한다 — **현재 제출 가능한 실화면 컷이 정확히 6장**이라 하한을 만족한다.
7~8번 슬롯을 채우려면 §7 TODO(꾸미기 패널 재촬영 · 탭바가 보이는 컷)를 먼저 해결해야 한다.

**영문 리스팅 순서는 이번 판에서 쓰지 않는다**(발주 #27 보류). UI 영문화 이후 `en/` 판으로 같은 순서를 쓴다.

---

## 3. 재생성 방법

```
cd d:\custom_program\store-assets

node tools\capture.js shots      # 06 · 07 · 08 · 09 · 10 촬영
node tools\capture.js frames     # GIF 원본 프레임 30장 → frames\  (약 32 MB, 중간 산출물)
node tools\make-gif.js 100       # frames\ → demo-drag.gif  (인자 = 프레임 간격 ms)
node tools\verify-gif.js         # 만든 GIF 가 실제로 디코드·재생되는지 확인
node tools\compose.js            # 11 국문·영문 합성 컷 + fragments\
node tools\capture-shell.js      # 12 온보딩 스포트라이트 (Electron 셸 기동)
node tools\captionize.js         # en\ 영문 캡션 판 9장 (보류 — 발주 #27)
node tools\captionize-kr.js      # kr\ 국문 캡션 판 6장 — **파트너센터 제출용은 이 판**
```

`frames\` 는 **중간 산출물**이라 커밋 대상에서 뺐다 (약 32 MB). GIF 를 다시 만들거나 타이밍을
바꾸려면 `capture.js frames` 로 언제든 다시 만든다. 저장소에 남기고 싶다면
`.gitignore` 에 `store-assets/frames/` 를 넣는 편을 권한다.

### 스크립트 구성 (`tools/`)

| 파일 | 역할 |
|---|---|
| `seed.js` | 한국어 **연출용 샘플 데이터** — 노트 12장·스티커 7개·일정 14건. 실사용 데이터는 쓰지 않는다. |
| `capture.js` | Edge(msedge) 헤드리스로 `postit.html`·`calendar.html` 구동 → 장면 촬영·GIF 프레임 촬영 |
| `cursor.js` | 촬영 주석용 커서 그림(SVG) — `cursor: grabbing` 과 같은 주먹 모양 |
| `cursor-preview.js` | 위 커서를 실제 크기·8배로 미리 보기 (`tools/cursor-preview.png` 생성) |
| `compose.js` | 확대 조각(dsf 3배) 촬영 + 국문/영문 연동 합성 컷 렌더 |
| `captionize.js` | 원본 위에 영문 캡션 띠를 붙여 `en/` 생성 (영문 리스팅 보류 — 보관용) |
| `captionize-kr.js` | 제출용 6장 위에 **국문 캡션 띠**를 붙여 `kr/` 생성 — 파트너센터에 올리는 판 (1920×1200 = 원본 1080 + 띠 120) |
| `capture-shell.js` | Electron 셸을 fresh `PETIT_USERDATA` 로 띄워 온보딩 스포트라이트 촬영 |
| `png.js` | 최소 PNG 디코더 + 정수배 박스 축소 (Node 내장 zlib만 사용) |
| `gif.js` | **GIF89a 인코더** — median-cut 팔레트 + 프레임 차분 + LZW (외부 의존성 0) |
| `make-gif.js` | `frames/*.png` → `demo-drag.gif` |
| `verify-gif.js` | 크로미움으로 GIF 를 열어 디코드·프레임 진행을 검증 |

---

## 4. 촬영 원칙 (지켜야 하는 것)

1. **앱을 고치지 않는다.** 촬영기는 앱·셸·채점기 파일을 읽고 구동만 한다. 저장소의
   `calendar.html`·`postit.html`·`electron/`·`protocol/grader/` 는 한 글자도 바뀌지 않는다.
   playwright 는 채점기의 `node_modules` 에서 `require` 만 한다.
2. **실사용 데이터를 쓰지 않는다.** 매 촬영마다 `os.tmpdir()` 아래 새 프로필을 만들고
   `tools/seed.js` 의 한국어 샘플을 `localStorage` 에 심는다. 사용자 프로필
   (`.edge\calendar`·`.edge\postit`)과 실제 `PETIT_USERDATA` 는 건드리지 않는다.
3. **오프라인 확인 겸용.** 촬영 중 http(s) 요청을 전부 차단하고 건수를 센다.
   현재 전 장면에서 **http(s) 0건 · pageerror 0건**으로 촬영된다.
4. **마우스 커서 표기 고지.** 헤드리스 캡처에는 OS 커서가 찍히지 않는다.
   드래그 장면(`screenshot-06`, `demo-drag.gif`)에 한해 **촬영 시점의 실제 포인터 좌표에**
   커서 그림을 얹는다. 모양은 앱이 드래그 중 실제로 지정하는 `cursor: grabbing`(주먹)과 같고,
   위치도 실제 포인터 위치와 같다. 그 외 UI는 전부 앱이 그린 그대로다.
5. **합성 컷은 합성임을 드러낸다.** `screenshot-11-*` 는 두 장의 실제 스크린샷 + 강조 링 +
   확대 조각 + 설명 문구로 만든 **마케팅 합성**이다. 스크린샷 안의 앱 화면 자체는 미가공이다.
6. 합성·캡션에 쓰는 폰트는 저장소 `assets/` 의 **Gaegu / Nanum Pen Script (OFL, 상업 배포 허용)**
   뿐이다. 외부 폰트·이미지를 새로 받지 않았다.

---

## 5. 영어권 리스팅 — ⛔ **이번 판 보류** (발주 #27, 2026-08-21)

**결정: 영문 리스팅을 내지 않는다.** 앱 UI 가 한국어 단일이고(`<html lang="ko">`, i18n 코드 0)
영어 UI 는 존재하지 않는다. 캡션만 영어인 스크린샷으로 영어권에 노출하면 설치 → 실행 →
"화면을 읽을 수 없다" → 1점이 되고, **G1 리뷰 하한을 채우려던 장치가 평점을 깎는다**
(`protocol/EXPERT-REVIEW.md` B6 · 부록 C 4-5). 그래서:

- `protocol/MARKET.md` G1 = **KR 마켓 단독**(리뷰 하한 10 → 5)로 환원.
- `protocol/STORE-GUIDE.md` 2단계의 영문 이름 예약 = **필수 → 선택(방어적 권장)** 으로 환원.
- `en/` 9장 · `store-description.en.md` · `screenshot-11-link-flow.en.png` 는 **삭제하지 않는다** —
  상태는 "**UI 영문화 발주 이후 사용**". 아래 캡션 자산은 그때 그대로 재사용한다.

### 아래는 보류 해제(=UI 영문화 완료) 시점에 쓸 자료다

- `en/` 판은 원본(1920×1080)을 **가리지 않고** 아래에 120px 캡션 띠를 덧붙인 **1920×1200** 이다.
- 띠 오른쪽에 `PetitCalendar · Korean UI` 를 항상 표기해 **UI 언어가 한국어임을 사전 고지**한다.
  (스토어 심사·환불 분쟁 예방 — 다만 **고지로 해결되는 문제가 아니라서** 이번 판은 보류를 택했다.)
- `store-description.en.md` 에는 이미 다음 한 줄이 들어가 있다:
  > **Note:** the app's interface is in Korean. Screenshots are captioned in English.
- 보류 해제 시 `en/` 판도 **발주 #13 이후 컷(06·07·08·09·10·12)만** 쓴다 — `en/03·04·05` 는 구버전 UI 라 §2-1 기준으로 보조용이다.

### 영문 캡션 초안 (현재 `en/` 에 적용된 문구)

| 대상 | 캡션 |
|---|---|
| 09 board | Your cork board on the desktop — pin notes anywhere, in five colors. |
| 06 drag | Grab a note and drop it anywhere — it lifts and tilts as you drag. |
| 07 note menu | Right-click a note: recolor, resize, add a photo, or set a date. |
| 08 calendar | Holidays, lunar dates, color tags — and 📌 notes from your wall. |
| 10 settings | Search every setting by name or #tag — no digging through tabs. |
| 12 onboarding | A four-step guided start — the app spotlights what to press next. |
| 03 decor | Decorate: backgrounds, masking tape, emoji and photo stickers. |
| 04 lavender | Premium theme: Lavender Mist — same board, a different mood. |
| 05 deep-sea | Premium theme: Deep-sea Blue — cozy for late nights. |

문구를 바꾸려면 `tools/captionize.js` 상단의 `CAPTIONS` 표만 고치고 다시 돌리면 된다.
한 줄에 안 들어가면(대략 72자 초과) 말줄임표로 잘리니 길이를 지킬 것.

### 예비 캡션 (교체·A/B 테스트용)

- Board: `Twelve notes, five colors, zero clutter — your desk board, digital.`
- Drag: `Pick it up, move it, let it go. That's the whole interaction.`
- Link: `A note with a date becomes a calendar entry. Automatically.`
- Offline: `No login, no server, no telemetry — your notes never leave this PC.`
- Backup: `If a save file is ever damaged, the original is kept, not lost.`

---

## 6. GIF 는 어떻게 만들었나 (ffmpeg 없이)

이 PC 에는 ffmpeg 도, gif 라이브러리도 없고 새로 설치할 수 없다. 그래서 **GIF89a 를 직접 썼다.**

1. `capture.js frames` — 드래그를 실제로 수행하면서 30프레임을 1100×620 클립으로 연속 촬영.
   왕복 곡선이라 마지막 프레임 다음이 곧 첫 프레임이 되어 루프 이음매가 보이지 않는다.
2. `png.js` — Node 내장 `zlib` 로 PNG 를 직접 디코드(IHDR/IDAT/필터 해제) 후 2배 박스 축소 → 550×310.
3. `gif.js` —
   - **median-cut** 으로 전 프레임 공통 255색 팔레트를 뽑고(255번은 투명 예약),
   - 이전 프레임과 **같은 픽셀은 투명 인덱스**로 두고 `disposal=1(그대로 두기)` 로 겹쳐 그린다.
     정지한 코르크 배경 덕에 실제로 인코딩되는 픽셀이 **전체의 12%** 로 줄었다.
   - GIF 표준 **LZW**(코드 폭 증가 시점을 디코더와 lock-step) + 255바이트 서브블록,
   - NETSCAPE2.0 확장으로 무한 루프.
4. `verify-gif.js` — 크로미움에 실제로 물려 `naturalWidth/Height` 와 프레임 진행을 확인한다.
   (검증 결과: 550×310 디코드 성공, 0.45초 간격 6회 캡처가 전부 서로 다른 프레임 = 재생 확인)

결과: **458 KB**. 프레임 수·간격·클립 영역은 `capture.js` 의 `captureFrames()`·`make-gif.js` 인자로 조절한다.

---

## 7. 남은 격차 / TODO

- **세로(9:16) 영상·모바일 컷 없음.** 이 앱은 Windows 데스크톱 전용이라 세로 화면 자체가 없다.
  숏폼(릴스/쇼츠)이 필요하면 1080×1920 캔버스 가운데에 가로 화면을 얹고 위아래를 코르크 질감으로
  채우는 합성이 필요하다 — `tools/compose.js` 를 본떠 만들면 된다. (미구현)
- **동영상(mp4/webm) 없음.** 인코더 없이 순수 Node 로 만들 수 있는 건 GIF 까지다.
  파트너센터 트레일러가 필요해지면 ffmpeg 도입 승인이 선행되어야 한다.
- **구버전 컷 01~05 는 §2-1 에서 보조용으로 내렸다.** 01·02 는 09(보드)·08(캘린더)로 갈음된다.
  `03`(꾸미기 패널)은 **대체 컷이 없어 제출 목록에 구멍**이 남았다 — `capture.js` 에 꾸미기 패널 장면을
  추가해 시드 데이터 기준으로 재촬영하면 7번 슬롯이 채워진다. (미구현)
- `screenshot-04/05` (프리미엄 테마)는 구버전 UI + **Pro 전용**이다. 첫 출시가 무료 단독인 동안에는
  재촬영해도 제출용이 아니다 — Pro 출시(2단계) 시점에 다시 찍는다.
- **탭바가 보이는 컷이 없다.** 설명문이 "한 창 두 탭"을 말하는데, 촬영기는 앱 뷰 영역만 잡아
  12번 컷에도 셸 탭바가 안 나온다. 단일 창 탭 모드를 한 장으로 보여주는 컷이 있으면 §2-2 의
  7~8번 슬롯이 채워진다 — `capture-shell.js` 의 클립 영역을 창 전체로 넓히면 된다. (미구현)
- 파트너센터 **identity 3값 대기**는 별개 게이트 (`protocol/STORE-GUIDE.md`).
