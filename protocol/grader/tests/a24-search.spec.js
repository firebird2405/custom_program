'use strict';
/**
 * A24 — 노트 검색 (rev.5 설계서 §1 A24)
 * "노트 3개(그중 2개에 키워드 포함) 상태에서 [data-search] 에 키워드 입력 → 2초 내 비매칭
 *  노트의 유효 opacity(조상 누적) < 0.5, 매칭 노트 ≥ 0.9, 저장소는 불변(검색이 삭제로 구현되지
 *  않음) → 입력을 비우면 전 노트 ≥ 0.9 로 복귀"
 *
 * ── rev.5 필수 DOM 계약 (설계서 §2 A24 — 그대로 기록) ──
 * [data-search] — input, 대소문자 무시 부분 문자열 매칭(한글은 그대로), 매칭 판정 대상은
 * 노트 텍스트 전체. 검색은 표시만 바꾸고 저장소·위치를 건드리지 않는다.
 * display:none 처리도 "비매칭 시 흐리게" 요건 위반으로 FAIL: 비매칭 노트는 boundingRect > 0
 * 이어야 함(숨김이 아니라 흐림).
 * 신규 훅은 폴백 셀렉터 없음: data-속성 부재 = 즉시 FAIL (fail-closed).
 * 굿하트 차단(설계서 §6): 검색을 삭제/재생성으로 구현 → 저장소 불변 단언.
 */
const { test, expect } = require('@playwright/test');
const {
  POSTIT_PATH,
  requirePostit,
  withFreshApp,
  pollLocalStorage,
  sleep,
  POSTIT_SEL,
  assertNoDialogs,
  requireHook,
  addNote,
  setNoteText,
  pollVisibleNoteCount,
} = require('../lib/helpers');

const STORE_KEY = 'postit-notes';
const MATCH1 = '회의 준비';
const MATCH2 = '회의록 정리';
const MISS = '장보기';
const KEYWORD = '회의';

/** 각 노트의 {text, effOpacity, rectArea} 채집 */
async function readNoteOpacities(page) {
  return page.evaluate((N) => {
    const effOpacity = (el) => {
      let o = 1;
      for (let c = el; c && c.nodeType === 1; c = c.parentElement) o *= parseFloat(getComputedStyle(c).opacity) || 0;
      return o;
    };
    return Array.from(document.querySelectorAll(N)).map((el) => {
      const t = el.querySelector('[data-note-text]');
      const ta = el.querySelector('textarea');
      const r = el.getBoundingClientRect();
      return {
        text: (t && t.textContent) || (ta && ta.value) || el.textContent || '',
        op: effOpacity(el),
        area: r.width * r.height,
        display: getComputedStyle(el).display,
      };
    });
  }, POSTIT_SEL.NOTE);
}

function classify(notes) {
  const match = notes.filter((n) => n.text.includes(KEYWORD));
  const miss = notes.filter((n) => !n.text.includes(KEYWORD));
  return { match, miss };
}

test.describe('A24 노트 검색', () => {
  test('A24: 키워드 입력 → 비매칭 흐림(<0.5)·매칭 유지(≥0.9)·저장소 불변 → 비우면 전원 복귀', async () => {
    requirePostit();
    await withFreshApp(POSTIT_PATH, async ({ page, state }) => {
      // 노트 3개: 2개 키워드 포함, 1개 비포함
      const texts = [MATCH1, MATCH2, MISS];
      for (let i = 0; i < texts.length; i++) {
        await addNote(page);
        await pollVisibleNoteCount(page, i + 1, 5000, 'A24');
        await setNoteText(page, page.locator(POSTIT_SEL.NOTE).nth(i), texts[i]);
      }
      const rawBefore = await pollLocalStorage(
        page,
        STORE_KEY,
        (raw) => !!raw && texts.every((t) => raw.includes(t)),
        5000
      );

      // 검색 입력 (fail-closed 훅)
      const search = await requireHook(page, '[data-search]', 'A24 검색');
      try {
        await search.fill(KEYWORD);
      } catch (e) {
        throw new Error('A24: [data-search] 에 키워드를 입력할 수 없습니다 (input 이어야 함): ' + e.message);
      }

      // 2초 내: 매칭 ≥ 0.9, 비매칭 < 0.5 (단, 비매칭도 rect > 0 — 숨김이 아니라 흐림)
      const deadline = Date.now() + 2000;
      let last = null;
      for (;;) {
        const notes = await readNoteOpacities(page);
        const { match, miss } = classify(notes);
        last = notes;
        const ok =
          match.length === 2 &&
          miss.length === 1 &&
          match.every((n) => n.op >= 0.9) &&
          miss.every((n) => n.op < 0.5 && n.area > 0 && n.display !== 'none');
        if (ok) break;
        if (Date.now() > deadline) {
          const dump = last.map((n) => `"${n.text.slice(0, 12)}" op=${n.op.toFixed(2)} area=${n.area.toFixed(0)} display=${n.display}`).join(' | ');
          throw new Error(
            `A24: 키워드 "${KEYWORD}" 입력 후 2초 내 매칭 노트 유효 opacity ≥ 0.9 · 비매칭 < 0.5(단 boundingRect > 0, display:none 금지 — 숨김이 아니라 흐림) 조건이 충족되지 않았습니다. 현재: ${dump}`
          );
        }
        await sleep(100);
      }

      // 저장소 불변 (검색을 삭제/재생성으로 구현 금지)
      const rawDuring = await page.evaluate((k) => localStorage.getItem(k), STORE_KEY);
      expect(
        rawDuring,
        'A24: 검색 중 localStorage(postit-notes) 원문이 변경되었습니다 — 검색은 표시만 바꿔야 하며 저장소를 건드리면 안 됩니다'
      ).toBe(rawBefore);

      // 입력 비움 → 전 노트 ≥ 0.9 복귀
      await search.fill('');
      const deadline2 = Date.now() + 2000;
      for (;;) {
        const notes = await readNoteOpacities(page);
        if (notes.length === 3 && notes.every((n) => n.op >= 0.9 && n.area > 0)) break;
        if (Date.now() > deadline2) {
          const dump = notes.map((n) => `"${n.text.slice(0, 12)}" op=${n.op.toFixed(2)}`).join(' | ');
          throw new Error(`A24: 검색어를 비운 뒤 2초 내 전 노트가 유효 opacity ≥ 0.9 로 복귀하지 않았습니다. 현재: ${dump}`);
        }
        await sleep(100);
      }

      assertNoDialogs(state, 'A24');
    });
  });
});
