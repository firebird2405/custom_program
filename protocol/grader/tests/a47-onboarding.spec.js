'use strict';
/**
 * A47 — 온보딩 (SCORECARD rev.6)
 * "온보딩(Electron 셸 레이어, 훅 [data-onboarding]/[data-onboarding-target]/[data-onboarding-skip]
 *  — fail-closed): fresh 첫 실행에 표시되고, 스텝 = 채점기 발행 사용자 입력 액션 1회(click/press/
 *  drag 각 1, fill 1필드 1 — 자동 전진 슬라이드 제외) 기준 ≤8스텝으로 첫 포스트잇 실제 타이핑 +
 *  첫 스티커 실제 드래그 부착이 완료되며, 콘텐츠는 사용자 입력분이 저장·유지된다(온보딩의 자동
 *  생성 콘텐츠로 완료 계수 금지). 각 스텝 대상은 현재 단계의 [data-onboarding-target]과 일치.
 *  건너뛰어도 앱 정상 + 설정에서 재실행 가능"
 *
 * ══ rev.6 필수 계약 (REQUIRED CONTRACT — 본 주석이 A47 DOM·구동 계약의 정본) ══
 *
 * 0) 레이어: 온보딩은 Electron 셸 전용(파일:// 채점 55개의 fresh 기본값 계약에 미노출).
 *    fresh(빈 PETIT_USERDATA) 첫 실행 시 포스트잇 창에 [data-onboarding] 루트가 15초 내
 *    엄격 가시(visible). 완료 또는 건너뛰기 후에는 비표시이고, 같은 userData 재기동 시에도
 *    다시 표시되지 않는다(첫 실행 전용). 훅 부재/미표시 = 즉시 한국어 FAIL (fail-closed).
 *
 * 1) 단계 규약 (기계 구동 계약): 사용자 액션이 필요한 각 단계에서 엄격 가시
 *    [data-onboarding-target] 이 정확히 1개 존재하고, 그 요소가 "지금 조작할 실제 UI"다.
 *    속성값이 요구 액션을 선언한다:
 *      - "click" (빈 값·속성만 있어도 click 으로 해석) — 해당 요소 클릭 1회
 *      - "fill"                — 해당 요소(input/textarea/contenteditable)에 텍스트 입력 (1필드 = 1액션)
 *      - "press:<Key>"         — 해당 요소에 키 1회 (예: press:Enter)
 *      - "drag:<CSS셀렉터>"    — 해당 요소를 셀렉터가 가리키는 엄격 가시 목적지의 중앙으로
 *                                mouse down→move(steps 12)→up 드래그 1회
 *    액션 수행 후 다음 단계의 target(다른 요소 또는 같은 요소의 다른 속성값)이 나타나거나
 *    온보딩이 종료되어야 한다(12초 내). 사용자 액션이 불필요한 자동 전진 안내 슬라이드는
 *    visible target 0개 상태로 스스로 전진해야 하며(12초 내) 액션으로 계수되지 않는다.
 *
 * 2) 완료 계약: 채점기 발행 액션 합계 ≤8 안에 [data-onboarding] 종료 + 그 과정에
 *    fill ≥1회(첫 포스트잇 실제 타이핑 — 채점기 마커 텍스트 입력)와 drag ≥1회(첫 스티커 실제
 *    드래그 부착)가 포함되어야 한다. 9번째 액션 요구 = FAIL.
 *
 * 3) 콘텐츠 진위 (굿하트 차단 — 자동 생성 콘텐츠로 완료 계수 금지): 종료 직후
 *    visible 노트는 정확히 1개이고 채점기 마커 텍스트를 포함해야 하며, visible [data-sticker]
 *    도 정확히 1개(드래그로 부착된 것)여야 한다. 마커는 postit-* localStorage 키에 저장되고
 *    (2초 저장 원칙 — 5초 폴링), 스티커는 postit-decor* 키의 stickers 배열에 저장된다.
 *    같은 userData 재기동 후에도 마커 노트·스티커가 유지되고 온보딩은 재표시되지 않는다.
 *
 * 4) 건너뛰기·재실행: [data-onboarding-skip] 은 온보딩 표시 중 항상 엄격 가시. 클릭 → 5초 내
 *    종료 → 앱 정상([data-add-note] 동작, 자동 생성 콘텐츠 0). 설정 패널(동결 빌드 UI
 *    #settingsBtn)에 재실행 컨트롤 [data-onboarding-replay](rev.6 신설 훅, fail-closed) —
 *    클릭 시 [data-onboarding] 재표시.
 *
 * 공통 규정: dialog 0건·pageerror 0건. 셸/훅 미구현 시 "electron 셸 미구축 (2단계 진행 중)" 류
 * 명확한 한국어 FAIL (크래시·skip-pass 금지).
 */
