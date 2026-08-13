'use strict';
/**
 * A23 — 노트 리사이즈 (rev.5 설계서 §1 A23)
 * "노트 활성 후 [data-resize-handle] 을 (+100,+100) 드래그하면 offsetWidth/Height 각 ≥40px 증가,
 *  (−999,−999) 드래그에도 120×120 미만으로 줄지 않고 (+999,+999) 에도 480×480 을 넘지 않으며,
 *  리사이즈 중 노트 좌상단은 ±2px 불변, 재기동 후 크기 ±2px 보존, 이후 A4식 자유 드래그가
 *  그대로 성립한다"
 *
 * ── rev.5 필수 DOM 계약 (설계서 §2 A23 — 그대로 기록) ──
 * [data-resize-handle] — 각 노트 내부 우하단, 히트 영역 ≥ 12×12px, 노트 활성(클릭) 시 클릭
 * 가능해야 함. 핸들에서 시작한 드래그는 이동이 아니라 리사이즈(=[data-drag-handle] 규약과
 * 상호 배타). 크기는 노트별 저장(postit-notes 항목의 w/h 필드 등 — 키 스키마는 자유,
 * 판정은 렌더 크기).
 * 신규 훅은 폴백 셀렉터 없음: data-속성 부재 = 즉시 FAIL (fail-closed).
 * 굿하트 차단(설계서 §6): 리사이즈가 이동으로 새거나 최소·최대 무시 →
 * 좌상단 ±2px 불변 + 120/480 클램프 단언.
 */
const { test, expect } = require('@playwright/test');
const {
  POSTIT_PATH,
  requirePostit,
  freshProfileDir,
  launchApp,
  closeApp,
  removeDirWithRetry,
  sleep,
  POSTIT_SEL,
  assertNoDialogs,
  addNote,
  pollVisibleNoteCount,
  noteTopLeft,
  dragNoteTo,
} = require('../lib/helpers');

const STORE_KEY = 'postit-notes';

async function noteSize(page, idx) {
  const s = await page.evaluate(
    ({ N, idx }) => {
      const el = document.querySelectorAll(N)[idx];
      return el ? { w: el.offsetWidth, h: el.offsetHeight } : null;
    },
    { N: POSTIT_SEL.NOTE, idx }
  );
  if (!s) throw new Error(`A23: 노트 ${idx + 1}번을 찾을 수 없습니다`);
  return s;
}

/** [data-resize-handle] 중심에서 (dx,dy) 드래그 (뷰포트 경계로 클램프, steps 12 ≥ 10) */
async function dragResize(page, noteLoc, dx, dy, label) {
  const handle = noteLoc.locator('[data-resize-handle]').first();
  if ((await handle.count()) === 0) {
    throw new Error(
      `${label}: 필수 훅 [data-resize-handle] 이(가) 노트 내부에 없습니다 — rev.5 DOM 계약 미구현 (fail-closed: 폴백 없음)`
    );
  }
  const bb = await handle.boundingBox();
  if (!bb) {
    throw new Error(`${label}: [data-resize-handle] 이 보이지 않습니다 — 노트 활성(클릭) 시 클릭 가능해야 합니다`);
  }
  const vp = page.viewportSize() || { width: 1280, height: 800 };
  const sx = bb.x + bb.width / 2;
  const sy = bb.y + bb.height / 2;
  const tx = Math.min(Math.max(sx + dx, 1), vp.width - 2);
  const ty = Math.min(Math.max(sy + dy, 1), vp.height - 2);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(tx, ty, { steps: 12 });
  await page.mouse.up();
  await sleep(150);
  return bb;
}

