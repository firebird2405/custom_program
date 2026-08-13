'use strict';
/**
 * A21 — 우클릭 컨텍스트 메뉴 (rev.5 설계서 §1 A21 / §2 A21, 두 앱)
 * "노트·보드 빈 영역·날짜 셀·일정 각각에 cancelable contextmenu 를 디스패치하면
 *  defaultPrevented=true(브라우저 기본 메뉴 대체)이고 pageerror 0건 + [data-ctx-menu] 가 visible,
 *  바깥 클릭으로 닫힌다. 메뉴 항목([data-ctx-item]) 최소 구성: 노트=색상·복제·맨 앞으로·삭제 /
 *  보드=여기에 새 포스트잇 / 셀=이 날짜에 일정 추가 / 일정=수정·삭제·복제.
 *  동작 검증: 노트 복제=visible +1·새 id·좌상단 오프셋 ≥10px·텍스트 동일, 노트 삭제=A18 과 동일 결과,
 *  셀 메뉴의 '이 날짜에 일정 추가'=그 날짜가 선택되고 document.activeElement 가 일정 입력창"
 *
 * ── rev.5 필수 DOM 계약 (설계서 §2 A21 — 그대로 기록) ──
 * [data-ctx-menu] — 앱당 1개, 열릴 때 [data-ctx-menu="note"|"board"|"cell"|"event"] 로 문맥 표기.
 * 항목은 [data-ctx-item]. 필수 라벨(포함 매칭): 노트 메뉴 "색상"·"복제"·"맨 앞으로"·"삭제" /
 * 보드 메뉴 "여기에 새 포스트잇" / 셀 메뉴 "이 날짜에 일정 추가" / 일정 메뉴 "수정"·"삭제"·"복제".
 * 신규 훅은 폴백 셀렉터 없음: data-속성 부재 = 즉시 FAIL (fail-closed).
 *
 * 판정 메커니즘(설계서 §5 공통): 네이티브 메뉴는 headless 에서 관찰 불가하므로
 * dispatchEvent(new MouseEvent('contextmenu',{bubbles,cancelable,clientX,clientY})) 의
 * 반환 false(=preventDefault 호출됨)로 기본 메뉴 대체를 판정한다 (lib/helpers.openContextMenuOn).
 */
const { test, expect } = require('@playwright/test');
const {
  CALENDAR_PATH,
  POSTIT_PATH,
  requirePostit,
  withFreshApp,
  pollLocalStorage,
  pollPage,
  sleep,
  POSTIT_SEL,
  assertNoDialogs,
  requireHook,
  addNote,
  setNoteText,
  pollVisibleNoteCount,
  noteTopLeft,
  openContextMenuOn,
} = require('../lib/helpers');

/** 열려 있는 [data-ctx-menu] 의 상태 (유효 opacity 포함 visible 판정 + 항목 텍스트 정규화) */
const CTX_STATE_FN = () => {
  const effOpacity = (el) => {
    let o = 1;
    for (let c = el; c && c.nodeType === 1; c = c.parentElement) o *= parseFloat(getComputedStyle(c).opacity) || 0;
    return o;
  };
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && effOpacity(el) > 0.05;
  };
  const menus = Array.from(document.querySelectorAll('[data-ctx-menu]'));
  const open = menus.find(vis) || null;
  return {
    present: menus.length > 0,
    visible: !!open,
    kind: open ? open.getAttribute('data-ctx-menu') : null,
    items: open
      ? Array.from(open.querySelectorAll('[data-ctx-item]')).map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
      : [],
  };
};

async function ctxState(page) {
  return page.evaluate(CTX_STATE_FN);
}