const { test, expect } = require('@playwright/test');
const {
  requirePostit,
  removeDirWithRetry,
  sleep,
  assertNoDialogs,
  addNote,
  pollVisibleNoteCount,
  countVisibleNotes,
  pollVisibleNoteText,
  pollPage,
} = require('../lib/helpers');
const {
  requireElectronShell,
  freshUserDataDir,
  launchElectronShell,
  getAppWindow,
  closeElectronShell,
  countVisibleStrict,
  pollVisibleStrict,
  dismissMigrateIfPresent,
} = require('../lib/electron-helpers');

const MAX_ACTIONS = 8;

/** 현재 온보딩 상태 스냅숏: 루트 가시성 + 엄격 가시 target 의 (정체 토큰, 액션 종류) */
async function readStep(page) {
  return page.evaluate(() => {
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
    const root = document.querySelector('[data-onboarding]');
    if (!root || !vis(root)) return { rootVisible: false, targetCount: 0, token: null, kind: null };
    const targets = Array.from(document.querySelectorAll('[data-onboarding-target]')).filter(vis);
    let token = null;
    let kind = null;
    if (targets.length === 1) {
      const t = targets[0];
      if (!t.__graderA47Tok) {
        window.__graderA47Seq = (window.__graderA47Seq || 0) + 1;
        t.__graderA47Tok = window.__graderA47Seq;
      }
      token = t.__graderA47Tok;
      kind = t.getAttribute('data-onboarding-target') || 'click';
      if (kind.trim() === '') kind = 'click';
    }
    return { rootVisible: true, targetCount: targets.length, token, kind };
  });
}

/**
 * 다음 액션 단계(이전과 다른 target) 또는 온보딩 종료를 기다린다.
 * @returns {{done:true} | {done:false, token, kind}}
 */
async function waitStep(page, prev, timeoutMs, performedDesc) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const s = await readStep(page);
    if (!s.rootVisible) return { done: true };
    if (s.targetCount > 1) {
      throw new Error(
        `A47: 현재 단계의 엄격 가시 [data-onboarding-target] 이 ${s.targetCount}개입니다 — 정확히 1개 계약 위반 (fail-closed)`
      );
    }
    if (s.targetCount === 1 && !(prev && prev.token === s.token && prev.kind === s.kind)) {
      return { done: false, token: s.token, kind: s.kind };
    }
    if (Date.now() > deadline) {
      throw new Error(
        prev
          ? `A47: 액션(${prev.kind}) 수행 후 ${timeoutMs}ms 내 다음 단계로 전진하지도, 온보딩이 끝나지도 않았습니다 ` +
            `(지금까지: ${performedDesc || '없음'})`
          : `A47: ${timeoutMs}ms 내 첫 [data-onboarding-target] 이 나타나지도, 온보딩이 끝나지도 않았습니다 (자동 전진 정체)`
      );
    }
    await sleep(120);
  }
}

/** 현재 유일 visible target 의 ElementHandle */
async function getTargetHandle(page) {
  const h = await page.evaluateHandle(() => {
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
    return Array.from(document.querySelectorAll('[data-onboarding-target]')).filter(vis)[0] || null;
  });
  const el = h.asElement();
  if (!el) throw new Error('A47: 현재 단계의 [data-onboarding-target] 요소를 잡을 수 없습니다 (단계 전환 경합)');
  return el;
}

