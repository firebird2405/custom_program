'use strict';
/**
 * A43 — 마이그레이션 (SCORECARD rev.6: 출시 트랙)
 * "도구가 소스 프로필 경로 인자를 받고(채점기는 tmpdir 픽스처 프로필을 msedge로 시딩 —
 *  실사용 .edge 불가침), 전 범위 이전이 항목별 관찰된다 — 모든 cal-*·postit-* localStorage 키
 *  (다중 보드 postit-notes-b*, 보드 이름, cal-repeats, 설정, 창 상태) + IndexedDB
 *  postit-decor·cal-decor 전수(배경 이미지·사진 스티커). 원본 불가침(읽기 전용) + 사본 독립성
 *  (원본 수정 후 사본 불변). 병합·멱등: Electron 저장소에 선-데이터가 있어도 무손실 병합,
 *  2회 실행 중복 0. 발견성: 기존 .edge 프로필 감지 시 첫 실행에 이전 제안 UI([data-migrate])
 *  visible, 거절 후에도 설정에서 재진입 가능"
 *
 * ── REQUIRED CONTRACT (rev.6 — 이 주석이 마이그레이션 계약의 정본, rev.5 관례) ──
 *  - 소스 지정: 환경변수 PETIT_SOURCE_CAL·PETIT_SOURCE_POSTIT (Edge 프로필 루트 경로 —
 *    내부 Default\Local Storage\leveldb 를 읽는다). CLI 인자 --source-cal=<dir>·
 *    --source-postit=<dir> 는 동등 훅. 미지정 시 기본값은 저장소 루트의 .edge\calendar·
 *    .edge\postit. 채점기는 환경변수 방식으로만 실행한다 (실사용 .edge 불가침).
 *  - 발견성 UI (Electron 셸 전용 레이어 — preload 주입, file:// 채점 55개에 미노출.
 *    제안 카드는 대표 창인 캘린더 창에 표시):
 *      [data-migrate]        이전 제안 카드 — 소스 감지 + 미이전 + 미거절 상태의 첫 실행에
 *                            캘린더 창에서 visible
 *      [data-migrate-run]    이전 실행(가져오기) 버튼 (카드 내부)
 *      [data-migrate-later]  거절(나중에) 버튼 (카드 내부) — 카드 닫힘 + 어떤 데이터도
 *                            이전하지 않음 + 거절 기억(다음 실행엔 카드 대신 재진입 칩)
 *      [data-migrate-open]   재진입 진입점(칩) — 미이전 상태면 거절 후에도 항상 visible,
 *                            클릭 시 카드 재표시 ("설정에서 재진입 가능"의 판정 번역).
 *                            동의어 별칭 [data-migrate-reopen] 병기 허용 (채점기는 둘 다 수용)
 *      [data-migrate-status] 진행/결과 상태 표기 (참고 훅 — 존재 판정만 하지 않음)
 *  - API: window.petit.migrate — contextBridge 노출 호출형 함수. migrate() 가 전 범위
 *    이전을 수행하는 Promise 를 반환(resolve = 성공). 객체형 { run() } 구현도 동등 수용.
 *    멱등: 재호출 중복 0. 이전 완료 플래그는 additive 키(cal-migrated)로 기억되어
 *    완료 후엔 카드·칩 미표시.
 *  - 전 범위(항목별 판정): 픽스처 스냅샷의 "모든" cal-*·postit-* 키가 같은 키 이름으로
 *    이전된다 — 하드코딩 키 목록 이전을 차단하기 위해 앱이 모르는 합성 키
 *    (cal-a43-synthetic·postit-a43-synthetic)도 시딩·판정한다 (D 배반 경로: 좁은 키만 이전).
 *    콘텐츠 키(cal-events·postit-notes·postit-notes-*)는 마커 정확 1건(병합·중복 0)으로,
 *    그 외 키는 값 동일(타깃에 선-값이 있던 키는 소스값 또는 선값 중 하나 — 제3의 손상값
 *    금지)로 판정한다. 셸 자체의 additive 키(cal-migrated·cal-migrate-declined·
 *    postit-onboarded)는 판정 대상 아님. IndexedDB: postit-decor/images·cal-decor/img 의
 *    시딩 레코드가 동일 키·동일 값으로 이전된다.
 *  - 원본 불가침: 이전 후 픽스처 프로필의 모든 시딩 키·IDB 값이 원문 그대로다
 *    (검증을 위해 채점기가 앱을 다시 여는 과정에서 앱 자신이 추가하는 키는 판정 외).
 *  - 사본 독립성: 이전 후 원본을 수정해도 Electron 사본은 불변.
 *  - fail-closed: 셸 미구축·[data-migrate]/window.petit.migrate 부재 시 크래시 없이
 *    한국어 FAIL. SKIP 은 비 Windows / msedge 미탐지(픽스처 시딩 불가) 뿐.
 */