/** 메뉴가 열려 kind·필수 라벨을 만족할 때까지 폴링 후 상태 반환 */
async function expectMenuOpen(page, kind, labels, label) {
  await pollPage(
    page,
    ({ fnSrc, kind, labels }) => {
      const st = new Function('return (' + fnSrc + ')()')();
      if (!st.visible) return false;
      if (kind && st.kind !== kind) return false;
      return labels.every((l) => st.items.some((t) => t.includes(l)));
    },
    { fnSrc: CTX_STATE_FN.toString(), kind, labels },
    3000,
    `${label}: contextmenu 디스패치 후 [data-ctx-menu="${kind}"] 가 visible 상태로 열리고 ` +
      `[data-ctx-item] 라벨 ${labels.map((l) => `"${l}"`).join('·')} 을 모두 포함해야 합니다 — rev.5 DOM 계약 미구현 (fail-closed)`
  );
  return ctxState(page);
}

/** 열린 메뉴의 라벨 포함 항목 클릭 */
async function clickCtxItem(page, labelText, label) {
  const loc = page.locator('[data-ctx-menu] [data-ctx-item]', { hasText: labelText }).first();
  if ((await loc.count()) === 0) {
    throw new Error(`${label}: 컨텍스트 메뉴에서 "${labelText}" 항목([data-ctx-item])을 찾을 수 없습니다`);
  }
  try {
    await loc.click({ timeout: 3000 });
  } catch (e) {
    throw new Error(`${label}: 컨텍스트 메뉴 "${labelText}" 항목을 클릭할 수 없습니다: ` + e.message);
  }
}

/** 메뉴·노트·툴바·토스트가 없는 빈 지점을 찾아 좌클릭 (바깥 클릭 닫힘 판정) */
async function clickOutside(page) {
  const pt = await page.evaluate(() => {
    const bad = (el) =>
      !el ||
      (el.closest &&
        (el.closest('[data-note], .note, .postit') ||
          el.closest('[data-ctx-menu]') ||
          el.closest('.toolbar') ||
          el.closest('header') ||
          el.closest('button') ||
          el.closest('input, textarea, select') ||
          el.closest('[data-toast]')));
    const W = window.innerWidth;
    const H = window.innerHeight;
    const cands = [
      [W - 90, H - 70],
      [90, H - 70],
      [W - 90, 140],
      [Math.floor(W / 2), H - 40],
    ];
    for (const [x, y] of cands) {
      const el = document.elementFromPoint(x, y);
      if (!bad(el)) return { x, y };
    }
    return { x: W - 12, y: H - 12 };
  });
  await page.mouse.click(pt.x, pt.y);
  await sleep(150);
}

async function assertMenuClosed(page, label) {
  await pollPage(
    page,
    (fnSrc) => !new Function('return (' + fnSrc + ')()')().visible,
    CTX_STATE_FN.toString(),
    2000,
    `${label}: 메뉴 바깥을 좌클릭해도 [data-ctx-menu] 가 닫히지 않습니다 (바깥 클릭으로 닫혀야 함)`
  );
}

function assertPrevented(ret, label, targetName) {
  expect(
    ret,
    `${label}: ${targetName} 에 디스패치한 cancelable contextmenu 가 preventDefault 되지 않았습니다 ` +
      '(dispatchEvent 반환 true — 브라우저 기본 메뉴가 대체되지 않음)'
  ).toBe(false);
}

