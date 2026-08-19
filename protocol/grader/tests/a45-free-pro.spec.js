'use strict';
/**
 * A45 — Free/Pro 경계 (SCORECARD rev.6)
 * "Free 하한 = 2026-08-18 동결 빌드의 실제 기능 집합 전체(사진 첨부·사진 스티커·배경 업로드·
 *  스티커 3세트·스킨 3종·꾸미기 전부·보드 3개까지 포함). 회귀 안티-테스트: 이 중 하나라도
 *  잠기면 FAIL. Pro = 순수 신규 가치만: 신규 스티커 ≥2팩(팩당 ≥8종, 기존과 중복 0, 매니페스트로
 *  검증)·신규 프리미엄 스킨/테마 ≥2종(기존과 색거리 ≥40)·보드 4개째부터·Electron 예약 자동 백업.
 *  라이선스 = 서명 파일 방식(앱엔 공개키만, WebCrypto 오프라인 검증): 잠금 UI([data-pro-lock])
 *  관찰 → 커밋된 테스트 라이선스([data-license-import]) 적용 → 즉시 해제+재기동 유지 →
 *  바이트 변조 라이선스는 거부"
 *
 * ══ rev.6 필수 계약 (REQUIRED CONTRACT — 본 주석이 A45 DOM·파일 계약의 정본) ══
 *
 * 0) 실행 컨텍스트: Electron 셸(_electron.launch, 개발 트리 electron/, PETIT_USERDATA=fresh
 *    tmpdir). 셸 미구축 시 "electron 셸 미구축 (2단계 진행 중)" 한국어 FAIL (fail-closed).
 *
 * 1) Free 동결 하한 (동결 기준 = 2026-08-18 postit.html — 아래 셀렉터는 동결 빌드의 실측 UI):
 *    라이선스가 없는 fresh 프로필에서 다음이 전부 동작해야 한다. 하나라도 잠기면 FAIL.
 *      - 노트 사진 첨부: [data-ctx-menu] [data-ctx-item]("사진"|"이미지") +
 *        input[type=file][data-note-image-input] (A26 계약 재단언)
 *      - 꾸미기 패널: #decorBtn 클릭으로 열림 (배경/스티커/사진 스티커/테이프/프레임 섹션)
 *      - 배경 프리셋: #dpBg button[data-bg] (cork/wood/linen/chalk) — 적용 시 .decor-bg.on.bg-<id>
 *      - 배경 업로드: #dpBgUpload + input[data-decor-bg-input] → .decor-bg.on 의
 *        background-image 에 data:image 반영 (IndexedDB 경유)
 *      - 스티커 3세트: #dpStSeason·#dpStMood·#dpStOffice 각 버튼 ≥12개, 클릭 → [data-sticker] 부착
 *      - 사진 스티커: #dpPhotoAdd + input[data-decor-photo-input] → [data-sticker].photo img(data:image)
 *      - 스킨 3종: 노트 활성/컨텍스트 메뉴의 [data-skin] + [data-skin-option] ≥3 (A27 계약 재단언)
 *      - 보드 3개: [data-add-board] 로 [data-board-tab] 3개까지 생성 가능 (A25 계약 확장 재단언)
 *      - 테이프/프레임: #dpTapeColor [data-tval]·#dpFrame [data-fval] 선택 동작(.sel 반영)
 *    비잠금 판정: 위 Free 컨트롤은 disabled 가 아니고 조상/자신에 [data-pro-lock] 이 없어야 한다.
 *
 * 2) 잠금 표현 계약: 잠긴 Pro 요소 = 엄격 가시(visible) [data-pro-lock] 요소. 해제 상태 =
 *    visible [data-pro-lock] 0개(제거 또는 숨김). 라이선스 없는 상태에서 잠금 UI 는
 *    꾸미기 패널 또는 보드 3개 상태의 [data-add-board] 클릭(4번째 시도)으로 도달·관찰 가능해야
 *    하고, 이때 4번째 보드는 실제로 생성되지 않아야 한다(기능 잠금 실증).
 *
 * 3) Pro 신규성 매니페스트: assets/pro/pro-manifest.json (UTF-8 JSON, 커밋 대상):
 *      { "stickerPacks": [ { "id", "name", "stickers": [식별자 ≥8] } … ≥2팩 ],
 *        "skins":        [ { "id", "name", "baseColor": "#RRGGBB" } … ≥2종 ] }
 *    - stickers 식별자: 이모지 문자열 또는 assets/ 하위 상대 경로(경로형이면 파일 실존 검사).
 *    - 전 팩 통틀어 중복 0 + 동결 무료 3세트 45종(본 스펙에 동결 전재)과 교집합 0.
 *    - skins.baseColor: 기존 테마 3종(basic/dark/white — [data-theme-preset] 실측 문서 배경색)
 *      각각과 RGB 거리 ≥40, 신규 스킨끼리도 ≥40 (기존 재포장·자기 복제 차단, D 굿하트).
 *
 * 4) 라이선스 픽스처 계약: electron/test-license/petit-test.license (커밋된 정식 서명
 *    테스트 라이선스, 1바이트~64KB 단일 파일 — 내부 형식은 구현 자유이나 서명 검증 필수).
 *    앱에는 공개키만 내장(WebCrypto 오프라인 검증) — 개인키·서명 생성 코드는 앱·배포물에
 *    포함 금지. [data-license-import]: DOM 존재 필수, 자신이 input[type=file] 이거나
 *    하위에 input[type=file] 을 두거나 클릭 시 filechooser 를 연다(셋 중 하나 — 채점기가
 *    이 순서로 시도). 숨겨져 있으면 visible [data-pro-lock] 클릭으로 visible 이 되어야 한다.
 *    적용 → 5초 내 visible [data-pro-lock] 0 + 4번째 보드 생성 성공. 같은 userData 재기동 →
 *    해제 유지. 바이트 변조본(중앙 1바이트 반전) → 잠금 유지 + 4번째 보드 차단 + 크래시·dialog 0.
 *
 * 셸·훅·픽스처 미구현 = 즉시 한국어 FAIL (fail-closed, skip-pass 금지).
 * 공통 규정: dialog 0건·pageerror 0건.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
  APP_ROOT,
  POSTIT_PATH,
  requirePostit,
  withFreshApp,
  removeDirWithRetry,
  sleep,
  POSTIT_SEL,
  assertNoDialogs,
  requireHook,
  addNote,
  pollVisibleNoteCount,
  pollPage,
  openContextMenuOn,
  parseRgb,
  rgbDist,
} = require('../lib/helpers');
const {
  ELECTRON_DIR,
  requireElectronShell,
  freshUserDataDir,
  launchElectronShell,
  getAppWindow,
  closeElectronShell,
  countVisibleStrict,
  pollVisibleStrict,
  dismissOnboardingIfPresent,
  dismissMigrateIfPresent,
} = require('../lib/electron-helpers');

const PRO_MANIFEST_PATH = path.join(APP_ROOT, 'assets', 'pro', 'pro-manifest.json');
const LICENSE_FIXTURE_PATH = path.join(ELECTRON_DIR, 'test-license', 'petit-test.license');
const MIN_COLOR_DIST = 40;

/* ── 동결 무료 스티커 3세트 (2026-08-18 postit.html EMOJI_SETS 원문 전재 — 45종) ──
 * Pro 팩은 이 45종과 교집합 0 이어야 한다 (기존 무료 에셋의 Pro 재포장 금지, B rev.6). */
