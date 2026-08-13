'use strict';
/**
 * A37 — 볼륨 슬라이더 (rev.5 설계서 §1 A37 / §2 A37, 두 앱)
 * "두 앱 각각 [data-volume] range(0~100)를 30으로 조작 → 2초 내 `postit-sound-vol`/`cal-sound-vol`
 *  = \"30\" 저장, 마스터 게인 노출값(body[data-volume-gain] 또는 window.__getMasterGain())이
 *  0.30±0.01 → 재기동 후 슬라이더 값 30·게인 0.30, 0으로 내리면 게인 0"
 *
 * ── rev.5 필수 DOM 계약 (설계서 §2 A37 — 그대로 기록) ──
 * [data-volume] — 두 앱 각 1개, input[type=range] min="0" max="100" (속성 단언).
 * 게인 노출: body[data-volume-gain](마스터 게인 소수 문자열 상시 반영) 권장,
 * window.__getMasterGain() 읽기 전용 게터 허용 — 둘 중 하나가 0.30±0.01, 두 경로 모두 없으면 FAIL.
 * 저장 키: postit-sound-vol / cal-sound-vol (문자열 정수 0~100). 실제 재생은 사용자 제스처 시에만 —
 * 판정은 값 경로만. 신규 훅은 폴백 셀렉터 없음 (fail-closed).
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
  assertNoDialogs,
  requireHook,
} = require('../lib/helpers');

/** 게인 노출값 판독: body[data-volume-gain] → window.__getMasterGain() 순 (둘 다 없으면 null) */
const READ_GAIN_FN = () => {
  const attr = document.body ? document.body.getAttribute('data-volume-gain') : null;
  if (attr !== null && attr !== '' && isFinite(parseFloat(attr))) return { source: 'attr', value: parseFloat(attr) };
  if (typeof window.__getMasterGain === 'function') {
    try {
      const v = Number(window.__getMasterGain());
      if (isFinite(v)) return { source: 'fn', value: v };
    } catch (e) {
      /* 아래 null */
    }
  }
  return null;
};

async function pollGain(page, want, tol, label, why) {
  await pollPage(
    page,
    ({ fnSrc, want, tol }) => {
      const g = new Function('return (' + fnSrc + ')()')();
      return !!g && Math.abs(g.value - want) <= tol;
    },
    { fnSrc: READ_GAIN_FN.toString(), want, tol },
    3000,
    `${label}: ${why} — 마스터 게인 노출값(body[data-volume-gain] 또는 window.__getMasterGain())이 ` +
      `${want.toFixed(2)}±${tol} 이 아니거나 두 노출 경로 모두 없습니다 (fail-closed)`
  );
}

/** range 를 값 v 로 조작: fill 시도 후 input/change 이벤트 디스패치(설계서 §2 A37 허용 경로) */
async function setRange(page, loc, v) {
  try {
    await loc.fill(String(v), { timeout: 2000 });
  } catch (e) {
    /* range fill 미지원 환경 — 아래 디스패치가 실제 조작을 수행 */
  }
  await loc.evaluate((el, val) => {
    el.value = String(val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, v);
}

async function runVolumeTest(htmlPath, volKey, label) {
  const dir = freshProfileDir();
  const states = [];
  let app = null;
  try {
    app = await launchApp(dir, htmlPath);
    states.push(app.state);
    let page = app.page;

    let vol = await requireHook(page, '[data-volume]', label);
    const attrs = await vol.evaluate((el) => ({
      type: el.getAttribute('type'),
      min: el.getAttribute('min'),
      max: el.getAttribute('max'),
    }));
    expect(
      attrs.type === 'range',
      `${label}: [data-volume] 이 input[type=range] 가 아닙니다 (type="${attrs.type}")`
    ).toBe(true);
    expect(
      attrs.min === '0' && attrs.max === '100',
      `${label}: [data-volume] 의 min/max 속성이 0/100 이 아닙니다 (min="${attrs.min}", max="${attrs.max}")`
    ).toBe(true);

    // ── 30 으로 조작 → 2초 내 저장 + 게인 0.30±0.01 ──
    await setRange(page, vol, 30);
    await pollLocalStorage(page, volKey, (raw) => raw === '30', 2000);
    await pollGain(page, 0.3, 0.01, label, '슬라이더 30 조작 직후');
    assertNoDialogs(app.state, label);
    await closeApp(app);
    app = null;

    // ── 재기동: 슬라이더 값 30 + 게인 0.30±0.01 ──
    app = await launchApp(dir, htmlPath);
    states.push(app.state);
    page = app.page;
    vol = await requireHook(page, '[data-volume]', label);
    await sleep(150);
    const inputVal = await vol.inputValue();
    expect(
      inputVal,
      `${label}: 재기동 후 [data-volume] 슬라이더 값이 "30" 으로 복원되지 않았습니다 (실제 "${inputVal}") — ${volKey} 저장·복원 필요`
    ).toBe('30');
    await pollGain(page, 0.3, 0.01, label, '재기동 직후');

    // ── 0 으로 내리면 게인 0 ──
    await setRange(page, vol, 0);
    await pollGain(page, 0, 0.01, label, '슬라이더 0 조작 직후');

    for (const s of states) assertNoDialogs(s, label);
  } finally {
    await closeApp(app);
    await removeDirWithRetry(dir);
  }
}

test.describe('A37 볼륨 슬라이더', () => {
  test('A37: 포스트잇 — 30 저장·게인 0.30 → 재기동 유지 → 0 에서 게인 0', async () => {
    requirePostit();
    await runVolumeTest(POSTIT_PATH, 'postit-sound-vol', 'A37 포스트잇');
  });

  test('A37: 캘린더 — 30 저장·게인 0.30 → 재기동 유지 → 0 에서 게인 0', async () => {
    await runVolumeTest(CALENDAR_PATH, 'cal-sound-vol', 'A37 캘린더');
  });
});