test.describe('A21 우클릭 컨텍스트 메뉴', () => {
  test('A21: 포스트잇 — 노트·보드 메뉴 + 복제·삭제 동작 + 바깥 클릭 닫힘', async () => {
    requirePostit();
    const T = 'A21-원본-노트';
    await withFreshApp(POSTIT_PATH, async ({ page, state }) => {
      await requireHook(page, '[data-ctx-menu]', 'A21 포스트잇');

      // ── 준비: 노트 1개 생성·저장 ──
      await addNote(page);
      await pollVisibleNoteCount(page, 1, 5000, 'A21 포스트잇');
      await setNoteText(page, page.locator(POSTIT_SEL.NOTE).nth(0), T);
      await pollLocalStorage(page, 'postit-notes', (raw) => !!raw && raw.includes(T), 5000);

      // ── 노트 contextmenu: defaultPrevented + 메뉴 visible + 필수 라벨 ──
      const retNote = await openContextMenuOn(page, page.locator(POSTIT_SEL.NOTE).nth(0));
      assertPrevented(retNote, 'A21 포스트잇', '노트');
      await expectMenuOpen(page, 'note', ['색상', '복제', '맨 앞으로', '삭제'], 'A21 포스트잇 노트 메뉴');

      // ── 바깥 클릭으로 닫힘 ──
      await clickOutside(page);
      await assertMenuClosed(page, 'A21 포스트잇 노트 메뉴');

      // ── 복제: visible +1, 새 id, 텍스트 동일, 좌상단 오프셋 ≥10px ──
      await openContextMenuOn(page, page.locator(POSTIT_SEL.NOTE).nth(0));
      await expectMenuOpen(page, 'note', ['복제'], 'A21 포스트잇 노트 메뉴');
      await clickCtxItem(page, '복제', 'A21 포스트잇');
      await pollVisibleNoteCount(page, 2, 5000, 'A21 포스트잇 복제');
      const rawDup = await pollLocalStorage(
        page,
        'postit-notes',
        (raw) => {
          try {
            const a = JSON.parse(raw);
            return Array.isArray(a) && a.length === 2 && a[0].id && a[1].id && a[0].id !== a[1].id;
          } catch (e) {
            return false;
          }
        },
        5000
      );
      const arrDup = JSON.parse(rawDup);
      expect(
        arrDup[0].text === T && arrDup[1].text === T,
        `A21 포스트잇: 복제된 노트의 텍스트가 원본과 다릅니다 (원본 "${arrDup[0].text}", 복제 "${arrDup[1].text}")`
      ).toBe(true);
      const origId = arrDup[0].id;
      await sleep(600); // 생성 애니메이션 안정화 후 위치 측정
      const p0 = await noteTopLeft(page, 0);
      const p1 = await noteTopLeft(page, 1);
      expect(
        Math.abs(p1.x - p0.x) >= 10 || Math.abs(p1.y - p0.y) >= 10,
        `A21 포스트잇: 복제 노트의 좌상단 오프셋이 (${(p1.x - p0.x).toFixed(1)}, ${(p1.y - p0.y).toFixed(1)})px 입니다 ` +
          '(한 축 이상 ≥10px 이어야 함 — 원본과 겹쳐 생성 금지)'
      ).toBe(true);

      // ── 삭제(복제본): A18 과 동일 결과 — visible -1 + 2초 내 저장 제거 ──
      await openContextMenuOn(page, page.locator(POSTIT_SEL.NOTE).nth(1));
      await expectMenuOpen(page, 'note', ['삭제'], 'A21 포스트잇 노트 메뉴');
      await clickCtxItem(page, '삭제', 'A21 포스트잇');
      await pollVisibleNoteCount(page, 1, 5000, 'A21 포스트잇 삭제');
      await pollLocalStorage(
        page,
        'postit-notes',
        (raw) => {
          try {
            const a = JSON.parse(raw);
            return Array.isArray(a) && a.length === 1 && a[0].id === origId;
          } catch (e) {
            return false;
          }
        },
        2000
      );

      // ── 보드 빈 영역 contextmenu ──
      const retBoard = await openContextMenuOn(page, page.locator(POSTIT_SEL.BOARD).first());
      assertPrevented(retBoard, 'A21 포스트잇', '보드 빈 영역');
      await expectMenuOpen(page, 'board', ['여기에 새 포스트잇'], 'A21 포스트잇 보드 메뉴');
      await clickOutside(page);
      await assertMenuClosed(page, 'A21 포스트잇 보드 메뉴');

      expect(
        state.pageErrors,
        `A21 포스트잇: pageerror ${state.pageErrors.length}건 발생 (0건이어야 함): ${state.pageErrors.join(' | ')}`
      ).toHaveLength(0);
      assertNoDialogs(state, 'A21 포스트잇');
    });
  });

  test('A21: 캘린더 — 날짜 셀·일정 메뉴 + 셀 메뉴로 날짜 선택·입력창 포커스 + 바깥 클릭 닫힘', async () => {
    const EV = 'A21-일정';
    await withFreshApp(CALENDAR_PATH, async ({ page, state }) => {
      await requireHook(page, '[data-ctx-menu]', 'A21 캘린더');

      // ── 날짜 셀(이번 달 15일) contextmenu ──
      const cellLoc = page
        .locator('#grid .cell:not(.other)', { has: page.locator('.num:text-is("15")') })
        .first();
      expect((await cellLoc.count()) > 0, 'A21 캘린더: 이번 달 15일 셀을 찾을 수 없습니다').toBe(true);
      const cellKey = await cellLoc.evaluate((el) => el.dataset.key || null);
      expect(cellKey, 'A21 캘린더: 날짜 셀에 데이터 키(dataset.key)가 없습니다 — 컨텍스트 메뉴 대상 식별 불가').toBeTruthy();

      const retCell = await openContextMenuOn(page, cellLoc);
      assertPrevented(retCell, 'A21 캘린더', '날짜 셀');
      await expectMenuOpen(page, 'cell', ['이 날짜에 일정 추가'], 'A21 캘린더 셀 메뉴');

      // 바깥 클릭 닫힘
      await clickOutside(page);
      await assertMenuClosed(page, 'A21 캘린더 셀 메뉴');

      // ── 셀 메뉴 동작: 그 날짜 선택 + 일정 입력창 포커스 ──
      await openContextMenuOn(page, cellLoc);
      await expectMenuOpen(page, 'cell', ['이 날짜에 일정 추가'], 'A21 캘린더 셀 메뉴');
      await clickCtxItem(page, '이 날짜에 일정 추가', 'A21 캘린더');
      await pollPage(
        page,
        (key) => {
          const c = document.querySelector('#grid .cell.selected');
          return !!c && c.dataset.key === key;
        },
        cellKey,
        2000,
        `A21 캘린더: '이 날짜에 일정 추가' 클릭 후 ${cellKey} 셀이 선택 상태가 되지 않았습니다`
      );
      const title = (await page.locator('#monthTitle').textContent()) || '';
      const tm = /(\d{4})\s*년\s*(\d{1,2})\s*월/.exec(title);
      const kp = cellKey.split('-');
      expect(
        !!tm && Number(tm[1]) === Number(kp[0]) && Number(tm[2]) === Number(kp[1]),
        `A21 캘린더: #monthTitle("${title}")이 선택 날짜 ${cellKey} 의 연·월과 일치하지 않습니다`
      ).toBe(true);
      const focused = await page.evaluate(() => {
        const ae = document.activeElement;
        return !!(ae && (ae.id === 'addText' || ae.hasAttribute('data-add-text')));
      });
      expect(
        focused,
        "A21 캘린더: '이 날짜에 일정 추가' 클릭 후 document.activeElement 가 일정 텍스트 입력창(#addText 또는 [data-add-text])이 아닙니다"
      ).toBe(true);

      // ── 일정 생성 후 일정 contextmenu ──
      await page.fill('#addText', EV);
      await page.click('#addBtn');
      const liLoc = page.locator('#eventList li', { hasText: EV }).first();
      await liLoc.waitFor({ state: 'visible', timeout: 5000 });
      const retEv = await openContextMenuOn(page, liLoc);
      assertPrevented(retEv, 'A21 캘린더', '일정 항목');
      await expectMenuOpen(page, 'event', ['수정', '삭제', '복제'], 'A21 캘린더 일정 메뉴');
      await clickOutside(page);
      await assertMenuClosed(page, 'A21 캘린더 일정 메뉴');

      expect(
        state.pageErrors,
        `A21 캘린더: pageerror ${state.pageErrors.length}건 발생 (0건이어야 함): ${state.pageErrors.join(' | ')}`
      ).toHaveLength(0);
      assertNoDialogs(state, 'A21 캘린더');
    });
  });
});