const FROZEN_FREE_STICKERS = [
  '🌸', '🌷', '🌻', '🍀', '🌿', '🍁', '🍂', '🍄', '⛄', '❄️', '🌊', '☀️', '🌙', '🌈', '🎄',
  '😀', '😍', '🥳', '😎', '🤔', '😴', '😭', '😡', '🤩', '🥰', '😆', '🙌', '💖', '✨', '🔥',
  '📌', '📎', '✏️', '📚', '💡', '📅', '⏰', '✅', '❗', '⭐', '📞', '💻', '☕', '📝', '📊',
];

/** 큰 JPEG 픽스처 런타임 생성 (a26 관용구 — 채점기 저장소에 이미지 미포함) */
async function makeJpegFixture(page, tmpDir, name) {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1600;
    c.height = 1200;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 1600, 1200);
    g.addColorStop(0, '#ff8800');
    g.addColorStop(0.5, '#2266ff');
    g.addColorStop(1, '#22cc66');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1600, 1200);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 90px sans-serif';
    ctx.fillText('A45', 120, 220);
    return c.toDataURL('image/jpeg', 0.92);
  });
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, Buffer.from(dataUrl.split(',')[1], 'base64'));
  return p;
}

/** Free 컨트롤 비잠금 단언: disabled 금지 + 자신/조상 [data-pro-lock] 금지 */
async function assertNotProLocked(page, selector, label) {
  const bad = await page.evaluate((sel) => {
    const els = Array.from(document.querySelectorAll(sel));
    if (els.length === 0) return null;
    for (const el of els) {
      if (el.closest('[data-pro-lock]')) return 'pro-lock';
      if ((el.matches('button, input, select, textarea') && el.disabled) || el.getAttribute('aria-disabled') === 'true') {
        return 'disabled';
      }
    }
    return 'ok';
  }, selector);
  if (bad !== 'ok') {
    throw new Error(
      `A45: Free 동결 하한 위반 — ${label}(${selector}) 이(가) ` +
        (bad === null ? '존재하지 않습니다' : bad === 'pro-lock' ? '[data-pro-lock] 잠금 아래에 있습니다' : 'disabled 상태입니다') +
        ' (2026-08-18 동결 빌드 기능은 라이선스 없이 전부 동작해야 함 — B rev.6 무료 후퇴 금지)'
    );
  }
}