const { test, expect } = require('@playwright/test');
const {
  CALENDAR_PATH,
  POSTIT_PATH,
  requirePostit,
  freshProfileDir,
  launchApp,
  closeApp,
  removeDirWithRetry,
  pollLocalStorage,
  pollPage,
  sleep,
  POSTIT_SEL,
  requireHook,
  addNote,
  setNoteText,
  pollVisibleNoteCount,
  hasVisibleNoteText,
} = require('../lib/helpers');
const {
  requireElectronShell,
  freshUserDataDir,
  launchElectronShell,
  getBothAppWindows,
  closeElectronShell,
  countVisibleStrict,
  pollVisibleStrict,
  requireHook6,
  dismissOnboardingIfPresent,
  dismissMigrateIfPresent,
  poll,
  occurrences,
  lsPrefixSnapshot,
  idbPutValue,
  idbGetValue,
  findEdgeExe,
  calDayCell,
  calAddViaForm,
} = require('../lib/electron-helpers');

/* 마커·합성 키 (fresh 픽스처 전용 — 실사용 데이터와 무관) */
const MK_CAL_EVENT = 'A43-엣지-원본-일정';
const MK_NOTE1 = 'A43-보드1-원본-노트';
const MK_NOTE_B2 = 'A43-보드2-원본-노트';
const MK_PRE_NOTE = 'A43-일렉트론-선데이터-노트';
const MK_PRE_EVENT = 'A43-일렉트론-선데이터-일정';
const MOD_MARK = 'A43-원본-수정후';
const SYN_CAL_KEY = 'cal-a43-synthetic';
const SYN_CAL_VAL = 'A43-합성-캘린더-값-이전대상';
const SYN_POST_KEY = 'postit-a43-synthetic';
const SYN_POST_VAL = 'A43-합성-포스트잇-값-이전대상';
const CONTENT_KEY_RE = /^(cal-events|postit-notes(-.*)?)$/;
/** 셸 자체의 additive 상태 키 — 이전 판정 대상에서 제외 */
const SHELL_STATE_KEY_RE = /^(cal-migrated|cal-migrate-declined|postit-onboarded)$/;

function skipUnlessRunnable() {
  test.skip(process.platform !== 'win32', 'Windows 전용 항목 — A43 을 명시적으로 SKIP 합니다 (rev.5 관례)');
  test.skip(!findEdgeExe(), 'msedge.exe 미탐지 — 픽스처 프로필 시딩 불가로 A43 을 명시적으로 SKIP 합니다 (a39 동일 조건)');
}

/** 시딩용 IDB 이미지(데이터 URL) 생성 — 프로필별 상이한 패턴 */
async function makeSeedImage(page, color, tag) {
  return page.evaluate(
    ({ color, tag }) => {
      const c = document.createElement('canvas');
      c.width = 48;
      c.height = 48;
      const x = c.getContext('2d');
      x.fillStyle = color;
      x.fillRect(0, 0, 48, 48);
      x.fillStyle = '#ffffff';
      x.font = '10px sans-serif';
      x.fillText(tag, 4, 24);
      return c.toDataURL('image/png');
    },
    { color, tag }
  );
}

/**
 * msedge 로 픽스처 프로필 2개(캘린더·포스트잇) 시딩 + 재개방 검증.
 * UI 경로(실스키마 보장: 일정 폼·노트·[data-add-board] 보드 2) + 합성 키 + IDB 시딩.
 * LevelDB 플러시 유실 대비 최대 2회(회차마다 새 프로필) 시도 — 모두 유실 시 환경 문제로 FAIL.
 * @returns {{calDir, postDir, calSnap, postSnap, imgCal, imgPost, createdDirs}}
 */
