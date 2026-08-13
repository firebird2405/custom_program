'use strict';
/**
 * A19 — 포스트잇 백업 왕복 (rev.5 설계서 §1 A19)
 * "포스트잇에 텍스트·색·위치가 서로 다른 노트 2개 생성 → 내보내기([data-export]) 클릭 시
 *  `.json` 다운로드가 발생하고 파일이 두 노트를 포함한 유효 JSON → `postit-notes` 제거+reload로
 *  visible 노트 0 확인 → 그 파일을 가져오기([data-import]→filechooser)하면 저장소에 정확히
 *  2건 복원되고 두 노트의 텍스트·색·위치(±2px)가 UI에 표시된다. dialog 0건"
 *
 * ── rev.5 필수 DOM 계약 (설계서 §2 A19 — 그대로 기록) ──
 * [data-export], [data-import] — 포스트잇 툴바 버튼. 내보내기 형식은 가져오기가 그대로
 * 수용하는 자기완결 JSON(보드 확장 시 전 보드 포함 권장이나, 판정은 활성 보드 2건 왕복만).
 * 신규 훅은 폴백 셀렉터 없음: data-속성 부재 = 즉시 FAIL (fail-closed).
 * 다운로드 파일은 os.tmpdir() 하위에 저장 후 정리한다 (채점기 해시 오염 방지, a15 구조 이식).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
  POSTIT_PATH,
  requirePostit,
  withFreshApp,
  removeDirWithRetry,
  pollLocalStorage,
  requireHook,
  assertNoDialogs,
  addNote,
  setNoteText,
  countVisibleNotes,
  pollVisibleNoteCount,
  noteIndexByText,
  noteTopLeft,
  dragNoteTo,
  parseRgb,
  rgbDist,
  POSTIT_SEL,
  sleep,
} = require('../lib/helpers');

const STORE_KEY = 'postit-notes';
const T1 = 'A19-백업-노트-하나';
const T2 = 'A19-백업-노트-둘';

/** raw(JSON)에서 두 텍스트를 모두 포함하는 노트 배열을 찾아 그 길이를 반환 (없으면 null) */
function countNotesInRaw(raw, texts) {
  try {
    const o = JSON.parse(raw);
    const arrays = [];
    if (Array.isArray(o)) arrays.push(o);
    else if (o && typeof o === 'object') {
      for (const k of Object.keys(o)) if (Array.isArray(o[k])) arrays.push(o[k]);
    }
    for (const a of arrays) {
      const s = JSON.stringify(a);
      if (texts.every((t) => s.includes(t))) return a.length;
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function noteBg(page, idx) {
  return page.evaluate(
    ({ N, idx }) => {
      const el = document.querySelectorAll(N)[idx];
      return el ? getComputedStyle(el).backgroundColor : null;
    },
    { N: POSTIT_SEL.NOTE, idx }
  );
}

test.describe('A19 포스트잇 백업 왕복', () => {
  test('A19: 노트 2개(텍스트·색·위치 상이) → [data-export] JSON 다운로드 → 저장소 비움 → [data-import] → 2건 복원(텍스트·색·위치 ±2px)', async () => {
    requirePostit();
    const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grader-a19-dl-'));
    try {
      await withFreshApp(
        POSTIT_PATH,
        async ({ page, state }) => {
          // ── 노트 2개 생성: 텍스트·색·위치 상이 ──
          await addNote(page);
          await pollVisibleNoteCount(page, 1, 5000, 'A19');
          await setNoteText(page, page.locator(POSTIT_SEL.NOTE).nth(0), T1);
          await addNote(page);
          await pollVisibleNoteCount(page, 2, 5000, 'A19');
          await setNoteText(page, page.locator(POSTIT_SEL.NOTE).nth(1), T2);

          // 노트 1 색 변경 (팔레트 견본 클릭 — A3 계약): 두 노트의 현재 색과 모두 다른 견본 선택
          await page.locator(POSTIT_SEL.NOTE).nth(0).click();
          await sleep(150);
          const bgNote1 = parseRgb(await noteBg(page, 0));
          const bgNote2 = parseRgb(await noteBg(page, 1));
          const swatches = page.locator(POSTIT_SEL.SWATCH);
          const swCount = await swatches.count();
          expect(swCount >= 4, `색상 견본([data-color])이 ${swCount}개입니다 (A3 계약: 4개 이상)`).toBe(true);
          let changed = false;
          for (let i = 0; i < swCount; i++) {
            const sw = swatches.nth(i);
            if (!(await sw.isVisible())) continue;
            const swBg = await sw.evaluate((el) => getComputedStyle(el).backgroundColor);
            const a = parseRgb(swBg);
            if (a && bgNote1 && bgNote2 && rgbDist(a, bgNote1) > 10 && rgbDist(a, bgNote2) > 10) {
              await sw.click();
              changed = true;
              break;
            }
          }
          expect(changed, 'A19: 노트 1의 색을 두 노트의 현재 색과 다른 팔레트 색으로 바꾸지 못했습니다').toBe(true);
          await sleep(200);

          // 위치 상이: 두 노트를 서로 다른 좌표로 드래그
          await dragNoteTo(page, 0, { x: 140, y: 210 });
          await dragNoteTo(page, 1, { x: 520, y: 330 });

          // 기대 상태 채집 (텍스트·색·위치)
          const wantBg1 = await noteBg(page, 0);
          const wantBg2 = await noteBg(page, 1);
          const wantP1 = await noteTopLeft(page, 0);
          const wantP2 = await noteTopLeft(page, 1);
          expect(
            parseRgb(wantBg1) && parseRgb(wantBg2) && rgbDist(parseRgb(wantBg1), parseRgb(wantBg2)) > 10,
            `A19: 두 노트의 색이 서로 다르지 않습니다 (${wantBg1} vs ${wantBg2})`
          ).toBe(true);

          // 저장 확인
          await pollLocalStorage(page, STORE_KEY, (raw) => !!raw && raw.includes(T1) && raw.includes(T2), 5000);

          // ── 내보내기: [data-export] → .json 다운로드 + 유효 JSON + 두 노트 포함 ──
          const exportBtn = await requireHook(page, '[data-export]', 'A19 내보내기');
          let download = null;
          try {
            [download] = await Promise.all([
              page.waitForEvent('download', { timeout: 15000 }),
              exportBtn.click(),
            ]);
          } catch (e) {
            throw new Error('A19: [data-export] 클릭 후 15초 내 다운로드가 발생하지 않았습니다: ' + e.message);
          }
          const fname = download.suggestedFilename() || 'postit-backup.json';
          expect(fname, `A19: 다운로드 파일명이 .json 형식이 아닙니다: ${fname}`).toMatch(/\.json$/i);
          const filePath = path.join(dlDir, fname);
          await download.saveAs(filePath);
          let exportedRaw = null;
          let exported = null;
          try {
            exportedRaw = fs.readFileSync(filePath, 'utf8');
            exported = JSON.parse(exportedRaw);
          } catch (e) {
            exported = null;
          }
          expect(exported, 'A19: 내보낸 파일이 유효한 JSON 이 아닙니다').not.toBeNull();
          expect(
            exportedRaw.includes(T1) && exportedRaw.includes(T2),
            `A19: 내보낸 JSON 에 두 노트(${T1}, ${T2})가 모두 들어 있지 않습니다`
          ).toBe(true);

          // ── 저장소 비움 + reload → visible 노트 0 ──
          await page.evaluate((k) => localStorage.removeItem(k), STORE_KEY);
          await page.reload({ waitUntil: 'load' });
          const emptyCount = await countVisibleNotes(page);
          expect(
            emptyCount,
            `A19: postit-notes 제거+reload 후 visible 노트가 ${emptyCount}개입니다 (0개여야 함)`
          ).toBe(0);

          // ── 가져오기: [data-import] → filechooser → 2건 복원 ──
          const importBtn = await requireHook(page, '[data-import]', 'A19 가져오기');
          let chooser = null;
          try {
            [chooser] = await Promise.all([
              page.waitForEvent('filechooser', { timeout: 15000 }),
              importBtn.click(),
            ]);
          } catch (e) {
            throw new Error('A19: [data-import] 클릭 후 파일 선택기(filechooser)가 열리지 않았습니다: ' + e.message);
          }
          await chooser.setFiles(filePath);

          // 저장소에 정확히 2건 복원
          const restoredRaw = await pollLocalStorage(
            page,
            STORE_KEY,
            (raw) => countNotesInRaw(raw, [T1, T2]) !== null,
            5000
          );
          const n = countNotesInRaw(restoredRaw, [T1, T2]);
          expect(n, `A19: 가져오기 후 저장소의 노트가 ${n}건입니다 (정확히 2건이어야 함)`).toBe(2);

          // UI: 텍스트·색·위치(±2px) 재현
          await pollVisibleNoteCount(page, 2, 5000, 'A19 복원');
          const i1 = await noteIndexByText(page, T1);
          const i2 = await noteIndexByText(page, T2);
          expect(i1 >= 0, `A19: 복원 후 "${T1}" 노트가 화면에 없습니다`).toBe(true);
          expect(i2 >= 0, `A19: 복원 후 "${T2}" 노트가 화면에 없습니다`).toBe(true);

          const checks = [
            { idx: i1, text: T1, bg: wantBg1, p: wantP1 },
            { idx: i2, text: T2, bg: wantBg2, p: wantP2 },
          ];
          for (const c of checks) {
            const gotBg = await noteBg(page, c.idx);
            const ga = parseRgb(gotBg);
            const wa = parseRgb(c.bg);
            expect(!!ga && !!wa, `A19: 복원 노트("${c.text}") 배경색을 해석할 수 없습니다 (${gotBg})`).toBe(true);
            expect(
              Math.abs(ga.r - wa.r) <= 3 && Math.abs(ga.g - wa.g) <= 3 && Math.abs(ga.b - wa.b) <= 3,
              `A19: 복원 노트("${c.text}") 색이 다릅니다 (기대 ${c.bg}, 실제 ${gotBg}, 채널별 ±3 허용)`
            ).toBe(true);
            const gp = await noteTopLeft(page, c.idx);
            expect(
              Math.abs(gp.x - c.p.x) <= 2 && Math.abs(gp.y - c.p.y) <= 2,
              `A19: 복원 노트("${c.text}") 위치 (${gp.x.toFixed(1)},${gp.y.toFixed(1)}) 가 내보내기 시점 (${c.p.x.toFixed(1)},${c.p.y.toFixed(1)}) ±2px 를 벗어났습니다`
            ).toBe(true);
          }

          assertNoDialogs(state, 'A19');
        },
        { contextOptions: { acceptDownloads: true } }
      );
    } finally {
      await removeDirWithRetry(dlDir);
    }
  });
});