/** filechooser 경유 파일 주입 (버튼 클릭 → 파일 선택기 — 버튼 단계 잠금도 함께 검출) */
async function chooseFileVia(page, clickLoc, filePath, label) {
  let chooser = null;
  try {
    [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), clickLoc.click({ timeout: 5000 })]);
  } catch (e) {
    throw new Error(`${label}: 클릭 후 파일 선택기(filechooser)가 열리지 않았습니다 (잠금/미구현 여부 확인): ` + e.message);
  }
  await chooser.setFiles(filePath);
}

/** [data-add-board] 클릭 → visible [data-board-tab] 수가 want 가 될 때까지 폴링 */
async function addBoardExpectTabs(page, want, label) {
  const btn = await requireHook(page, '[data-add-board]', label);
  await btn.click({ timeout: 5000 });
  await pollPage(
    page,
    (want) => document.querySelectorAll('[data-board-tab]').length === want,
    want,
    5000,
    `${label}: [data-add-board] 클릭 후 [data-board-tab] 이 ${want}개가 되지 않았습니다`
  );
}

/** 문서 배경색 (a36 관용구: body 부터 조상 방향 첫 불투명 background-color) */
async function docBg(page) {
  return page.evaluate(() => {
    const parse = (s) => {
      const m = /rgba?\(([^)]+)\)/.exec(s || '');
      if (!m) return null;
      const p = m[1].split(',').map((x) => parseFloat(x));
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    let el = document.body;
    while (el) {
      const s = getComputedStyle(el).backgroundColor;
      const c = parse(s);
      if (c && c.a >= 0.99) return s;
      el = el.parentElement;
    }
    return 'rgb(255, 255, 255)';
  });
}

function hexToRgbObj(hex) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** [data-license-import] 로 라이선스 파일 적용 (계약 4의 3가지 형태 순서대로 시도) */
async function importLicenseFile(page, filePath, label) {
  let imp = page.locator('[data-license-import]').first();
  if ((await imp.count()) === 0) {
    throw new Error(`${label}: 필수 훅 [data-license-import] 이(가) 페이지에 없습니다 — rev.6 계약 미구현 (fail-closed)`);
  }
  if (!(await imp.isVisible().catch(() => false))) {
    // 계약: 숨겨져 있으면 visible [data-pro-lock] 클릭으로 도달 가능해야 한다
    if ((await countVisibleStrict(page, '[data-pro-lock]')) > 0) {
      await page
        .locator('[data-pro-lock]:visible')
        .first()
        .click({ timeout: 5000 })
        .catch(() => {});
      await sleep(400);
    }
    if (!(await imp.isVisible().catch(() => false))) {
      throw new Error(
        `${label}: [data-license-import] 이 숨겨져 있고 [data-pro-lock] 클릭으로도 visible 이 되지 않습니다 — 계약 4 위반 (fail-closed)`
      );
    }
  }
  const shape = await imp.evaluate((el) => {
    if (el.tagName === 'INPUT' && el.type === 'file') return 'self-input';
    if (el.querySelector('input[type="file"]')) return 'child-input';
    return 'chooser';
  });
  if (shape === 'self-input') {
    await imp.setInputFiles(filePath);
  } else if (shape === 'child-input') {
    await imp.locator('input[type="file"]').first().setInputFiles(filePath);
  } else {
    await chooseFileVia(page, imp, filePath, label + ' 라이선스 가져오기');
  }
}

