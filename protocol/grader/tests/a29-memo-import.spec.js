'use strict';
/**
 * A29 — memo.html 이전 (rev.5 설계서 §1 A29)
 * "채점기가 `memo-notes` 키에 memo.html 스키마(`[{id,text,pinned,updatedAt}]`) 메모 3건
 *  (줄바꿈 포함)을 주입한 상태에서 메모 가져오기([data-import-memo]) 실행 → visible 노트
 *  정확히 +3, 각 노트 textContent 가 원문 그대로, 재기동 후 보존, `memo-notes` 원본 키는
 *  파괴되지 않는다"
 *
 * ── rev.5 필수 DOM 계약 (설계서 §2 A29 — 그대로 기록) ──
 * [data-import-memo] — 라벨에 "메모" 포함, 보드 컨텍스트 메뉴 항목 또는 툴바.
 * 변환 규칙: 메모 1건 = 노트 1건, text 전체 보존(pinned/updatedAt 은 자유 처리).
 * 재실행 중복 방지는 판정하지 않음(단, 중복 생성 시에도 원문 보존 단언은 그대로 적용됨).
 * 읽기 전용 소비: memo-notes (무파괴).
 * 신규 훅은 폴백 셀렉터 없음: data-속성 부재 = 즉시 FAIL (fail-closed).
 */
const { test, expect } = require('@playwright/test');
const {
  POSTIT_PATH,
  requirePostit,
  freshProfileDir,
  launchApp,
  closeApp,
  removeDirWithRetry,
  pollPage,
  sleep,
  POSTIT_SEL,
  assertNoDialogs,
  addNote,
  pollVisibleNoteCount,
  countVisibleNotes,
  hasVisibleNoteText,
  openContextMenuOn,
} = require('../lib/helpers');

const MEMOS = [
  { id: 'm1', text: '첫 메모\n둘째 줄', pinned: false, updatedAt: 1767139200000 },
  { id: 'm2', text: '두 번째 메모 — 고정됨', pinned: true, updatedAt: 1767225600000 },
  { id: 'm3', text: '세 번째 메모\n줄 2\n줄 3', pinned: false, updatedAt: 1767312000000 },
];
const MEMO_RAW = JSON.stringify(MEMOS);

/** [data-import-memo] 를 찾아 클릭 (직접 노출 → 보드 컨텍스트 메뉴 순, fail-closed) */
async function clickImportMemo(page) {
  let btn = page.locator('[data-import-memo]').first();
  let visible = await btn.isVisible().catch(() => false);
  if (!visible) {
    const board = page.locator(POSTIT_SEL.BOARD).first();
    if ((await board.count()) > 0) {
      await openContextMenuOn(page, board);
      await sleep(200);
      btn = page.locator('[data-import-memo]').first();
      visible = await btn.isVisible().catch(() => false);
    }
  }
  if (!visible) {
    throw new Error(
      'A29: 필수 훅 [data-import-memo] 가 툴바에도, 보드 컨텍스트 메뉴에도 없습니다 — rev.5 DOM 계약 미구현 (fail-closed: 폴백 없음)'
    );
  }
  const label = ((await btn.textContent()) || '').replace(/\s+/g, ' ').trim();
  expect(
    label.includes('메모'),
    `A29: [data-import-memo] 라벨("${label}")에 "메모" 가 포함되어야 합니다`
  ).toBe(true);
  try {
    await btn.click({ timeout: 3000 });
  } catch (e) {
    throw new Error('A29: [data-import-memo] 를 클릭할 수 없습니다: ' + e.message);
  }
}

/** 각 메모 text 가 노트 안에 원문 그대로(정확 일치 textContent, 줄바꿈 보존) visible 한지 단언 */
async function assertMemoTexts(page, label) {
  for (const m of MEMOS) {
    const found = await hasVisibleNoteText(page, m.text, true);
    expect(
      found,
      `${label}: 메모 원문이 textContent 로 그대로 표시되지 않았습니다 (줄바꿈 \\n 보존 필요): ${JSON.stringify(m.text)}`
    ).toBe(true);
  }
}

test.describe('A29 memo.html 이전', () => {
  test('A29: memo-notes 3건 주입 → [data-import-memo] → visible +3·원문 그대로·재기동 보존·memo-notes 무파괴', async () => {
    requirePostit();
    const dir = freshProfileDir();
    const states = [];
    let app = null;
    try {
      // ── 기동 1: memo-notes 주입 → reload → 가져오기 ──
      app = await launchApp(dir, POSTIT_PATH);
      states.push(app.state);
      let page = app.page;

      // 기준선: 기존 노트 1개 생성 (visible "+3" 판정을 0→3 공허 통과가 아닌 1→4 로 검증)
      await addNote(page);
      await pollVisibleNoteCount(page, 1, 5000, 'A29 기준선');
      const baseCount = await countVisibleNotes(page);

      await page.evaluate((raw) => localStorage.setItem('memo-notes', raw), MEMO_RAW);
      await page.reload({ waitUntil: 'load' });
      await pollVisibleNoteCount(page, baseCount, 5000, 'A29 재로드');

      await clickImportMemo(page);

      // visible 노트 정확히 +3
      await pollVisibleNoteCount(page, baseCount + 3, 5000, 'A29 가져오기');
      await sleep(200);
      const afterCount = await countVisibleNotes(page);
      expect(
        afterCount,
        `A29: 메모 가져오기 후 visible 노트가 ${afterCount}개입니다 (정확히 ${baseCount + 3}개 — +3 이어야 함)`
      ).toBe(baseCount + 3);

      // 각 노트 textContent 원문 그대로 (줄바꿈 보존)
      await assertMemoTexts(page, 'A29');

      // postit-notes 에 저장 (앱 저장 키로의 이전)
      await pollPage(
        page,
        () =>
          ['첫 메모', '두 번째 메모', '세 번째 메모'].every((t) =>
            Object.keys(localStorage).some(
              (k) => k !== 'memo-notes' && (localStorage.getItem(k) || '').includes(t)
            )
          ),
        null,
        5000,
        'A29: 가져온 메모가 포스트잇 저장 키(postit-notes)에 저장되지 않았습니다'
      );

      // memo-notes 원본 무파괴
      const memoRawNow = await page.evaluate(() => localStorage.getItem('memo-notes'));
      expect(
        memoRawNow,
        'A29: 가져오기 후 memo-notes 원본 키가 변경/파괴되었습니다 (읽기 전용 소비여야 함)'
      ).toBe(MEMO_RAW);
      assertNoDialogs(app.state, 'A29');
      await closeApp(app);
      app = null;

      // ── 재기동: 3건 보존 + memo-notes 무파괴 ──
      app = await launchApp(dir, POSTIT_PATH);
      states.push(app.state);
      page = app.page;
      await pollVisibleNoteCount(page, baseCount + 3, 5000, 'A29 재기동');
      await assertMemoTexts(page, 'A29 재기동');
      const memoRawFinal = await page.evaluate(() => localStorage.getItem('memo-notes'));
      expect(
        memoRawFinal,
        'A29: 재기동 후 memo-notes 원본 키가 주입값과 다릅니다 (원본 무파괴 위반)'
      ).toBe(MEMO_RAW);
      for (const s of states) assertNoDialogs(s, 'A29');
    } finally {
      await closeApp(app);
      await removeDirWithRetry(dir);
    }
  });
});