async function seedFixtures(dialogSink) {
  const createdDirs = [];
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const calDir = freshProfileDir('grader-a43-cal-');
    const postDir = freshProfileDir('grader-a43-post-');
    createdDirs.push(calDir, postDir);
    try {
      // ── 캘린더 픽스처 ──
      let app = await launchApp(calDir, CALENDAR_PATH);
      let imgCal;
      try {
        await calDayCell(app.page, 15).click();
        await calAddViaForm(app.page, '09:30', MK_CAL_EVENT);
        await pollLocalStorage(app.page, 'cal-events', (raw) => !!raw && raw.includes(MK_CAL_EVENT), 5000);
        await app.page.evaluate(({ k, v }) => localStorage.setItem(k, v), { k: SYN_CAL_KEY, v: SYN_CAL_VAL });
        imgCal = await makeSeedImage(app.page, '#aa3366', 'A43C');
        await idbPutValue(app.page, 'cal-decor', 'img', 'bg', imgCal);
        await sleep(800);
        dialogSink.push(...app.state.dialogs);
      } finally {
        await closeApp(app);
      }

      // ── 포스트잇 픽스처 (보드 2 포함 — 실스키마는 앱 UI 로 생성) ──
      app = await launchApp(postDir, POSTIT_PATH);
      let imgPost;
      try {
        await addNote(app.page);
        await pollVisibleNoteCount(app.page, 1, 5000, 'A43 시딩');
        await setNoteText(app.page, app.page.locator(POSTIT_SEL.NOTE).first(), MK_NOTE1);
        await pollLocalStorage(app.page, 'postit-notes', (raw) => !!raw && raw.includes(MK_NOTE1), 5000);
        const addBoard = await requireHook(app.page, '[data-add-board]', 'A43 시딩(보드 2)');
        await addBoard.click();
        await sleep(300);
        await addNote(app.page);
        await setNoteText(app.page, app.page.locator(POSTIT_SEL.NOTE).last(), MK_NOTE_B2);
        await pollPage(
          app.page,
          (b) =>
            Object.keys(localStorage).some(
              (k) => /^postit-notes-/.test(k) && !/corrupt/.test(k) && (localStorage.getItem(k) || '').includes(b)
            ),
          MK_NOTE_B2,
          5000,
          'A43 시딩: 보드 2 노트가 postit-notes- 접두 키에 저장되지 않았습니다'
        );
        await app.page.evaluate(({ k, v }) => localStorage.setItem(k, v), { k: SYN_POST_KEY, v: SYN_POST_VAL });
        imgPost = await makeSeedImage(app.page, '#3366aa', 'A43P');
        await idbPutValue(app.page, 'postit-decor', 'images', 'a43-img-1', imgPost);
        await sleep(800);
        dialogSink.push(...app.state.dialogs);
      } finally {
        await closeApp(app);
      }

      // ── 재개방 검증 (디스크 반영 확인 + 스냅샷 확정) ──
      app = await launchApp(calDir, CALENDAR_PATH);
      let calSnap;
      let calIdb;
      try {
        calSnap = await lsPrefixSnapshot(app.page);
        calIdb = await idbGetValue(app.page, 'cal-decor', 'img', 'bg');
        dialogSink.push(...app.state.dialogs);
      } finally {
        await closeApp(app);
      }
      app = await launchApp(postDir, POSTIT_PATH);
      let postSnap;
      let postIdb;
      try {
        postSnap = await lsPrefixSnapshot(app.page);
        postIdb = await idbGetValue(app.page, 'postit-decor', 'images', 'a43-img-1');
        dialogSink.push(...app.state.dialogs);
      } finally {
        await closeApp(app);
      }

      const ok =
        (calSnap['cal-events'] || '').includes(MK_CAL_EVENT) &&
        calSnap[SYN_CAL_KEY] === SYN_CAL_VAL &&
        calIdb === imgCal &&
        (postSnap['postit-notes'] || '').includes(MK_NOTE1) &&
        Object.keys(postSnap).some((k) => /^postit-notes-/.test(k) && (postSnap[k] || '').includes(MK_NOTE_B2)) &&
        postSnap[SYN_POST_KEY] === SYN_POST_VAL &&
        postIdb === imgPost;
      if (ok) return { calDir, postDir, calSnap, postSnap, imgCal, imgPost, createdDirs };
      lastErr = new Error('시딩 데이터가 재개방에서 확인되지 않았습니다 (localStorage/IDB 플러시 유실 의심)');
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    'A43: 픽스처 프로필 시딩 실패 (2회 시도) — msedge 프로필 localStorage/IndexedDB 저장이 재개방을 살아남지 못했습니다. ' +
      '환경 문제(LevelDB 손상 등)일 수 있습니다 (백업/이전 도구 결함 아님): ' +
      (lastErr ? lastErr.message : '(원인 불명)')
  );
}