test.describe('A23 노트 리사이즈', () => {
  test('A23: 핸들 드래그 +100/+100 확대, 120 최소·480 최대 클램프, 좌상단 불변, 재기동 크기 보존, A4식 드래그 성립', async () => {
    requirePostit();
    const dir = freshProfileDir();
    const states = [];
    let app = null;
    try {
      app = await launchApp(dir, POSTIT_PATH);
      states.push(app.state);
      let page = app.page;
      await addNote(page);
      await pollVisibleNoteCount(page, 1, 5000, 'A23');
      const noteLoc = page.locator(POSTIT_SEL.NOTE).first();
      try {
        await noteLoc.click({ timeout: 5000 }); // 활성
      } catch (e) {
        throw new Error('A23: 노트를 클릭(활성)할 수 없습니다: ' + e.message);
      }
      await sleep(150);

      // 핸들 히트 영역 ≥ 12×12px 단언 (첫 접근 시 fail-closed 포함)
      const size0 = await noteSize(page, 0);
      const p0 = await noteTopLeft(page, 0);
      const hb = await dragResize(page, noteLoc, 100, 100, 'A23 (+100,+100)');
      expect(
        hb.width >= 12 && hb.height >= 12,
        `A23: [data-resize-handle] 히트 영역이 ${hb.width.toFixed(0)}×${hb.height.toFixed(0)}px 입니다 (12×12px 이상이어야 함)`
      ).toBe(true);

      // (+100,+100): 각 ≥ 40px 증가 + 좌상단 ±2px 불변
      const size1 = await noteSize(page, 0);
      const p1 = await noteTopLeft(page, 0);
      expect(
        size1.w >= size0.w + 40 && size1.h >= size0.h + 40,
        `A23: (+100,+100) 드래그 후 크기가 ${size0.w}×${size0.h} → ${size1.w}×${size1.h} 입니다 (폭·높이 각 40px 이상 증가해야 함 — 핸들 드래그가 리사이즈로 동작하지 않음)`
      ).toBe(true);
      expect(
        Math.abs(p1.x - p0.x) <= 2 && Math.abs(p1.y - p0.y) <= 2,
        `A23: 리사이즈 중 노트 좌상단이 (${p0.x.toFixed(1)},${p0.y.toFixed(1)}) → (${p1.x.toFixed(1)},${p1.y.toFixed(1)}) 로 움직였습니다 (±2px 불변이어야 함 — 리사이즈가 이동으로 새는 구현 금지)`
      ).toBe(true);

      // (−999,−999): 120×120 미만으로 줄지 않음 + 좌상단 불변
      await dragResize(page, noteLoc, -999, -999, 'A23 (−999,−999)');
      const size2 = await noteSize(page, 0);
      const p2 = await noteTopLeft(page, 0);
      expect(
        size2.w >= 120 && size2.h >= 120,
        `A23: (−999,−999) 드래그 후 크기가 ${size2.w}×${size2.h} 입니다 (최소 120×120 클램프 위반)`
      ).toBe(true);
      expect(
        Math.abs(p2.x - p1.x) <= 2 && Math.abs(p2.y - p1.y) <= 2,
        `A23: 축소 리사이즈 중 좌상단이 (${p1.x.toFixed(1)},${p1.y.toFixed(1)}) → (${p2.x.toFixed(1)},${p2.y.toFixed(1)}) 로 움직였습니다 (±2px 불변)`
      ).toBe(true);

      // (+999,+999): 480×480 을 넘지 않음 + 좌상단 불변
      await dragResize(page, noteLoc, 999, 999, 'A23 (+999,+999)');
      const size3 = await noteSize(page, 0);
      const p3 = await noteTopLeft(page, 0);
      expect(
        size3.w <= 480 && size3.h <= 480,
        `A23: (+999,+999) 드래그 후 크기가 ${size3.w}×${size3.h} 입니다 (최대 480×480 클램프 위반)`
      ).toBe(true);
      expect(
        Math.abs(p3.x - p2.x) <= 2 && Math.abs(p3.y - p2.y) <= 2,
        `A23: 확대 리사이즈 중 좌상단이 움직였습니다 (±2px 불변)`
      ).toBe(true);

      // 중간 크기로 조정 → 저장 폴링 → 재기동 후 ±2px 보존
      const rawBefore = await page.evaluate((k) => localStorage.getItem(k), STORE_KEY);
      await dragResize(page, noteLoc, -120, -90, 'A23 (−120,−90)');
      const size4 = await noteSize(page, 0);
      const deadline = Date.now() + 2500;
      for (;;) {
        const raw = await page.evaluate((k) => localStorage.getItem(k), STORE_KEY);
        if (raw !== null && raw !== rawBefore) break;
        if (Date.now() > deadline) {
          throw new Error('A23: 리사이즈 후 2초 내 노트 크기가 localStorage(postit-notes)에 저장되지 않았습니다');
        }
        await sleep(100);
      }
      assertNoDialogs(app.state, 'A23');
      await closeApp(app);
      app = null;

      // ── 재기동: 크기 ±2px 보존 + A4식 자유 드래그 성립 ──
      app = await launchApp(dir, POSTIT_PATH);
      states.push(app.state);
      page = app.page;
      await pollVisibleNoteCount(page, 1, 5000, 'A23 재기동');
      const size5 = await noteSize(page, 0);
      expect(
        Math.abs(size5.w - size4.w) <= 2 && Math.abs(size5.h - size4.h) <= 2,
        `A23: 재기동 후 노트 크기가 ${size4.w}×${size4.h} → ${size5.w}×${size5.h} 입니다 (±2px 보존이어야 함)`
      ).toBe(true);

      // A4식 자유 드래그: 본체 드래그 1회 ±2px 착지 (리사이즈 도입이 드래그를 깨지 않음)
      const target = { x: 300, y: 180 };
      const r = await dragNoteTo(page, 0, target);
      expect(
        Math.abs(r.after.x - target.x) <= 2 && Math.abs(r.after.y - target.y) <= 2,
        `A23: 리사이즈 도입 후 A4식 드래그가 깨졌습니다 — 최종 top-left (${r.after.x.toFixed(1)},${r.after.y.toFixed(1)}) 가 목표 (${target.x},${target.y}) ±2px 를 벗어났습니다`
      ).toBe(true);
      for (const s of states) assertNoDialogs(s, 'A23');
    } finally {
      await closeApp(app);
      await removeDirWithRetry(dir);
    }
  });
});