/** 단계 1회 수행 (채점기 발행 사용자 입력 액션 1회) — 종류별 계수 반환 */
async function performStep(page, step, marker) {
  const el = await getTargetHandle(page);
  const kind = step.kind;
  if (kind === 'click') {
    await el.click({ timeout: 5000 });
    return 'click';
  }
  if (kind === 'fill') {
    const editable = await el.evaluate(
      (n) => n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.isContentEditable
    );
    if (!editable) {
      throw new Error('A47: fill 단계의 [data-onboarding-target] 이 입력 가능 요소(input/textarea/contenteditable)가 아닙니다');
    }
    await el.fill(marker);
    return 'fill';
  }
  let m = /^press:(.+)$/.exec(kind);
  if (m) {
    await el.press(m[1].trim(), { timeout: 5000 });
    return 'press';
  }
  m = /^drag:(.+)$/.exec(kind);
  if (m) {
    const destSel = m[1].trim();
    const dest = page.locator(destSel).first();
    const db = await dest.boundingBox().catch(() => null);
    const sb = await el.boundingBox();
    if (!db) throw new Error(`A47: drag 목적지 셀렉터 "${destSel}" 가 엄격 가시 요소를 가리키지 않습니다 (계약 1)`);
    if (!sb) throw new Error('A47: drag 대상 [data-onboarding-target] 의 boundingBox 를 얻을 수 없습니다');
    await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
    await page.mouse.down();
    await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2, { steps: 12 });
    await page.mouse.up();
    return 'drag';
  }
  throw new Error(`A47: 알 수 없는 액션 종류 "${kind}" — 계약 1 의 click/fill/press:<Key>/drag:<셀렉터> 만 허용됩니다`);
}

/** 재기동 시 온보딩 비표시 단언 (로드 후 2.5초 관찰) */
async function assertNoOnboardingAfterRestart(page) {
  await sleep(2500);
  const n = await countVisibleStrict(page, '[data-onboarding]');
  expect(n, 'A47: 재기동 시 온보딩([data-onboarding])이 다시 표시되었습니다 — fresh 첫 실행 전용 계약').toBe(0);
}