/** window.petit.migrate API(contextBridge) 존재 판정 — 호출형/객체형 둘 다 수용, fail-closed */
async function requirePetitMigrate(page, label) {
  const petitOk = await page.evaluate(() => {
    const p = window.petit;
    if (typeof p !== 'object' || p === null) return false;
    const m = p.migrate;
    return typeof m === 'function' || (typeof m === 'object' && m !== null && typeof m.run === 'function');
  });
  expect(
    petitOk,
    `${label}: window.petit.migrate (호출형 함수 또는 {run()}) 가 노출되지 않았습니다 — preload contextBridge 계약 미구현 ` +
      '(electron 셸 마이그레이션 레이어 미구축, fail-closed)'
  ).toBe(true);
}

/** 재진입 칩 셀렉터 — 정본 [data-migrate-open] + 동의어 별칭 [data-migrate-reopen] */
const MIGRATE_OPEN_SEL = '[data-migrate-open], [data-migrate-reopen]';

/** 카드([data-migrate])의 [data-migrate-run] 클릭 → 이전 완료 폴링 (마커·합성 키 관찰) */
async function acceptAndAwaitMigration(calPage, label) {
  const acceptBtn = await requireHook6(calPage, '[data-migrate-run]', label + ' 이전 실행 버튼');
  await acceptBtn.click({ timeout: 5000 });
  await poll(
    () =>
      calPage.evaluate(
        ({ synCal, synPost, mkCal, mkNote, mkB2 }) => {
          const has = (k) => localStorage.getItem(k) !== null;
          const inc = (k, m) => (localStorage.getItem(k) || '').includes(m);
          const b2 = Object.keys(localStorage).some(
            (k) => /^postit-notes-/.test(k) && !/corrupt/.test(k) && inc(k, mkB2)
          );
          return has(synCal) && has(synPost) && inc('cal-events', mkCal) && inc('postit-notes', mkNote) && b2;
        },
        { synCal: SYN_CAL_KEY, synPost: SYN_POST_KEY, mkCal: MK_CAL_EVENT, mkNote: MK_NOTE1, mkB2: MK_NOTE_B2 }
      ),
    60000,
    `${label}: [data-migrate-run] 클릭 후 60초 내 전 범위 이전(마커·합성 키·보드 2 키)이 localStorage 에서 관찰되지 않았습니다 — ` +
      'window.petit.migrate() 실패 또는 좁은 키만 이전 의심'
  );
  await pollVisibleStrict(
    calPage,
    '[data-migrate]',
    false,
    15000,
    `${label}: 이전 완료 후 15초 내 제안 카드([data-migrate])가 닫히지 않았습니다`
  );
}

