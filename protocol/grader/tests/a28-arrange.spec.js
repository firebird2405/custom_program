'use strict';
/**
 * A28 — 한 번에 정리 (rev.5 설계서 §1 A28)
 * "노트 6개를 겹치게 배치 후 [data-arrange] 클릭 → 5초 내 위치가 안정화(300ms 간격 2회 샘플
 *  동일)되고 모든 노트 쌍의 경계상자 겹침 면적 0 + 전 노트 보드 내부, 정리 결과가 재기동 후
 *  보존되며, 이후 A4식 드래그((x,y)→(x+1,y+1) 1px 보존 포함)가 그대로 성립한다(스냅 상시화 차단)"
 *
 * ── rev.5 필수 DOM 계약 (설계서 §2 A28 — 그대로 기록) ──
 * [data-arrange] — 툴바 또는 보드 컨텍스트 메뉴 버튼(보드 메뉴에 두는 경우에도 툴바 버튼
 * 1개는 필수 — 채점기는 [data-arrange] 첫 요소 클릭). 정리 후에도 노트는 absolute 자유 배치 유지.
 * 신규 훅은 폴백 셀렉터 없음: data-속성 부재 = 즉시 FAIL (fail-closed).
 * 굿하트 차단(설계서 §6): 정리 버튼이 그리드 스냅을 상시화 → 사후 A4식 1px 보존 드래그 단언.
 * 사전 조건: 겹침 면적 > 0 인 쌍 ≥ 1 단언 (공허 통과 차단).
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
  requireHook,
  addNote,
  pollVisibleNoteCount,
  noteTopLeft,
  dragNoteTo,
} = require('../lib/helpers');

const STORE_KEY = 'postit-notes';
const N_NOTES = 6;

/** 전 노트의 보드 기준 경계상자 목록 {l,t,r,b} + 보드 크기 */
async function sampleRects(page) {
  return page.evaluate(
    ({ B, N }) => {
      const board = document.querySelector(B);
      if (!board) throw new Error('보드 요소([data-board])를 찾을 수 없습니다');
      const bb = board.getBoundingClientRect();
      return {
        bw: bb.width,
        bh: bb.height,
        rects: Array.from(document.querySelectorAll(N)).map((el) => {
          const r = el.getBoundingClientRect();
          return { l: r.left - bb.left, t: r.top - bb.top, r: r.right - bb.left, b: r.bottom - bb.top };
        }),
      };
    },
    { B: POSTIT_SEL.BOARD, N: POSTIT_SEL.NOTE }
  );
}

function overlapArea(a, b) {
  const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
  const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
  return w > 0 && h > 0 ? w * h : 0;
}

function overlappingPairs(rects) {
  const pairs = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const area = overlapArea(rects[i], rects[j]);
      if (area > 0) pairs.push({ i, j, area });
    }
  }
  return pairs;
}

function outsideBoard(sample, tol) {
  const out = [];
  sample.rects.forEach((r, i) => {
    if (r.l < -tol || r.t < -tol || r.r > sample.bw + tol || r.b > sample.bh + tol) out.push(i);
  });
  return out;
}

function rectsEqual(a, b, tol) {
  if (a.rects.length !== b.rects.length) return false;
  return a.rects.every(
    (r, i) =>
      Math.abs(r.l - b.rects[i].l) <= tol &&
      Math.abs(r.t - b.rects[i].t) <= tol &&
      Math.abs(r.r - b.rects[i].r) <= tol &&
      Math.abs(r.b - b.rects[i].b) <= tol
  );
}

