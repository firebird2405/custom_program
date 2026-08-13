'use strict';
/**
 * A36 — 테마 프리셋 (rev.5 설계서 §1 A36 / §2 A36, 두 앱)
 * "두 앱 각각 [data-theme-preset] ≥3(코르크+파스텔 기본/다크+비비드/미니멀 화이트) —
 *  프리셋 간 문서 배경 computed color 쌍별 RGB 거리 ≥ 40, 다크는 상대 휘도 < 0.35·화이트는 > 0.85,
 *  선택이 앱별 키로 저장되어 재기동 후 유지, 기본 프리셋에서 보드 background-image 는 여전히
 *  assets/ 질감을 가리킨다(A10·A17 불변)"
 *
 * ── rev.5 필수 DOM 계약 (설계서 §2 A36 — 그대로 기록) ──
 * [data-theme-preset] — 선택 UI(select 또는 [data-theme-option] 버튼군), 라벨 "기본"/"다크"/"화이트"
 * 포함 매칭. 저장 키: postit-theme / cal-theme. 판정은 색 기준(문서 배경 = body 부터 조상 방향
 * 첫 불투명 background-color, WCAG 상대 휘도 공식). 신규 훅은 폴백 셀렉터 없음 (fail-closed).
 *
 * 주의: "기본 프리셋에서 보드 background-image 가 assets/ 질감" 회귀 단언은 A17 계약(포스트잇
 * 보드 질감)의 불변 확인이므로 포스트잇에만 적용한다 — 캘린더는 v1부터 질감 계약이 없으며
 * (A17 은 포스트잇 전용 항목), 기본 프리셋 복귀 시 원래 배경색 재현(±3/채널)으로 대신 판정한다.
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
  sleep,
  POSTIT_SEL,
  assertNoDialogs,
  requireHook,
  parseRgb,
  rgbDist,
} = require('../lib/helpers');

const LABELS = ['기본', '다크', '화이트'];

/** 문서 배경색: body 부터 조상 방향 첫 불투명 background-color (설계서 §2 A36) */
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