test.describe('A43 마이그레이션', () => {
  test('A43: 전 범위 이전 — 항목별 키·IDB 전수 + 선데이터 무손실 병합 + 2회 멱등 + 원본 불가침 + 사본 독립성', async () => {
    test.setTimeout(600 * 1000);
    skipUnlessRunnable();
    requireElectronShell('A43');
    requirePostit();

    const dialogs = [];
    let fixtures = null;
    const target = freshUserDataDir('grader-a43-target-');
    let shell = null;
    try {
      // ── ① 픽스처 시딩 (tmpdir — 실사용 .edge 불가침) ──
      fixtures = await seedFixtures(dialogs);
      const fixtureSnap = Object.assign({}, fixtures.calSnap, fixtures.postSnap);

      // ── ② Electron 선-데이터 (소스 미지정 기동 — 제안 카드는 "나중에"로 닫는다) ──
      shell = await launchElectronShell(target, { label: 'A43 선데이터' });
      let { calPage, postitPage } = await getBothAppWindows(shell, 'A43 선데이터');
      await dismissOnboardingIfPresent(postitPage, 'A43 선데이터');
      await dismissMigrateIfPresent(calPage, 'A43 선데이터'); // 기본 소스(.edge) 감지 카드 — 거절 기억됨
      await addNote(postitPage);
      await pollVisibleNoteCount(postitPage, 1, 5000, 'A43 선데이터');
      await setNoteText(postitPage, postitPage.locator(POSTIT_SEL.NOTE).first(), MK_PRE_NOTE);
      await pollLocalStorage(postitPage, 'postit-notes', (raw) => !!raw && raw.includes(MK_PRE_NOTE), 5000);
      await calDayCell(calPage, 20).click();
      await calAddViaForm(calPage, '18:00', MK_PRE_EVENT);
      await pollLocalStorage(calPage, 'cal-events', (raw) => !!raw && raw.includes(MK_PRE_EVENT), 5000);
      const preSnap = await lsPrefixSnapshot(postitPage);
      dialogs.push(...shell.state.dialogs);
      await sleep(1200);
      await closeElectronShell(shell);
      shell = null;

      // ── ③ 소스 지정 기동 → 거절 상태에서도 재진입 칩으로 카드 재개 → 이전 실행 ──
      //    (첫 실행 auto 카드 발견성은 별도 발견성 테스트가 fresh 프로필로 판정)
      shell = await launchElectronShell(target, {
        label: 'A43',
        env: { PETIT_SOURCE_CAL: fixtures.calDir, PETIT_SOURCE_POSTIT: fixtures.postDir },
      });
      ({ calPage, postitPage } = await getBothAppWindows(shell, 'A43'));
      await dismissOnboardingIfPresent(postitPage, 'A43');
      await requirePetitMigrate(calPage, 'A43');
      await pollVisibleStrict(
        calPage,
        MIGRATE_OPEN_SEL,
        true,
        15000,
        'A43: 거절 기억 상태의 재기동에서 재진입 진입점([data-migrate-open])이 캘린더 창에 표시되지 않았습니다 — ' +
          '거절 후에도 재진입 가능해야 합니다 (electron 셸 마이그레이션 레이어 미구축 또는 발견성 계약 미구현, fail-closed)'
      );
      await calPage.locator(MIGRATE_OPEN_SEL).first().click({ timeout: 5000 });
      await pollVisibleStrict(
        calPage,
        '[data-migrate]',
        true,
        5000,
        'A43: [data-migrate-open] 클릭 후 5초 내 이전 제안 카드([data-migrate])가 표시되지 않았습니다'
      );
      await acceptAndAwaitMigration(calPage, 'A43');

      // ── ④ 항목별 이전 판정 (postit 창은 재로드 전 — 앱 재기록 교란 최소화) ──
      const postSnap1 = await lsPrefixSnapshot(postitPage);
      for (const key of Object.keys(fixtureSnap)) {
        if (CONTENT_KEY_RE.test(key) || SHELL_STATE_KEY_RE.test(key)) continue; // 콘텐츠 키는 아래 마커 판정
        expect(
          Object.prototype.hasOwnProperty.call(postSnap1, key),
          `A43: 픽스처 키 "${key}" 가 이전되지 않았습니다 (전 범위: 모든 cal-*·postit-* 키 — 좁은 키 목록 이전 금지)`
        ).toBe(true);
        const got = postSnap1[key];
        const fixture = fixtureSnap[key];
        const pre = Object.prototype.hasOwnProperty.call(preSnap, key) ? preSnap[key] : undefined;
        const okVal = got === fixture || (pre !== undefined && got === pre);
        expect(
          okVal,
          `A43: 키 "${key}" 의 이전 결과가 소스값도 선값도 아닙니다 (제3의 손상값 금지) — ` +
            `소스 "${String(fixture).slice(0, 80)}" / 선값 "${String(pre).slice(0, 80)}" / 결과 "${String(got).slice(0, 80)}"`
        ).toBe(true);
      }
      // 콘텐츠 키: 마커 정확 1건 (병합 무손실 + 중복 0)
      const markerChecks = [
        ['cal-events', MK_CAL_EVENT, '픽스처 일정'],
        ['cal-events', MK_PRE_EVENT, '선데이터 일정'],
        ['postit-notes', MK_NOTE1, '픽스처 보드 1 노트'],
        ['postit-notes', MK_PRE_NOTE, '선데이터 노트'],
      ];
      for (const [key, marker, label] of markerChecks) {
        const n = occurrences(postSnap1[key], marker);
        expect(
          n,
          `A43: ${label}("${marker}")이 키 "${key}" 에 ${n}건입니다 (정확히 1건 — 무손실 병합 + 중복 0)`
        ).toBe(1);
      }
      const b2Keys = Object.keys(postSnap1).filter(
        (k) => /^postit-notes-/.test(k) && !/corrupt/.test(k) && occurrences(postSnap1[k], MK_NOTE_B2) > 0
      );
      expect(
        b2Keys.length === 1 && occurrences(postSnap1[b2Keys[0]], MK_NOTE_B2) === 1,
        `A43: 보드 2 노트("${MK_NOTE_B2}")가 postit-notes- 접두 키에 정확히 1건 존재하지 않습니다 ` +
          `(발견 키: ${b2Keys.join(', ') || '없음'})`
      ).toBe(true);
      // IndexedDB 전수
      const idbPost = await idbGetValue(postitPage, 'postit-decor', 'images', 'a43-img-1');
      expect(
        idbPost === fixtures.imgPost,
        'A43: IndexedDB postit-decor/images 의 시딩 레코드(a43-img-1)가 동일 값으로 이전되지 않았습니다 (IDB 전수 계약)'
      ).toBe(true);
      const idbCal = await idbGetValue(postitPage, 'cal-decor', 'img', 'bg');
      expect(
        idbCal === fixtures.imgCal,
        'A43: IndexedDB cal-decor/img 의 배경 이미지(bg)가 동일 값으로 이전되지 않았습니다 (IDB 전수 계약)'
      ).toBe(true);

      // ── ⑤ 멱등: window.petit.migrate 재호출 → 중복 0 + 신규 키 0 ──
      await postitPage.evaluate(() => {
        const m = window.petit.migrate;
        return Promise.resolve(typeof m === 'function' ? m() : m.run()).then(() => true);
      });
      await sleep(1500);
      const postSnap2 = await lsPrefixSnapshot(postitPage);
      for (const [key, marker, label] of markerChecks) {
        const n = occurrences(postSnap2[key], marker);
        expect(n, `A43: 2회 실행 후 ${label}("${marker}")이 "${key}" 에 ${n}건입니다 (중복 0 — 정확히 1건 유지)`).toBe(1);
      }
      const newKeys = Object.keys(postSnap2).filter(
        (k) => !Object.prototype.hasOwnProperty.call(postSnap1, k) && !SHELL_STATE_KEY_RE.test(k)
      );
      expect(newKeys.length, `A43: 2회 실행이 신규 키를 만들었습니다 (멱등 위반): ${newKeys.join(', ')}`).toBe(0);

      // ── ⑥ UI 확인 (재로드 후 실표시 — 완료 상태에선 카드·칩 미표시) ──
      await postitPage.reload({ waitUntil: 'load' });
      await calPage.reload({ waitUntil: 'load' });
      await sleep(700);
      expect(
        (await countVisibleStrict(calPage, '[data-migrate]')) === 0,
        'A43: 이전 완료 후 재로드에서 제안 카드([data-migrate])가 다시 표시되었습니다 (완료 상태 기억 필요)'
      ).toBe(true);
      const tabs = postitPage.locator('[data-board-tab]');
      const tabCount = await tabs.count();
      expect(tabCount >= 2, `A43: 이전 후 보드 탭([data-board-tab])이 ${tabCount}개입니다 (보드 2 이전으로 2개 이상이어야 함)`).toBe(true);
      await tabs.first().click({ timeout: 3000 });
      await sleep(300);
      for (const m of [MK_NOTE1, MK_PRE_NOTE]) {
        expect(
          await hasVisibleNoteText(postitPage, m),
          `A43: 이전 후 보드 1에서 "${m}" 노트가 표시되지 않습니다 (병합 결과 실표시 실패)`
        ).toBe(true);
      }
      await tabs.last().click({ timeout: 3000 });
      await sleep(300);
      expect(
        await hasVisibleNoteText(postitPage, MK_NOTE_B2),
        `A43: 이전 후 보드 2에서 "${MK_NOTE_B2}" 노트가 표시되지 않습니다`
      ).toBe(true);
      await calDayCell(calPage, 15).click();
      await expect(
        calPage.locator('#eventList li', { hasText: MK_CAL_EVENT }),
        `A43: 이전 후 15일에 픽스처 일정("${MK_CAL_EVENT}")이 표시되지 않습니다`
      ).toBeVisible();
      await calDayCell(calPage, 20).click();
      await expect(
        calPage.locator('#eventList li', { hasText: MK_PRE_EVENT }),
        `A43: 이전 후 20일에 선데이터 일정("${MK_PRE_EVENT}")이 유실되었습니다 (무손실 병합 위반)`
      ).toBeVisible();
      dialogs.push(...shell.state.dialogs);
      await sleep(1200);
      await closeElectronShell(shell);
      shell = null;

      // ── ⑦ 원본 불가침: 픽스처 프로필 재개방 → 시딩 키·IDB 원문 그대로 ──
      let app = await launchApp(fixtures.calDir, CALENDAR_PATH);
      try {
        const snapNow = await lsPrefixSnapshot(app.page);
        for (const key of Object.keys(fixtures.calSnap)) {
          expect(
            snapNow[key] === fixtures.calSnap[key],
            `A43: 이전 후 원본(캘린더 픽스처)의 키 "${key}" 가 변경/삭제되었습니다 — 원본 읽기 전용 계약 위반 (B: 마이그레이션 원본 삭제·변형 금지)`
          ).toBe(true);
        }
        const idbNow = await idbGetValue(app.page, 'cal-decor', 'img', 'bg');
        expect(idbNow === fixtures.imgCal, 'A43: 이전 후 원본(캘린더 픽스처)의 IDB 배경 이미지가 변경되었습니다 (읽기 전용 위반)').toBe(true);
        dialogs.push(...app.state.dialogs);
      } finally {
        await closeApp(app);
      }
      app = await launchApp(fixtures.postDir, POSTIT_PATH);
      try {
        const snapNow = await lsPrefixSnapshot(app.page);
        for (const key of Object.keys(fixtures.postSnap)) {
          expect(
            snapNow[key] === fixtures.postSnap[key],
            `A43: 이전 후 원본(포스트잇 픽스처)의 키 "${key}" 가 변경/삭제되었습니다 — 원본 읽기 전용 계약 위반`
          ).toBe(true);
        }
        const idbNow = await idbGetValue(app.page, 'postit-decor', 'images', 'a43-img-1');
        expect(idbNow === fixtures.imgPost, 'A43: 이전 후 원본(포스트잇 픽스처)의 IDB 레코드가 변경되었습니다 (읽기 전용 위반)').toBe(true);
        // ── ⑧ 사본 독립성 준비: 원본 수정 ──
        await app.page.evaluate(({ k, v }) => localStorage.setItem(k, v), { k: SYN_POST_KEY, v: MOD_MARK });
        await sleep(800);
        dialogs.push(...app.state.dialogs);
      } finally {
        await closeApp(app);
      }

      // ── ⑧ 사본 독립성: 원본 수정 후 Electron 재기동(소스 미지정) → 사본 불변 ──
      shell = await launchElectronShell(target, { label: 'A43 독립성' });
      ({ postitPage } = await getBothAppWindows(shell, 'A43 독립성'));
      const indep = await postitPage.evaluate(
        ({ k, want, mod }) => {
          const val = localStorage.getItem(k);
          let modFound = false;
          for (let i = 0; i < localStorage.length; i++) {
            const kk = localStorage.key(i);
            if ((localStorage.getItem(kk) || '').includes(mod)) modFound = true;
          }
          return { val, same: val === want, modFound };
        },
        { k: SYN_POST_KEY, want: SYN_POST_VAL, mod: MOD_MARK }
      );
      expect(
        indep.same,
        `A43: 원본 수정 후 Electron 사본의 "${SYN_POST_KEY}" 가 변했습니다 (사본 독립성 위반 — 값: "${String(indep.val).slice(0, 80)}")`
      ).toBe(true);
      expect(indep.modFound, `A43: 원본에만 기록한 수정 마커("${MOD_MARK}")가 Electron 사본에서 발견되었습니다 (사본 독립성 위반)`).toBe(false);
      dialogs.push(...shell.state.dialogs);

      expect(
        dialogs,
        `A43: 검사 중 dialog ${dialogs.length}건 발생 (0건이어야 함): ` +
          dialogs.map((d) => d.type + ':' + d.message).join(' | ')
      ).toHaveLength(0);
    } finally {
      await closeElectronShell(shell);
      await removeDirWithRetry(target);
      if (fixtures) for (const d of fixtures.createdDirs) await removeDirWithRetry(d);
    }
  });

  test('A43: 발견성 — fresh 첫 실행 카드 표시·거절 시 미이전+앱 정상·재진입 칩([data-migrate-open])', async () => {
    test.setTimeout(300 * 1000);
    skipUnlessRunnable();
    requireElectronShell('A43');
    requirePostit();

    const dialogs = [];
    const calDir = freshProfileDir('grader-a43d-cal-');
    const postDir = freshProfileDir('grader-a43d-post-');
    const target = freshUserDataDir('grader-a43d-target-');
    let shell = null;
    try {
      // 경량 시딩 — 발견성은 프로필 존재+마커만 필요
      let app = await launchApp(calDir, CALENDAR_PATH);
      try {
        await calDayCell(app.page, 15).click();
        await calAddViaForm(app.page, '09:30', MK_CAL_EVENT);
        await pollLocalStorage(app.page, 'cal-events', (raw) => !!raw && raw.includes(MK_CAL_EVENT), 5000);
        await sleep(500);
        dialogs.push(...app.state.dialogs);
      } finally {
        await closeApp(app);
      }
      app = await launchApp(postDir, POSTIT_PATH);
      try {
        await addNote(app.page);
        await setNoteText(app.page, app.page.locator(POSTIT_SEL.NOTE).first(), MK_NOTE1);
        await pollLocalStorage(app.page, 'postit-notes', (raw) => !!raw && raw.includes(MK_NOTE1), 5000);
        await sleep(500);
        dialogs.push(...app.state.dialogs);
      } finally {
        await closeApp(app);
      }

      shell = await launchElectronShell(target, {
        label: 'A43 발견성',
        env: { PETIT_SOURCE_CAL: calDir, PETIT_SOURCE_POSTIT: postDir },
      });
      const { calPage, postitPage } = await getBothAppWindows(shell, 'A43 발견성');
      await dismissOnboardingIfPresent(postitPage, 'A43 발견성');
      await requirePetitMigrate(calPage, 'A43 발견성');

      // fresh 첫 실행: 캘린더 창에 제안 카드 auto visible
      await pollVisibleStrict(
        calPage,
        '[data-migrate]',
        true,
        15000,
        'A43: 소스 감지 fresh 첫 실행에서 캘린더 창에 이전 제안 카드([data-migrate])가 표시되지 않았습니다 — ' +
          'electron 셸 마이그레이션 레이어 미구축 (2단계 진행 중) 또는 발견성 계약 미구현 (fail-closed)'
      );

      // 거절([data-migrate-later]) → 카드 닫힘 + 어떤 데이터도 이전되지 않음 + 앱 정상
      const later = await requireHook6(calPage, '[data-migrate-later]', 'A43 거절 버튼');
      await later.click({ timeout: 5000 });
      await pollVisibleStrict(calPage, '[data-migrate]', false, 5000, 'A43: [data-migrate-later] 클릭 후 5초 내 제안 카드가 닫히지 않았습니다');
      const migrated = await calPage.evaluate(
        ({ a, b }) => {
          for (let i = 0; i < localStorage.length; i++) {
            const v = localStorage.getItem(localStorage.key(i)) || '';
            if (v.includes(a) || v.includes(b)) return true;
          }
          return false;
        },
        { a: MK_CAL_EVENT, b: MK_NOTE1 }
      );
      expect(migrated, 'A43: 거절([data-migrate-later]) 했는데 소스 데이터가 이전되었습니다 (거절 = 미이전 계약)').toBe(false);
      await addNote(postitPage);
      await pollVisibleNoteCount(postitPage, 1, 5000, 'A43 거절 후 앱 정상');

      // 재진입: [data-migrate-open] 칩 visible → 클릭 시 카드 재표시
      await requireHook6(calPage, MIGRATE_OPEN_SEL, 'A43 재진입 진입점');
      await pollVisibleStrict(
        calPage,
        MIGRATE_OPEN_SEL,
        true,
        5000,
        'A43: 거절 직후 재진입 진입점([data-migrate-open])이 visible 하지 않습니다 — 거절 후에도 재진입 가능해야 합니다 (fail-closed)'
      );
      await calPage.locator(MIGRATE_OPEN_SEL).first().click({ timeout: 5000 });
      await pollVisibleStrict(
        calPage,
        '[data-migrate]',
        true,
        5000,
        'A43: [data-migrate-open] 클릭 후 5초 내 이전 제안 카드([data-migrate])가 재표시되지 않았습니다'
      );

      dialogs.push(...shell.state.dialogs);
      expect(
        dialogs,
        `A43: 검사 중 dialog ${dialogs.length}건 발생 (0건이어야 함): ` +
          dialogs.map((d) => d.type + ':' + d.message).join(' | ')
      ).toHaveLength(0);
    } finally {
      await closeElectronShell(shell);
      await removeDirWithRetry(target);
      await removeDirWithRetry(calDir);
      await removeDirWithRetry(postDir);
    }
  });
});