test.describe('A47 온보딩', () => {
  test('A47: fresh 첫 실행 표시 → 지목 대상만 ≤8 액션으로 실제 타이핑 노트+실제 드래그 스티커 완성 → 사용자 입력 콘텐츠 저장·유지 (자동 생성 콘텐츠 = FAIL)', async () => {
    test.setTimeout(300 * 1000);
    requirePostit();
    requireElectronShell('A47');
    const userDir = freshUserDataDir('grader-a47-run-');
    const marker = 'A47-실입력-' + Date.now();
    let shell = null;
    try {
      shell = await launchElectronShell(userDir, { label: 'A47' });
      let page = await getAppWindow(shell, 'postit.html', 30000, 'A47');
      await dismissMigrateIfPresent(page, 'A47');
      await pollVisibleStrict(
        page,
        '[data-onboarding]',
        true,
        15000,
        'A47: fresh 첫 실행 15초 내 온보딩([data-onboarding])이 포스트잇 창에 표시되지 않았습니다 — ' +
          'Electron 셸 온보딩 레이어 미구현 (fail-closed)'
      );

      // ── 구동 루프: 지목 대상에만 채점기 발행 액션, 총 ≤8 ──
      const performed = [];
      let fills = 0;
      let drags = 0;
      let prev = null;
      const hardDeadline = Date.now() + 180000;
      for (;;) {
        const step = await waitStep(page, prev, 12000, performed.join(' → '));
        if (step.done) break;
        if (performed.length >= MAX_ACTIONS) {
          throw new Error(
            `A47: ${MAX_ACTIONS}회 액션을 모두 썼는데 온보딩이 끝나지 않고 ${performed.length + 1}번째 액션(${step.kind})을 ` +
              `요구합니다 — ≤8스텝 계약 위반 (수행: ${performed.join(' → ')})`
          );
        }
        const done = await performStep(page, step, marker);
        if (done === 'fill') fills += 1;
        if (done === 'drag') drags += 1;
        performed.push(done + (step.kind.startsWith('drag:') ? '(' + step.kind + ')' : ''));
        prev = step;
        if (Date.now() > hardDeadline) {
          throw new Error('A47: 온보딩 구동이 180초를 초과했습니다 (수행: ' + performed.join(' → ') + ')');
        }
      }
      expect(
        fills >= 1,
        `A47: 온보딩에 타이핑(fill) 단계가 없었습니다 (수행: ${performed.join(' → ') || '없음'}) — "첫 포스트잇 실제 타이핑" 계약`
      ).toBe(true);
      expect(
        drags >= 1,
        `A47: 온보딩에 드래그(drag) 단계가 없었습니다 (수행: ${performed.join(' → ') || '없음'}) — "첫 스티커 실제 드래그 부착" 계약`
      ).toBe(true);

      // ── 콘텐츠 진위: 사용자 입력분만, 자동 생성 감지 시 FAIL ──
      await pollVisibleNoteText(
        page,
        marker,
        5000,
        `A47: 온보딩 종료 후 채점기가 타이핑한 마커("${marker}")를 포함한 노트가 표시되지 않습니다 — 실제 타이핑 콘텐츠 보존 실패`
      );
      const noteCount = await countVisibleNotes(page);
      expect(
        noteCount,
        `A47: 온보딩 종료 후 visible 노트가 ${noteCount}개입니다 — 채점기 입력 노트 1개만 있어야 합니다 (온보딩 자동 생성 콘텐츠 감지 = FAIL)`
      ).toBe(1);
      const stickerCount = await countVisibleStrict(page, '[data-sticker]');
      expect(
        stickerCount,
        `A47: 온보딩 종료 후 visible [data-sticker] 가 ${stickerCount}개입니다 — 드래그로 부착한 1개만 있어야 합니다 (자동 부착 = FAIL)`
      ).toBe(1);
      await pollPage(
        page,
        (marker) =>
          Object.keys(localStorage).some(
            (k) => /^postit-/.test(k) && !/corrupt/.test(k) && (localStorage.getItem(k) || '').includes(marker)
          ),
        marker,
        5000,
        'A47: 마커 노트가 5초 내 postit-* localStorage 키에 저장되지 않았습니다 (변경 즉시 저장 원칙)'
      );
      await pollPage(
        page,
        () =>
          Object.keys(localStorage).some(
            (k) =>
              /^postit-decor/.test(k) &&
              !/corrupt/.test(k) &&
              /"stickers"\s*:\s*\[\s*\{/.test(localStorage.getItem(k) || '')
          ),
        null,
        5000,
        'A47: 드래그로 부착한 스티커가 5초 내 postit-decor* 키의 stickers 배열에 저장되지 않았습니다'
      );
      assertNoDialogs(shell.state, 'A47');
      expect(
        shell.state.pageErrors,
        `A47: pageerror ${shell.state.pageErrors.length}건 (0건이어야 함): ${shell.state.pageErrors.join(' | ')}`
      ).toHaveLength(0);
      await closeElectronShell(shell);
      shell = null;

      // ── 재기동: 온보딩 재표시 없음 + 사용자 입력 콘텐츠 유지 ──
      shell = await launchElectronShell(userDir, { label: 'A47' });
      page = await getAppWindow(shell, 'postit.html', 30000, 'A47');
      await dismissMigrateIfPresent(page, 'A47');
      await assertNoOnboardingAfterRestart(page);
      await pollVisibleNoteText(
        page,
        marker,
        7000,
        `A47: 재기동 후 마커 노트("${marker}")가 유지되지 않았습니다 (사용자 입력 콘텐츠 저장·유지 계약)`
      );
      await pollPage(
        page,
        () => document.querySelectorAll('[data-sticker]').length >= 1,
        null,
        7000,
        'A47: 재기동 후 드래그로 부착한 스티커([data-sticker])가 유지되지 않았습니다'
      );
      const restartStickerCount = await countVisibleStrict(page, '[data-sticker]');
      expect(
        restartStickerCount,
        `A47: 재기동 후 visible [data-sticker] 가 ${restartStickerCount}개입니다 (부착한 1개만 유지되어야 함)`
      ).toBe(1);
      assertNoDialogs(shell.state, 'A47');
    } finally {
      await closeElectronShell(shell);
      await removeDirWithRetry(userDir);
    }
  });

  test('A47: 건너뛰기([data-onboarding-skip]) 후 앱 정상(자동 생성 콘텐츠 0·노트 추가 동작) + 설정의 [data-onboarding-replay] 로 재실행', async () => {
    test.setTimeout(180 * 1000);
    requirePostit();
    requireElectronShell('A47');
    const userDir = freshUserDataDir('grader-a47-skip-');
    let shell = null;
    try {
      shell = await launchElectronShell(userDir, { label: 'A47' });
      const page = await getAppWindow(shell, 'postit.html', 30000, 'A47');
      await dismissMigrateIfPresent(page, 'A47');
      await pollVisibleStrict(
        page,
        '[data-onboarding]',
        true,
        15000,
        'A47: fresh 첫 실행 15초 내 온보딩([data-onboarding])이 표시되지 않았습니다 — Electron 셸 온보딩 레이어 미구현 (fail-closed)'
      );
      await pollVisibleStrict(
        page,
        '[data-onboarding-skip]',
        true,
        5000,
        'A47: 온보딩 표시 중 건너뛰기 훅 [data-onboarding-skip] 이 보이지 않습니다 — 계약 4 (항상 건너뛸 수 있어야 함, fail-closed)'
      );
      await page.locator('[data-onboarding-skip]').first().click({ timeout: 5000 });
      await pollVisibleStrict(page, '[data-onboarding]', false, 5000, 'A47: 건너뛰기 클릭 후 5초 내 온보딩이 닫히지 않았습니다');

      // 자동 생성 콘텐츠 0 + 앱 정상
      const autoNotes = await countVisibleNotes(page);
      expect(autoNotes, `A47: 건너뛰기 후 visible 노트가 ${autoNotes}개입니다 (자동 생성 콘텐츠 0 이어야 함)`).toBe(0);
      const autoStickers = await countVisibleStrict(page, '[data-sticker]');
      expect(autoStickers, `A47: 건너뛰기 후 visible [data-sticker] 가 ${autoStickers}개입니다 (자동 생성 0 이어야 함)`).toBe(0);
      await addNote(page);
      await pollVisibleNoteCount(page, 1, 5000, 'A47 건너뛰기 후');

      // 설정에서 재실행 (rev.6 신설 훅 — fail-closed)
      const settingsBtn = page.locator('#settingsBtn');
      if ((await settingsBtn.count()) === 0) {
        throw new Error('A47: 설정 버튼(#settingsBtn)이 없습니다 — 동결 빌드 UI 후퇴 (재실행 진입점 부재)');
      }
      await settingsBtn.click({ timeout: 5000 });
      await pollVisibleStrict(
        page,
        '[data-onboarding-replay]',
        true,
        5000,
        'A47: 설정 패널에 온보딩 재실행 훅 [data-onboarding-replay] 이 보이지 않습니다 — rev.6 DOM 계약 미구현 (fail-closed)'
      );
      await page.locator('[data-onboarding-replay]').first().click({ timeout: 5000 });
      await pollVisibleStrict(
        page,
        '[data-onboarding]',
        true,
        5000,
        'A47: [data-onboarding-replay] 클릭 후 온보딩([data-onboarding])이 다시 표시되지 않았습니다 (설정 재실행 계약)'
      );
      assertNoDialogs(shell.state, 'A47');
      expect(
        shell.state.pageErrors,
        `A47: pageerror ${shell.state.pageErrors.length}건 (0건이어야 함): ${shell.state.pageErrors.join(' | ')}`
      ).toHaveLength(0);
    } finally {
      await closeElectronShell(shell);
      await removeDirWithRetry(userDir);
    }
  });
});