test.describe('A28 한 번에 정리', () => {
  test('A28: 겹친 노트 6개 → [data-arrange] → 5초 내 안정화·겹침 0·보드 내부, 재기동 보존, 이후 A4식 1px 드래그 성립', async () => {
    requirePostit();
    const dir = freshProfileDir();
    const states = [];
    let app = null;
    try {
      app = await launchApp(dir, POSTIT_PATH);
      states.push(app.state);
      let page = app.page;
      for (let i = 0; i < N_NOTES; i++) {
        await addNote(page);
        await pollVisibleNoteCount(page, i + 1, 5000, 'A28');
      }

      // 2쌍을 의도적으로 겹치게 드래그 (노트 1→노트 0 위, 노트 3→노트 2 위)
      const p0 = await noteTopLeft(page, 0);
      await dragNoteTo(page, 1, { x: p0.x + 25, y: p0.y + 25 });
      const p2 = await noteTopLeft(page, 2);
      await dragNoteTo(page, 3, { x: p2.x + 20, y: p2.y + 20 });

      // 사전 조건: 겹침 쌍 ≥ 1 (공허 통과 차단)
      const preSample = await sampleRects(page);
      const preOverlaps = overlappingPairs(preSample.rects);
      expect(
        preOverlaps.length >= 1,
        'A28: 테스트 사전 조건 실패 — 겹치는 노트 쌍을 만들지 못했습니다 (드래그 확인 필요)'
      ).toBe(true);

      // [data-arrange] 클릭 (fail-closed)
      const rawBefore = await page.evaluate((k) => localStorage.getItem(k), STORE_KEY);
      const arrangeBtn = await requireHook(page, '[data-arrange]', 'A28 한 번에 정리');
      await arrangeBtn.click();

      // 5초 내: 300ms 간격 2회 샘플 동일(안정화) + 전 쌍(6C2=15쌍) 겹침 0 + 전 노트 보드 내부(±2px)
      const deadline = Date.now() + 5000;
      let ok = false;
      let lastInfo = '';
      for (;;) {
        const s1 = await sampleRects(page);
        await sleep(300);
        const s2 = await sampleRects(page);
        const stable = rectsEqual(s1, s2, 0.5);
        const overlaps = overlappingPairs(s2.rects);
        const outside = outsideBoard(s2, 2);
        if (stable && overlaps.length === 0 && outside.length === 0 && s2.rects.length === N_NOTES) {
          ok = true;
          break;
        }
        lastInfo =
          `안정화=${stable}, 겹침 쌍=${overlaps.map((p) => `(${p.i + 1},${p.j + 1}:${p.area.toFixed(0)}px²)`).join(',') || '없음'}, ` +
          `보드 밖 노트=${outside.map((i) => i + 1).join(',') || '없음'}`;
        if (Date.now() > deadline) {
          throw new Error(
            `A28: [data-arrange] 클릭 후 5초 내 "위치 안정화(300ms 간격 2회 샘플 동일) + 모든 노트 쌍 경계상자 겹침 면적 0 + 전 노트 보드 내부" 가 충족되지 않았습니다 — ${lastInfo}`
          );
        }
      }

      // 정리 결과 저장 폴링 → 재기동 보존
      {
        const deadline2 = Date.now() + 2500;
        for (;;) {
          const raw = await page.evaluate((k) => localStorage.getItem(k), STORE_KEY);
          if (raw !== null && raw !== rawBefore) break;
          if (Date.now() > deadline2) {
            throw new Error('A28: 정리 결과가 2초 내 localStorage(postit-notes)에 저장되지 않았습니다');
          }
          await sleep(100);
        }
      }
      const savedPositions = [];
      for (let i = 0; i < N_NOTES; i++) savedPositions.push(await noteTopLeft(page, i));
      assertNoDialogs(app.state, 'A28');
      await closeApp(app);
      app = null;

      // ── 재기동: 위치 ±2px 보존 ──
      app = await launchApp(dir, POSTIT_PATH);
      states.push(app.state);
      page = app.page;
      await pollVisibleNoteCount(page, N_NOTES, 5000, 'A28 재기동');
      for (let i = 0; i < N_NOTES; i++) {
        const p = await noteTopLeft(page, i);
        expect(
          Math.abs(p.x - savedPositions[i].x) <= 2 && Math.abs(p.y - savedPositions[i].y) <= 2,
          `A28: 재기동 후 노트 ${i + 1}번 위치 (${p.x.toFixed(1)},${p.y.toFixed(1)}) 가 정리 시점 (${savedPositions[i].x.toFixed(1)},${savedPositions[i].y.toFixed(1)}) ±2px 를 벗어났습니다`
        ).toBe(true);
      }

      // A4식 드래그: (x,y) ±2px 착지 + (x+1,y+1) 재드래그 1px 보존 (스냅 상시화 차단)
      const t1 = { x: 180, y: 140 };
      const r1 = await dragNoteTo(page, 0, t1);
      expect(
        Math.abs(r1.after.x - t1.x) <= 2 && Math.abs(r1.after.y - t1.y) <= 2,
        `A28: 정리 후 A4식 드래그가 깨졌습니다 — 최종 top-left (${r1.after.x.toFixed(1)},${r1.after.y.toFixed(1)}) 가 목표 (${t1.x},${t1.y}) ±2px 를 벗어났습니다`
      ).toBe(true);
      const r2 = await dragNoteTo(page, 0, { x: t1.x + 1, y: t1.y + 1 });
      const ddx = r2.after.x - r1.after.x;
      const ddy = r2.after.y - r1.after.y;
      expect(
        Math.abs(ddx - 1) <= 0.4 && Math.abs(ddy - 1) <= 0.4,
        `A28: (x,y)→(x+1,y+1) 재드래그 시 최종 위치 차가 (${ddx.toFixed(2)},${ddy.toFixed(2)}) 입니다 — 정확히 (1,1)이어야 합니다 (정리 버튼이 그리드 스냅을 상시화한 것으로 의심)`
      ).toBe(true);
      for (const s of states) assertNoDialogs(s, 'A28');
    } finally {
      await closeApp(app);
      await removeDirWithRetry(dir);
    }
  });
});
