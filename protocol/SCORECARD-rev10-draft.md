# 채점표 rev.10 초안 — 발주 #33·#34·#36·#38 신규 계약 승격 (2026-08-24)

> **초안이다.** 정본 `SCORECARD.md`·채점기는 잠금(deny) 상태 — 사용자 승인·해제 후 반영한다 (rev.6 초안과 동일 절차).
> 반영 시: 아래 A51~A54 를 A행에 추가 + 스펙 4파일 신설 + SHA 재동결 + 잠금 복원.
> 구현은 전부 착지·스모크 완료 상태(발주 보고 참조) — 승격은 "이미 있는 동작의 회귀 감시 계약화"다.

## A51 — 셸 상주·알림 (발주 #33)

Electron 셸(`_electron.launch`, PETIT_USERDATA tmpdir)에서:
1. **즉시 표시**: 기동 시 창이 콘텐츠 로드 완료를 기다리지 않고 visible (launch 해석 시점 visible, backgroundColor 코르크 톤 — 흰 플래시 없음).
2. **닫기 1회 선택**: fresh 에서 X → 비모달 카드 1회([트레이에 두기]/[완전히 종료]) — `closeToTray`·`closeAskAck` 는 shell-settings.json additive(부재=현행 종료). [트레이에 두기] → 창 hide + 프로세스 생존 + 트레이 [열기] 복귀 + 재기동 후 X=카드 없이 트레이행.
3. **종료 우회**: `app.quit()`(Playwright electronApp.close() 포함)는 인터셉트를 우회해 1초 내 정상 종료 — 행 발생 = FAIL.
4. **OS 알림**: alarm-relay 수신 시 창 미표시/비포커스면 Notification 발화 코드 경로 도달(헤드리스에서 실표시 검증 불가 — 경로·에러 0 만), 창 표시·포커스 상태면 미발화.
5. 정적: `app.setAppUserModelId` 존재, Tray 생성 코드 존재, 알림 본문의 로그 기록 0건(개인정보).

## A52 — 백업 실패 노출·[복원] 원클릭 (발주 #33)

1. 자동 백업 강제 실패(부재 폴더) 시 `lastAutoAt` 미갱신 + `backup-config.json` 에 `lastAutoResult:{ok:false,…}` 영속 + 재기동 시 1회 실패 카드.
2. `[data-backup-restore]` 클릭 → 파일 선택 → 유효 백업이면 활성 앱에 병합 반영(포스트잇 노트 +N·중복 0) + 상태 줄에 결과. 이벤트 계약: `petit:restore-request` `{text,name}` → `petit:restore-result` `{ok,message}` (5초 무응답 강등 문구).
3. 이종 파일(캘린더 백업을 포스트잇에서) → `{ok:false}` 한국어 안내 + 데이터 불변 + pageerror 0.

## A53 — 휴지통 30일 (발주 #34, 양 앱)

1. **보관·비노출 양립**: 노트/일정 삭제 → A18·A20 기존 계약 그대로(전 키 평문 스캔 부재) + `postit-trash`/`cal-trash` 에 **base64 인코딩** 보관 존재.
2. **복원**: 설정 [데이터] 휴지통 목록([data-trash-list])에서 [복원] → 원래 보드/날짜에 원본 그대로(내용·중복 0), 휴지통에서 제거. 포스트잇 훅: `[data-trash-section]`·`[data-trash-item][data-tid]`·`[data-trash-restore]`·`[data-trash-delete]`·`[data-trash-clear]` / 캘린더 훅: `[data-trash-list]`·`[data-trash-restore]`·`[data-trash-purge]`·`[data-trash-clear]`.
3. **undo 중복 금지**: 삭제 → [실행 취소](또는 Ctrl+Z) → 휴지통에 해당 항목 부재.
4. **만료·상한**: 31일 경과 항목 주입 → 기동 후 부재. 상한(포스트잇 200건/700K자·캘린더 300건) 초과 → 오래된 것부터 제거. fresh = 키 부재(빈 휴지통은 키를 만들지 않는다).
5. 반복 일정: 발생분 삭제([data-del-one])·규칙 삭제 각각 복원 시 예외 포함 원상 복구 (캘린더).
6. 휴지통 손상 → `<키>-corrupt-<ts>` 백업 후 빈 휴지통, 크래시 0 (A9 규약 준용).

## A54 — 보드 줌 · 검색 승격 (발주 #36·#38, 포스트잇)

1. **줌 기본 항등**: fresh = `[data-board-zoom]` 래퍼에 transform 없음(A4·A23·A28 계약 경로 비트단위 불변).
2. Ctrl+휠 → 50~100% 배율, `[data-zoom-badge]` 는 100%≠일 때만 visible·클릭=100%. 보드 우클릭에 `[data-zoom-fit]`(전 노트 경계상자 수용, 하한 50)·`[data-zoom-reset]`(100%면 disabled).
3. **좌표 순수성**: 50% 상태에서 A4식 드래그 → 커서 추종 + **저장 좌표는 보드 좌표계**(배율 미혼입 — 100% 복귀 후 위치 동일). 배율은 `postit-settings.zoom` additive(부재=100), 재기동 복원.
4. **검색 승격**: 매칭 노트 computed z-index 상승(.search-hit) + **저장소 z 불변**(A24 저장소 불변 단언과 동일 방식). 사진 전용 노트(텍스트 빈+img)는 유효 opacity ≥0.6 유지. 매칭 0건 → `[data-search-hint]` visible("일치하는 메모가 없어요"), 검색 비우면 전부 원복.

## B 추가 단서 (초안)

- 휴지통 보관은 **가역 인코딩 필수**(평문 보관 금지 — A18·A20 비노출 계약 우선). 휴지통 quota 실패 시에도 삭제 자체는 진행.
- 줌 배율은 표시 전용 — 저장 좌표·겹침 판정·회수 로직에 배율 혼입 금지.
- 트레이행은 hide 만(창 destroy 금지 — 알림 폴링 유지). `before-quit` 우회 제거 금지(채점기 행 방지).

## 반영 절차 (해제 후)

1. 스펙 신설: `a51-shell-tray.spec.js`·`a52-backup-restore.spec.js`·`a53-trash.spec.js`·`a54-zoom-search.spec.js` (위 계약을 fail-closed 훅 기준으로).
2. SCORECARD.md A행 4개 추가 + 제목 rev.10 + B 단서 반영.
3. 전체 게이트(92테스트 예상) → SHA 재동결 → 잠금 복원 → CLAUDE.md 기준선 갱신.

## 알려진 절충 (검토용)

- 포스트잇 휴지통 quota 실패 안내는 undo 토스트 문구 병합(별도 토스트가 A20 필수 undo 토스트를 덮는 충돌 — 계약 우선 편차).
- 다중 창 동시 삭제 시 휴지통 보관분 경합 가능(read-append-write, 노트 본체는 merge-on-write 그대로 — 보관고 한정 리스크).
- OS 알림 실표시는 자동 판정 불가(헤드리스) — C 사람 시사 항목 후보.