test.describe('A45 Free/Pro 경계', () => {
  /* ════ 1) Free 동결 하한 안티-테스트 ════ */
  test('A45: Free 동결 하한 — 라이선스 없이 사진 첨부·배경 업로드·사진 스티커·스티커 3세트·스킨 3종·보드 3개·꾸미기 전부 동작 (하나라도 잠기면 FAIL)', async () => {
    test.setTimeout(240 * 1000);
    requirePostit();
    requireElectronShell('A45');
    const userDir = freshUserDataDir('grader-a45-free-');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grader-a45-fx-'));
    let shell = null;
    try {
      shell = await launchElectronShell(userDir, { label: 'A45' });
      const page = await getAppWindow(shell, 'postit.html', 30000, 'A45');
      await dismissMigrateIfPresent(page, 'A45');
      await dismissOnboardingIfPresent(page, 'A45');

      // ── 보드 3개까지 무료 (A25 확장 재단언) ──
      await requireHook(page, '[data-board-switcher]', 'A45 보드 전환기');
      await assertNotProLocked(page, '[data-add-board]', '새 보드 버튼');
      await addBoardExpectTabs(page, 2, 'A45 보드 2');
      await addBoardExpectTabs(page, 3, 'A45 보드 3');

      // ── 노트 2개 생성 (1=사진 첨부, 2=스킨) ──
      await addNote(page);
      await pollVisibleNoteCount(page, 1, 5000, 'A45');
      await addNote(page);
      await pollVisibleNoteCount(page, 2, 5000, 'A45');
      const jpegPath = await makeJpegFixture(page, tmpDir, 'a45-photo.jpg');

      // ── 노트 사진 첨부 (A26 계약 재단언) ──
      await openContextMenuOn(page, page.locator(POSTIT_SEL.NOTE).first());
      await sleep(200);
      const photoItem = page.locator('[data-ctx-menu] [data-ctx-item]').filter({ hasText: /사진|이미지/ }).first();
      if ((await photoItem.count()) === 0) {
        throw new Error('A45: 노트 컨텍스트 메뉴에 "사진"/"이미지" [data-ctx-item] 이 없습니다 — 동결 빌드 기능(사진 첨부) 후퇴 (fail-closed)');
      }
      if ((await page.locator('input[type="file"][data-note-image-input]').count()) === 0) {
        throw new Error('A45: 필수 훅 input[type=file][data-note-image-input] 부재 — 동결 빌드 기능(사진 첨부) 후퇴 (fail-closed)');
      }
      await chooseFileVia(page, photoItem, jpegPath, 'A45 사진 첨부');
      await pollPage(
        page,
        (N) =>
          Array.from(document.querySelectorAll(N)).some((note) => {
            const img = note.querySelector('img');
            return !!img && (img.src || '').startsWith('data:image/') && img.naturalWidth > 0;
          }),
        POSTIT_SEL.NOTE,
        8000,
        'A45: 라이선스 없는 상태에서 노트 사진 첨부가 동작하지 않았습니다 (data:image img 미표시 — Free 동결 하한 위반)'
      );

      // ── 스킨 3종 (A27 계약 재단언) — 노트 2에 적용 ──
      const note2 = page.locator(POSTIT_SEL.NOTE).nth(1);
      const bgBefore = await note2.evaluate((el) => getComputedStyle(el).backgroundImage);
      await note2.click({ timeout: 5000 });
      await sleep(150);
      if (!(await page.locator('[data-skin]').first().isVisible().catch(() => false))) {
        await openContextMenuOn(page, note2);
        await sleep(250);
      }
      if (!(await page.locator('[data-skin]').first().isVisible().catch(() => false))) {
        throw new Error('A45: [data-skin] 스킨 선택 UI 에 도달할 수 없습니다 — 동결 빌드 기능(스킨) 후퇴 (fail-closed)');
      }
      const skinOptCount = await countVisibleStrict(page, '[data-skin-option]');
      expect(
        skinOptCount >= 3,
        `A45: visible [data-skin-option] 이 ${skinOptCount}개입니다 (동결 하한: 기본/줄노트/모눈 ≥3종)`
      ).toBe(true);
      await assertNotProLocked(page, '[data-skin-option]', '스킨 선택지');
      const lined = page.locator('[data-skin-option]').filter({ hasText: /줄노트/ }).first();
      if ((await lined.count()) === 0) {
        throw new Error('A45: "줄노트" 라벨의 [data-skin-option] 이 없습니다 (동결 빌드 3종: 기본/줄노트/모눈)');
      }
      await lined.click({ timeout: 5000 });
      await pollPage(
        page,
        ({ N, before }) => {
          const el = document.querySelectorAll(N)[1];
          return !!el && getComputedStyle(el).backgroundImage !== before;
        },
        { N: POSTIT_SEL.NOTE, before: bgBefore },
        5000,
        'A45: 줄노트 스킨 적용 후 노트 background-image 가 변하지 않았습니다 (Free 동결 하한 위반)'
      );
      await page.keyboard.press('Escape').catch(() => {});

      // ── 꾸미기 패널 열기 (동결 빌드 UI: #decorBtn) ──
      const decorBtn = page.locator('#decorBtn');
      if ((await decorBtn.count()) === 0) {
        throw new Error('A45: 꾸미기 버튼(#decorBtn)이 없습니다 — 동결 빌드 기능(꾸미기) 후퇴 (fail-closed)');
      }
      await decorBtn.click({ timeout: 5000 });
      await pollVisibleStrict(page, '#dpStSeason', true, 5000, 'A45: 꾸미기 패널이 열리지 않았습니다 (#dpStSeason 비가시)');

      // ── 스티커 3세트 — 각 ≥12종·비잠금·클릭 부착 ──
      for (const [host, name] of [['#dpStSeason', '계절'], ['#dpStMood', '기분'], ['#dpStOffice', '사무']]) {
        const n = await page.locator(host + ' button').count();
        expect(n >= 12, `A45: 스티커 세트 ${name}(${host}) 버튼이 ${n}개입니다 (동결 하한: 세트당 ≥12종)`).toBe(true);
        await assertNotProLocked(page, host + ' button', `스티커 세트 ${name}`);
        await page.locator(host + ' button').first().click({ timeout: 5000 });
      }
      await pollPage(
        page,
        () => document.querySelectorAll('[data-sticker]:not(.photo)').length >= 3,
        null,
        5000,
        'A45: 스티커 3세트에서 클릭한 이모지 스티커 3개가 보드([data-sticker])에 부착되지 않았습니다'
      );

      // ── 사진 스티커 ──
      await assertNotProLocked(page, '#dpPhotoAdd', '사진 스티커 추가');
      await chooseFileVia(page, page.locator('#dpPhotoAdd'), jpegPath, 'A45 사진 스티커');
      await pollPage(
        page,
        () => {
          const img = document.querySelector('[data-sticker].photo img');
          return !!img && (img.src || '').startsWith('data:image/');
        },
        null,
        10000,
        'A45: 사진 스티커가 부착되지 않았습니다 ([data-sticker].photo img data:image 미표시 — IndexedDB 경유 저장 포함)'
      );

      // ── 배경 프리셋 + 배경 업로드 ──
      await assertNotProLocked(page, '#dpBg button[data-bg]', '배경 프리셋');
      await page.locator('#dpBg button[data-bg="wood"]').click({ timeout: 5000 });
      await pollPage(
        page,
        () => !!document.querySelector('.decor-bg.on.bg-wood'),
        null,
        5000,
        'A45: 배경 프리셋(나무) 적용이 관찰되지 않았습니다 (.decor-bg.on.bg-wood 부재)'
      );
      await assertNotProLocked(page, '#dpBgUpload', '내 사진 배경 업로드');
      await chooseFileVia(page, page.locator('#dpBgUpload'), jpegPath, 'A45 배경 업로드');
      await pollPage(
        page,
        () => {
          const el = document.querySelector('.decor-bg.on');
          return !!el && (getComputedStyle(el).backgroundImage || '').includes('data:image');
        },
        null,
        10000,
        'A45: 배경 업로드가 동작하지 않았습니다 (.decor-bg.on 의 background-image 에 data:image 미반영)'
      );

      // ── 테이프/프레임 (꾸미기 전부) ──
      await assertNotProLocked(page, '#dpTapeColor [data-tval]', '테이프 색');
      await page.locator('#dpTapeColor [data-tval="sun"]').click({ timeout: 5000 });
      await pollPage(
        page,
        () => {
          const b = document.querySelector('#dpTapeColor [data-tval="sun"]');
          return !!b && b.classList.contains('sel');
        },
        null,
        3000,
        'A45: 테이프 색 선택(.sel)이 반영되지 않았습니다'
      );
      await assertNotProLocked(page, '#dpFrame [data-fval]', '프레임');
      await page.locator('#dpFrame [data-fval]').nth(1).click({ timeout: 5000 });
      await pollPage(
        page,
        () => {
          const bs = document.querySelectorAll('#dpFrame [data-fval]');
          return bs.length >= 2 && bs[1].classList.contains('sel');
        },
        null,
        3000,
        'A45: 프레임 선택(.sel)이 반영되지 않았습니다'
      );

      // ── 공통 규정 ──
      assertNoDialogs(shell.state, 'A45');
      expect(
        shell.state.pageErrors,
        `A45: pageerror ${shell.state.pageErrors.length}건 (0건이어야 함): ${shell.state.pageErrors.join(' | ')}`
      ).toHaveLength(0);
    } finally {
      await closeElectronShell(shell);
      await removeDirWithRetry(userDir);
      await removeDirWithRetry(tmpDir);
    }
  });

  /* ════ 2) Pro 신규성 — 매니페스트 검증 ════ */
  test('A45: Pro 신규성 — pro-manifest 검증 (신규 스티커 ≥2팩×≥8종·동결 45종과 중복 0, 신규 스킨 ≥2종·기존 테마와 색거리 ≥40)', async () => {
    test.setTimeout(120 * 1000);
    requirePostit();

    // ── 매니페스트 존재·형식 (fail-closed) ──
    if (!fs.existsSync(PRO_MANIFEST_PATH)) {
      throw new Error(
        'A45: Pro 신규성 매니페스트 assets/pro/pro-manifest.json 이 없습니다 — ' +
          '계약 3({stickerPacks:[{id,name,stickers[≥8]}×≥2], skins:[{id,name,baseColor}×≥2]}) 미구현 (fail-closed)'
      );
    }
    let manifest = null;
    try {
      manifest = JSON.parse(fs.readFileSync(PRO_MANIFEST_PATH, 'utf8'));
    } catch (e) {
      throw new Error('A45: assets/pro/pro-manifest.json 파싱 실패 (유효한 UTF-8 JSON 이어야 함): ' + e.message);
    }
    const packs = Array.isArray(manifest.stickerPacks) ? manifest.stickerPacks : [];
    const skins = Array.isArray(manifest.skins) ? manifest.skins : [];
    expect(packs.length >= 2, `A45: 신규 스티커 팩이 ${packs.length}개입니다 (≥2팩 계약)`).toBe(true);
    expect(skins.length >= 2, `A45: 신규 프리미엄 스킨이 ${skins.length}종입니다 (≥2종 계약)`).toBe(true);

    // ── 스티커: 팩당 ≥8종, 전 팩 중복 0, 동결 45종과 교집합 0, 경로형은 실존 ──
    const frozen = new Set(FROZEN_FREE_STICKERS);
    const seen = new Set();
    for (const pack of packs) {
      const pid = pack && pack.id ? String(pack.id) : '(id 없음)';
      const stickers = pack && Array.isArray(pack.stickers) ? pack.stickers : [];
      expect(
        typeof pack.id === 'string' && pack.id.length > 0 && typeof pack.name === 'string' && pack.name.length > 0,
        `A45: 팩 ${pid} 에 id/name 문자열이 없습니다 (매니페스트 계약)`
      ).toBe(true);
      expect(stickers.length >= 8, `A45: 팩 ${pid} 스티커가 ${stickers.length}종입니다 (팩당 ≥8종 계약)`).toBe(true);
      for (const s of stickers) {
        expect(typeof s === 'string' && s.length > 0, `A45: 팩 ${pid} 에 빈/비문자열 스티커 식별자가 있습니다`).toBe(true);
        expect(!seen.has(s), `A45: 스티커 식별자 "${s}" 가 팩 간/팩 내 중복입니다 (중복 0 계약)`).toBe(true);
        seen.add(s);
        expect(!frozen.has(s), `A45: 스티커 "${s}" 는 동결 무료 3세트(45종)와 중복입니다 — 기존 무료 에셋의 Pro 재포장 금지 (B rev.6)`).toBe(true);
        if (/[\\/]/.test(s) || /\.(png|jpe?g|webp|gif|svg)$/i.test(s)) {
          const abs = path.join(APP_ROOT, s.replace(/\//g, path.sep));
          expect(
            abs.startsWith(path.join(APP_ROOT, 'assets')) && fs.existsSync(abs),
            `A45: 경로형 스티커 "${s}" 가 assets/ 하위 실파일이 아닙니다 (로컬 번들 원칙·매니페스트 실존 계약)`
          ).toBe(true);
        }
      }
    }

    // ── 스킨: baseColor 형식 + 기존 테마 3종 실측과 거리 ≥40 + 신규끼리 ≥40 ──
    const newColors = [];
    for (const sk of skins) {
      const sid = sk && sk.id ? String(sk.id) : '(id 없음)';
      const c = hexToRgbObj(sk && sk.baseColor);
      expect(
        typeof sk.id === 'string' && sk.id.length > 0 && typeof sk.name === 'string' && sk.name.length > 0 && !!c,
        `A45: 스킨 ${sid} 에 id/name/baseColor(#RRGGBB) 가 없습니다 (매니페스트 계약)`
      ).toBe(true);
      newColors.push({ id: sid, c });
    }
    const ids = new Set(newColors.map((x) => x.id));
    expect(ids.size === newColors.length, 'A45: 스킨 id 가 중복입니다').toBe(true);

    // 기존 테마 3종 문서 배경 실측 (file:// — Electron 은 바이트 동일 HTML 을 로드하므로 동일 값)
    const existing = await withFreshApp(POSTIT_PATH, async ({ page }) => {
      const hook = page.locator('select[data-theme-preset]').first();
      if ((await hook.count()) === 0) {
        throw new Error('A45: [data-theme-preset] select 를 찾을 수 없습니다 (A36 계약 — 기존 테마 실측 불가)');
      }
      const optionCount = await hook.locator('option').count();
      const colors = [];
      for (let i = 0; i < optionCount; i++) {
        const value = await hook.locator('option').nth(i).getAttribute('value');
        await hook.selectOption(value);
        await sleep(250);
        const bg = parseRgb(await docBg(page));
        if (bg) colors.push({ label: value, c: bg });
      }
      return colors;
    });
    expect(existing.length >= 3, `A45: 기존 테마 실측이 ${existing.length}종입니다 (basic/dark/white 3종 필요)`).toBe(true);

    for (const nc of newColors) {
      for (const ex of existing) {
        const d = rgbDist(nc.c, ex.c);
        expect(
          d >= MIN_COLOR_DIST,
          `A45: 신규 스킨 ${nc.id}(${JSON.stringify(nc.c)})와 기존 테마 "${ex.label}" 의 색거리 ${d.toFixed(1)} < ${MIN_COLOR_DIST} — 기존 재포장 금지 (신규 가치 계약)`
        ).toBe(true);
      }
    }
    for (let i = 0; i < newColors.length; i++) {
      for (let j = i + 1; j < newColors.length; j++) {
        const d = rgbDist(newColors[i].c, newColors[j].c);
        expect(
          d >= MIN_COLOR_DIST,
          `A45: 신규 스킨 ${newColors[i].id}·${newColors[j].id} 간 색거리 ${d.toFixed(1)} < ${MIN_COLOR_DIST} — 자기 복제로 ≥2종 계수 금지 (D 굿하트)`
        ).toBe(true);
      }
    }
  });

  /* ════ 3) 서명 라이선스 — 잠금 관찰 → 적용 즉시 해제 → 재기동 유지 → 변조 거부 ════ */
  test('A45: 라이선스 서명 파일 — [data-pro-lock] 잠금 관찰 → [data-license-import] 적용 즉시 해제·재기동 유지, 바이트 변조본 거부', async () => {
    test.setTimeout(300 * 1000);
    requirePostit();
    requireElectronShell('A45');
    if (!fs.existsSync(LICENSE_FIXTURE_PATH)) {
      throw new Error(
        'A45: 커밋된 테스트 라이선스 픽스처 electron/test-license/petit-test.license 가 없습니다 — ' +
          '계약 4(서명 파일 방식: 앱엔 공개키만, WebCrypto 오프라인 검증, 픽스처는 정식 서명본 커밋) 미구현 (fail-closed)'
      );
    }
    const licBuf = fs.readFileSync(LICENSE_FIXTURE_PATH);
    expect(
      licBuf.length > 0 && licBuf.length <= 64 * 1024,
      `A45: 라이선스 픽스처 크기 ${licBuf.length}바이트 (1바이트~64KB 계약)`
    ).toBe(true);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grader-a45-lic-'));
    const tampered = Buffer.from(licBuf);
    tampered[Math.floor(tampered.length / 2)] ^= 0xff; // 중앙 1바이트 반전
    const tamperedPath = path.join(tmpDir, 'petit-test.tampered.license');
    fs.writeFileSync(tamperedPath, tampered);

    const dirA = freshUserDataDir('grader-a45-licA-');
    const dirB = freshUserDataDir('grader-a45-licB-');
    let shell = null;
    try {
      /* ── 잠금 관찰 (라이선스 없음) ── */
      shell = await launchElectronShell(dirA, { label: 'A45' });
      let page = await getAppWindow(shell, 'postit.html', 30000, 'A45');
      await dismissMigrateIfPresent(page, 'A45');
      await dismissOnboardingIfPresent(page, 'A45');
      await addBoardExpectTabs(page, 2, 'A45 보드 2');
      await addBoardExpectTabs(page, 3, 'A45 보드 3');

      // 기능 잠금 실증(계약 2 — 감사 수정 2026-08-19): 4번째 보드 시도는 잠금 UI 노출 여부와
      // 무관하게 "항상" 수행한다. 이전 판은 꾸미기 패널에 [data-pro-lock] 이 보이면 시도를
      // 생략해, 장식적 잠금 표시만 있고 실제로는 4번째 보드가 열리는 배반을 놓칠 수 있었다.
      // (버튼이 disabled 인 구현도 정당한 잠금이므로 클릭 실패는 삼키고, 판정은 탭 수로 한다.)
      await page.locator('[data-add-board]').first().click({ timeout: 5000 }).catch(() => {});
      await sleep(800);
      let tabs = await page.locator('[data-board-tab]').count();
      expect(tabs, `A45: 라이선스 없이 4번째 보드가 생성되었습니다 (탭 ${tabs}개) — Pro 경계(보드 4개째부터) 미작동`).toBe(3);
      // 잠금 UI 관찰: 4번째 시도 직후 또는 꾸미기 패널에서 visible [data-pro-lock] (계약 2 도달 경로)
      if ((await countVisibleStrict(page, '[data-pro-lock]')) === 0) {
        await page.locator('#decorBtn').click({ timeout: 5000 }).catch(() => {});
        await sleep(500);
      }
      const lockCount = await countVisibleStrict(page, '[data-pro-lock]');
      if (lockCount === 0) {
        throw new Error(
          'A45: 라이선스 없는 상태에서 잠금 UI([data-pro-lock])가 4번째 보드 시도에서도, 꾸미기 패널에서도 관찰되지 않습니다 — ' +
            'Pro 경계 미구현 (fail-closed)'
        );
      }

      /* ── 정식 라이선스 적용 → 즉시 해제 ── */
      await importLicenseFile(page, LICENSE_FIXTURE_PATH, 'A45');
      await pollPage(
        page,
        () => {
          const effOpacity = (el) => {
            let o = 1;
            for (let c = el; c && c.nodeType === 1; c = c.parentElement) o *= parseFloat(getComputedStyle(c).opacity) || 0;
            return o;
          };
          return (
            Array.from(document.querySelectorAll('[data-pro-lock]')).filter((el) => {
              const r = el.getBoundingClientRect();
              const s = getComputedStyle(el);
              return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && effOpacity(el) > 0.05;
            }).length === 0
          );
        },
        null,
        5000,
        'A45: 정식 서명 라이선스 적용 후 5초 내 visible [data-pro-lock] 이 0개가 되지 않았습니다 (즉시 해제 계약)'
      );
      await addBoardExpectTabs(page, 4, 'A45 해제 후 보드 4');
      assertNoDialogs(shell.state, 'A45');
      await closeElectronShell(shell);
      shell = null;

      /* ── 재기동 유지 ── */
      shell = await launchElectronShell(dirA, { label: 'A45' });
      page = await getAppWindow(shell, 'postit.html', 30000, 'A45');
      await dismissMigrateIfPresent(page, 'A45');
      await pollPage(
        page,
        () => document.querySelectorAll('[data-board-tab]').length === 4,
        null,
        7000,
        'A45: 재기동 후 보드 4개 구성이 유지되지 않았습니다 (라이선스 재기동 유지 실패)'
      );
      await page.locator('#decorBtn').click({ timeout: 5000 }).catch(() => {});
      await sleep(800);
      const lockAfterRestart = await countVisibleStrict(page, '[data-pro-lock]');
      expect(
        lockAfterRestart,
        `A45: 재기동 후 visible [data-pro-lock] ${lockAfterRestart}개 — 라이선스 해제 상태가 유지되어야 합니다`
      ).toBe(0);
      assertNoDialogs(shell.state, 'A45');
      await closeElectronShell(shell);
      shell = null;

      /* ── 변조 라이선스 거부 (fresh 프로필 B) ── */
      shell = await launchElectronShell(dirB, { label: 'A45' });
      page = await getAppWindow(shell, 'postit.html', 30000, 'A45');
      await dismissMigrateIfPresent(page, 'A45');
      await dismissOnboardingIfPresent(page, 'A45');
      await addBoardExpectTabs(page, 2, 'A45 변조 보드 2');
      await addBoardExpectTabs(page, 3, 'A45 변조 보드 3');
      await page.locator('#decorBtn').click({ timeout: 5000 }).catch(() => {});
      await sleep(500);
      if ((await countVisibleStrict(page, '[data-pro-lock]')) === 0) {
        await page.locator('[data-add-board]').first().click({ timeout: 5000 });
        await sleep(800);
      }
      await importLicenseFile(page, tamperedPath, 'A45 변조');
      await sleep(3000);
      const lockAfterTamper = await countVisibleStrict(page, '[data-pro-lock]');
      expect(
        lockAfterTamper > 0,
        'A45: 바이트 변조 라이선스가 수리되었습니다 (visible [data-pro-lock] 0개) — 서명 검증(WebCrypto) 미작동'
      ).toBe(true);
      // disabled 구현 허용 — 판정은 아래 탭 수 (감사 수정: 클릭 실패 삼킴은 기능 판정을 약화하지 않음)
      await page.locator('[data-add-board]').first().click({ timeout: 5000 }).catch(() => {});
      await sleep(800);
      tabs = await page.locator('[data-board-tab]').count();
      expect(tabs, `A45: 변조 라이선스 후 4번째 보드가 생성되었습니다 (탭 ${tabs}개) — 거부 실패`).toBe(3);
      expect(
        shell.state.pageErrors,
        `A45: 변조 라이선스 처리 중 pageerror ${shell.state.pageErrors.length}건 (크래시 없이 거부해야 함): ${shell.state.pageErrors.join(' | ')}`
      ).toHaveLength(0);
      assertNoDialogs(shell.state, 'A45');
    } finally {
      await closeElectronShell(shell);
      await removeDirWithRetry(dirA);
      await removeDirWithRetry(dirB);
      await removeDirWithRetry(tmpDir);
    }
  });
});