/** WCAG 상대 휘도 */
function relLuminance(c) {
  const lin = (v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** [data-theme-preset] 선택지 라벨 목록 (select option 또는 [data-theme-option] 버튼군).
 *  html/body 의 [data-theme-preset] 은 "현재 프리셋 반영" 속성일 수 있으므로 선택 UI 후보에서 제외. */
async function presetOptions(page) {
  return page.evaluate(() => {
    const hooks = Array.from(document.querySelectorAll('[data-theme-preset]')).filter(
      (el) => el !== document.documentElement && el !== document.body
    );
    const hook = hooks.find((el) => el.tagName === 'SELECT') || hooks[0] || null;
    if (hook && hook.tagName === 'SELECT') {
      return Array.from(hook.options).map((o) => (o.textContent || '').trim());
    }
    const btns = Array.from(document.querySelectorAll('[data-theme-option]')).filter((el) => el.tagName !== 'OPTION');
    if (btns.length) return btns.map((el) => (el.textContent || '').trim());
    return null;
  });
}

/** 라벨 포함 매칭으로 프리셋 선택 (select.selectOption 또는 버튼 클릭) */
async function selectPreset(page, label, itemLabel) {
  const info = await page.evaluate((lb) => {
    const hooks = Array.from(document.querySelectorAll('[data-theme-preset]')).filter(
      (el) => el !== document.documentElement && el !== document.body
    );
    const hook = hooks.find((el) => el.tagName === 'SELECT') || hooks[0] || null;
    if (!hook) return { kind: 'none' };
    if (hook.tagName === 'SELECT') {
      const opt = Array.from(hook.options).find((o) => (o.textContent || '').includes(lb));
      return { kind: 'select', value: opt ? opt.value : null };
    }
    return { kind: 'buttons' };
  }, label);
  if (info.kind === 'none') {
    throw new Error(
      `${itemLabel}: 필수 훅 [data-theme-preset] 선택 UI 가 페이지에 없습니다 — rev.5 DOM 계약 미구현 (fail-closed)`
    );
  }
  if (info.kind === 'select') {
    if (info.value === null) {
      throw new Error(`${itemLabel}: [data-theme-preset] 선택지에 라벨 "${label}" 포함 옵션이 없습니다`);
    }
    await page.locator('select[data-theme-preset]').first().selectOption(info.value);
  } else {
    const btn = page.locator('[data-theme-option]', { hasText: label }).first();
    if ((await btn.count()) === 0) {
      throw new Error(`${itemLabel}: [data-theme-option] 중 라벨 "${label}" 포함 버튼이 없습니다`);
    }
    await btn.click({ timeout: 3000 });
  }
  await sleep(150);
}

/**
 * 앱 하나에 대한 A36 전체 판정.
 * @param htmlPath 앱 경로  @param themeKey 저장 키  @param label 메시지 접두
 * @param checkAssets 기본 프리셋 보드 assets/ 질감 회귀 단언 여부 (포스트잇만)
 */
async function runThemeTest(htmlPath, themeKey, label, checkAssets) {
  const dir = freshProfileDir();
  const states = [];
  let app = null;
  try {
    app = await launchApp(dir, htmlPath);
    states.push(app.state);
    let page = app.page;

    await requireHook(page, '[data-theme-preset]', label);
    const opts = await presetOptions(page);
    expect(
      Array.isArray(opts) && opts.length >= 3,
      `${label}: [data-theme-preset] 선택지가 ${opts ? opts.length : 0}개입니다 (최소 3개 필요)`
    ).toBe(true);
    for (const lb of LABELS) {
      expect(
        opts.some((t) => t.includes(lb)),
        `${label}: [data-theme-preset] 선택지에 라벨 "${lb}" 포함 항목이 없습니다 (현재: ${opts.join(', ')})`
      ).toBe(true);
    }

    // ── 각 프리셋의 문서 배경색 채집 ──
    const bg = {};
    for (const lb of LABELS) {
      await selectPreset(page, lb, label);
      const s = await docBg(page);
      const c = parseRgb(s);
      expect(c, `${label}: "${lb}" 프리셋의 문서 배경색을 파싱할 수 없습니다 (${s})`).toBeTruthy();
      bg[lb] = c;
    }

    // ── 쌍별 RGB 거리 ≥ 40 ──
    for (let i = 0; i < LABELS.length; i++) {
      for (let j = i + 1; j < LABELS.length; j++) {
        const d = rgbDist(bg[LABELS[i]], bg[LABELS[j]]);
        expect(
          d >= 40,
          `${label}: "${LABELS[i]}"·"${LABELS[j]}" 프리셋의 문서 배경색 RGB 거리가 ${d.toFixed(1)} 입니다 (≥ 40 필요)`
        ).toBe(true);
      }
    }

    // ── 다크 휘도 < 0.35, 화이트 > 0.85 ──
    const lumDark = relLuminance(bg['다크']);
    const lumWhite = relLuminance(bg['화이트']);
    expect(
      lumDark < 0.35,
      `${label}: 다크 프리셋 문서 배경 상대 휘도가 ${lumDark.toFixed(3)} 입니다 (< 0.35 필요)`
    ).toBe(true);
    expect(
      lumWhite > 0.85,
      `${label}: 화이트 프리셋 문서 배경 상대 휘도가 ${lumWhite.toFixed(3)} 입니다 (> 0.85 필요)`
    ).toBe(true);

    // ── 다크 선택 → 앱별 키 저장 → 재기동 후 유지(배경 ±3/채널) ──
    await selectPreset(page, '다크', label);
    await pollLocalStorage(
      page,
      themeKey,
      (raw) => raw !== null && /dark/i.test(raw),
      2000
    );
    assertNoDialogs(app.state, label);
    await closeApp(app);
    app = null;

    app = await launchApp(dir, htmlPath);
    states.push(app.state);
    page = app.page;
    await sleep(200);
    const cAfter = parseRgb(await docBg(page));
    expect(cAfter, `${label}: 재기동 후 문서 배경색을 파싱할 수 없습니다`).toBeTruthy();
    const dark = bg['다크'];
    expect(
      Math.abs(cAfter.r - dark.r) <= 3 && Math.abs(cAfter.g - dark.g) <= 3 && Math.abs(cAfter.b - dark.b) <= 3,
      `${label}: 다크 프리셋 상태로 재기동했지만 문서 배경색이 재현되지 않았습니다 ` +
        `(기대 rgb(${dark.r},${dark.g},${dark.b}) ±3, 실제 rgb(${cAfter.r},${cAfter.g},${cAfter.b})) — 프리셋이 ${themeKey} 로 저장·복원되어야 합니다`
    ).toBe(true);

    // ── 기본 프리셋 복귀 ──
    await requireHook(page, '[data-theme-preset]', label);
    await selectPreset(page, '기본', label);
    const cBasic = parseRgb(await docBg(page));
    const basic = bg['기본'];
    expect(
      Math.abs(cBasic.r - basic.r) <= 3 && Math.abs(cBasic.g - basic.g) <= 3 && Math.abs(cBasic.b - basic.b) <= 3,
      `${label}: 기본 프리셋 복귀 후 문서 배경색이 원래 값으로 돌아오지 않았습니다 ` +
        `(기대 rgb(${basic.r},${basic.g},${basic.b}) ±3, 실제 rgb(${cBasic.r},${cBasic.g},${cBasic.b}))`
    ).toBe(true);

    if (checkAssets) {
      const boardBg = await page.evaluate(
        (B) => {
          const b = document.querySelector(B);
          return b ? getComputedStyle(b).backgroundImage : null;
        },
        POSTIT_SEL.BOARD
      );
      expect(boardBg, `${label}: 보드 요소([data-board])를 찾을 수 없습니다`).not.toBeNull();
      expect(
        /assets\//i.test(boardBg),
        `${label}: 기본 프리셋에서 보드의 computed background-image 가 assets/ 질감을 가리키지 않습니다 ` +
          `(A10·A17 회귀 — 현재: ${String(boardBg).slice(0, 200)})`
      ).toBe(true);
    }

    for (const s of states) assertNoDialogs(s, label);
  } finally {
    await closeApp(app);
    await removeDirWithRetry(dir);
  }
}

test.describe('A36 테마 프리셋', () => {
  test('A36: 포스트잇 — 프리셋 3종 색 분리·휘도·재기동 유지 + 기본 프리셋 assets 질감 불변', async () => {
    requirePostit();
    await runThemeTest(POSTIT_PATH, 'postit-theme', 'A36 포스트잇', true);
  });

  test('A36: 캘린더 — 프리셋 3종 색 분리·휘도·재기동 유지 + 기본 프리셋 배경 복귀', async () => {
    await runThemeTest(CALENDAR_PATH, 'cal-theme', 'A36 캘린더', false);
  });
});
