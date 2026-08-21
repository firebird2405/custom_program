'use strict';
/**
 * A45 — Free 경계 · 무료 단독 출시판 (SCORECARD rev.9)
 *
 * ══ rev.9 개정 사유 (근거: protocol/EXPERT-REVIEW.md B4·B3 — 사용자 승인 #24·#25) ══
 *  - 제품에는 구매 채널이 0건이다: 가격 리터럴·구매 버튼·shell.openExternal 전부 없다.
 *    README·MARKET·배포판 동봉 안내문은 이미 "첫 출시는 무료 단독"으로 정해 두었다.
 *    그런데 rev.6~rev.8 의 A45 는 "잠금 UI 관찰 → 테스트 라이선스로 해제"를 계약으로
 *    못 박아, **살 수 없는 잠금**을 채점표가 강제하고 있었다(사용자에게 남는 건 원망뿐).
 *  - 그래서 A45 를 "무료 단독 출시판" 계약으로 뒤집는다:
 *      · 무료 하한을 확대한다 — 동결 빌드 실기능 전체 + 보드 무제한 + 예약 자동 백업.
 *      · 잠금 UI 는 **부재를 단언**한다 (A42 의 "분리 모드 부재" 단언과 동형).
 *      · 서명 검증 코드는 **보존**한다 (미래 Pro 재출시용) — 단 UI 노출은 금지.
 *  - Pro 상품 매니페스트(신규 스티커 ≥2팩·프리미엄 테마 ≥2종·색거리 ≥40) 검사는
 *    **A45-P 로 보류**한다. 현행 Pro 상품(이모지 20자·CSS 그라디언트 2줄)은 상품성이
 *    없어 그대로 팔면 안 된다 — Pro 재구성 발주에서 A45-P 로 복원한다.
 *
 * ══ rev.9 필수 계약 (REQUIRED CONTRACT — 본 주석이 A45 DOM·파일 계약의 정본) ══
 *
 * 0) 실행 컨텍스트: Electron 셸(_electron.launch, 개발 트리 electron/, PETIT_USERDATA=fresh
 *    tmpdir). 셸 미구축 시 "electron 셸 미구축" 한국어 FAIL (fail-closed).
 *    예약 자동 백업 검사는 PETIT_BACKUP_INTERVAL_MS 를 30일로 주고 기동한다 — 채점 중
 *    실제 예약 백업이 사용자 문서 폴더에 파일을 쓰지 않게 하기 위한 격리다(채점기는
 *    사용자 실데이터 영역에 어떤 파일도 남기지 않는다).
 *
 * 1) 무료 하한 (동결 기준 = 2026-08-18 postit.html 실측 UI + rev.9 확대분):
 *    라이선스가 없는 fresh 프로필에서 다음이 **전부** 동작해야 한다. 하나라도 잠기면 FAIL.
 *      - 노트 사진 첨부: [data-ctx-menu] [data-ctx-item]("사진"|"이미지") +
 *        input[type=file][data-note-image-input] (A26 계약 재단언)
 *      - 꾸미기 패널: #decorBtn 클릭으로 열림 (배경/스티커/사진 스티커/테이프/프레임 섹션)
 *      - 배경 프리셋: #dpBg button[data-bg] (cork/wood/linen/chalk) — 적용 시 .decor-bg.on.bg-<id>
 *      - 배경 업로드: #dpBgUpload + input[data-decor-bg-input] → .decor-bg.on 의
 *        background-image 에 data:image 반영 (IndexedDB 경유)
 *      - 스티커 3세트: #dpStSeason·#dpStMood·#dpStOffice 각 버튼 ≥12개, 클릭 → [data-sticker] 부착
 *      - 사진 스티커: #dpPhotoAdd + input[data-decor-photo-input] → [data-sticker].photo img(data:image)
 *      - 스킨 3종: 노트 활성/컨텍스트 메뉴의 [data-skin] + [data-skin-option] ≥3 (A27 계약 재단언)
 *      - 테이프/프레임: #dpTapeColor [data-tval]·#dpFrame [data-fval] 선택 동작(.sel 반영)
 *      - **(rev.9 확대) 보드 개수 무제한**: [data-add-board] 로 [data-board-tab] 이 2·3·4·5개까지
 *        실제로 늘어난다 (4개째 이상이 막히면 FAIL — 무료 후퇴 금지)
 *      - **(rev.9 확대) 예약 자동 백업 무료**: 설정(#settingsBtn)의 [data-backup-section]
 *        (배치 카테고리는 자유 — 채점기가 [data-spcat] 전 카테고리를 순회해 찾는다)에서
 *        [data-backup-auto] 가 disabled 아님·[data-pro-lock] 아래 아님 → 켜면 6초 내
 *        userData\backup-config.json 의 auto 가 true → 같은 userData 재기동 후에도 켜진 상태 유지
 *    비잠금 판정: 위 무료 컨트롤은 disabled 가 아니고 조상/자신에 [data-pro-lock] 이 없어야 한다.
 *
 * 2) 잠금 비노출 단언 (rev.8 A42 "분리 부재" 단언과 동형 — 배반 차단용 부재 증명):
 *    정상 조작 전수(기동 → 보드 5개까지 생성 → 꾸미기 패널 전 섹션 스크롤 → 설정 전 카테고리
 *    개방 → 백업 섹션 조작)의 **각 단계**에서, 그리고 마지막 단계 뒤 **3초 지연 주입 감시**에서:
 *      - visible [data-pro-lock] 0개
 *      - visible [data-license-import] 0개 (라이선스 적용 UI 는 이번 판에서 노출 금지)
 *      - 가격·구매 유도 문구 0건 — 화면에 실제로 렌더된 텍스트에 다음이 없어야 한다:
 *        9,900 / 9900 / ₩ / 구매 / 결제 / 유료 / 업그레이드 / 프리미엄 / 잠금 해제 / ms-windows-store
 *      - 설정 검색([data-settings-search])에 "프리미엄"·"구매"를 입력해도 그 문구를 담은
 *        visible [data-settings-hit] 행이 0개 (검색 사전에 남은 Pro 항목 = 노출 경로)
 *
 * 3) 라이선스 검증 코드 보존 (미래 Pro 재출시 — 정적 검사, UI 노출은 금지):
 *      - postit.html 에 공개키 JWK(kty:"EC", crv:"P-256", x·y base64url ≥40자)와
 *        WebCrypto 경로(crypto.subtle.importKey + crypto.subtle.verify + ECDSA + SHA-256) 존재
 *      - 개인키·서명 생성 코드 0건: postit.html·calendar.html·electron/*.js 에
 *        "PRIVATE KEY"·subtle.sign(·createSign(·generateKey( · JWK 개인키 필드 d 없음
 *      - 커밋된 테스트 픽스처 electron/test-license/petit-test.license 보존(1바이트~64KB)
 *      - **적용 경로가 UI 에서 접근 불가여도 FAIL 이 아니다** (오히려 계약 2 가 노출을 금지한다)
 *
 * 4) 보류: Pro 상품 매니페스트(assets/pro/pro-manifest.json) 신규성 검사 → **A45-P**
 *    (Pro 재출시 발주에서 복원. 이번 판에서는 파일 존재 여부를 판정하지 않는다.)
 *
 * 훅·픽스처 미구현 = 즉시 한국어 FAIL (fail-closed, skip-pass 금지).
 * 공통 규정: dialog 0건·pageerror 0건.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
  APP_ROOT,
  requirePostit,
  removeDirWithRetry,
  sleep,
  POSTIT_SEL,
  assertNoDialogs,
  requireHook,
  addNote,
  pollVisibleNoteCount,
  pollPage,
  openContextMenuOn,
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

const LICENSE_FIXTURE_PATH = path.join(ELECTRON_DIR, 'test-license', 'petit-test.license');
const POSTIT_SRC = path.join(APP_ROOT, 'postit.html');
const CALENDAR_SRC = path.join(APP_ROOT, 'calendar.html');

/* 무료 보드 하한 — rev.9 는 "무제한"이므로 4·5번째까지 실제 생성을 관찰한다 */
const BOARD_TARGET = 5;

/* 채점 중 실제 예약 백업이 사용자 문서 폴더에 파일을 쓰지 않도록 주기를 30일로 밀어 둔다
 * (backup.js 의 공식 테스트 훅 PETIT_BACKUP_INTERVAL_MS — 값이 클수록 실행되지 않는다). */
const NO_AUTORUN_ENV = { PETIT_BACKUP_INTERVAL_MS: String(30 * 24 * 60 * 60 * 1000) };

/* 가격·구매 유도 문구 (무료 단독 출시판에서 화면에 렌더되면 FAIL) */
const SALES_LITERALS = [
  '9,900',
  '9900',
  '₩',
  '구매',
  '결제',
  '유료',
  '업그레이드',
  '프리미엄',
  '잠금 해제',
  '잠금해제',
  'ms-windows-store',
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

/** 무료 컨트롤 비잠금 단언: disabled 금지 + 자신/조상 [data-pro-lock] 금지 */
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
      `A45: 무료 하한 위반 — ${label}(${selector}) 이(가) ` +
        (bad === null
          ? '존재하지 않습니다'
          : bad === 'pro-lock'
            ? '[data-pro-lock] 잠금 아래에 있습니다'
            : 'disabled 상태입니다') +
        ' (무료 단독 출시판: 동결 빌드 기능 + 보드 무제한 + 예약 자동 백업은 라이선스 없이 전부 동작해야 함 — B rev.9 무료 후퇴 금지)'
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
  await btn.click({ timeout: 5000 }).catch(() => {
    /* disabled 구현도 "막힘"이다 — 판정은 아래 탭 수로 한다 */
  });
  await pollPage(
    page,
    (want2) => document.querySelectorAll('[data-board-tab]').length === want2,
    want,
    5000,
    `${label}: [data-add-board] 클릭 후 [data-board-tab] 이 ${want}개가 되지 않았습니다 — ` +
      (want >= 4
        ? 'rev.9 무료 단독 출시판은 **보드 개수 무제한**입니다 (FREE_BOARD_MAX 게이트 해제 필요 — 감사 권고 #25)'
        : '보드 생성 자체가 동작하지 않습니다')
  );
}

/** 설정 모달 열기 (#settingsBtn → #settingsPanel visible) */
async function openSettingsPanel(page, label) {
  const btn = page.locator('#settingsBtn');
  if ((await btn.count()) === 0) {
    throw new Error(`${label}: 설정 버튼(#settingsBtn)이 없습니다 — 동결 빌드 UI 후퇴 (fail-closed)`);
  }
  if ((await countVisibleStrict(page, '#settingsPanel')) === 0) {
    await btn.click({ timeout: 5000 });
  }
  await pollVisibleStrict(page, '#settingsPanel', true, 5000, `${label}: 설정 패널(#settingsPanel)이 열리지 않았습니다`);
}

/** 설정 모달 닫기 (실패해도 진행 — 판정 대상 아님) */
async function closeSettingsPanel(page) {
  await page.locator('#spClose').first().click({ timeout: 3000 }).catch(() => {});
  await sleep(250);
}

/** 꾸미기 패널 열기 (#decorBtn → #dpStSeason visible) */
async function openDecorPanel(page, label) {
  const decorBtn = page.locator('#decorBtn');
  if ((await decorBtn.count()) === 0) {
    throw new Error(`${label}: 꾸미기 버튼(#decorBtn)이 없습니다 — 동결 빌드 기능(꾸미기) 후퇴 (fail-closed)`);
  }
  if ((await countVisibleStrict(page, '#dpStSeason')) === 0) {
    await decorBtn.click({ timeout: 5000 });
  }
  await pollVisibleStrict(page, '#dpStSeason', true, 5000, `${label}: 꾸미기 패널이 열리지 않았습니다 (#dpStSeason 비가시)`);
}

/** 지정 컨테이너와 그 안의 모든 스크롤 가능한 자손을 끝까지 훑는다 (지연 렌더 유도) */
async function scrollThrough(page, selector) {
  for (let step = 1; step <= 4; step++) {
    await page.evaluate(
      ({ sel, frac }) => {
        const root = document.querySelector(sel);
        if (!root) return;
        const targets = [root, ...root.querySelectorAll('*')].filter((el) => el.scrollHeight - el.clientHeight > 4);
        for (const el of targets) el.scrollTop = (el.scrollHeight - el.clientHeight) * frac;
      },
      { sel: selector, frac: step / 4 }
    );
    await sleep(200);
  }
}

/** 실제로 화면에 렌더된 텍스트만 수집 (display:none·visibility:hidden·유효 opacity ≤0.05 제외) */
async function visibleText(page) {
  return page.evaluate(() => {
    const effOpacity = (el) => {
      let o = 1;
      for (let c = el; c && c.nodeType === 1; c = c.parentElement) o *= parseFloat(getComputedStyle(c).opacity) || 0;
      return o;
    };
    const shown = (el) => {
      const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && effOpacity(el) > 0.05;
    };
    const out = [];
    const walk = (el) => {
      if (!shown(el)) return;
      for (const n of el.childNodes) {
        if (n.nodeType === 3) {
          const t = (n.nodeValue || '').trim();
          if (t) out.push(t);
        } else if (n.nodeType === 1) {
          walk(n);
        }
      }
    };
    if (document.body) walk(document.body);
    return out.join('\n');
  });
}

function salesHits(text) {
  const t = String(text || '');
  return SALES_LITERALS.filter((lit) => t.includes(lit));
}

/** 한 단계의 노출 상태 스냅샷 (잠금·라이선스 UI·판매 문구) */
async function snapshotExposure(page, stageName) {
  const locks = await countVisibleStrict(page, '[data-pro-lock]').catch(() => 0);
  const imports = await countVisibleStrict(page, '[data-license-import]').catch(() => 0);
  const hits = salesHits(await visibleText(page).catch(() => ''));
  return { stage: stageName, locks, imports, hits };
}

/** userData\backup-config.json 판독 (부재·손상 = null) */
function readBackupConfig(userDir) {
  const p = path.join(userDir, 'backup-config.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}

/** backup-config.json 의 auto 가 want 가 될 때까지 폴링 */
async function pollBackupAuto(userDir, want, timeoutMs, failMsg) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const cfg = readBackupConfig(userDir);
    if (cfg && cfg.auto === want) return cfg;
    if (Date.now() > deadline) {
      const cfg2 = readBackupConfig(userDir);
      throw new Error(failMsg + ` (현재 backup-config.json: ${cfg2 ? JSON.stringify(cfg2) : '파일 없음'})`);
    }
    await sleep(150);
  }
}

/** 백업 섹션 도달 (설정 열기 → 카테고리 순회 → [data-backup-section] visible)
 *  백업 섹션이 어느 카테고리에 배치되든(현행: 💾 데이터) 찾아낸다 — 배치는 계약 대상이 아니다. */
async function openBackupSection(page, label) {
  await openSettingsPanel(page, label);
  await requireHook(page, '[data-backup-section]', `${label} 백업 섹션`);
  if ((await countVisibleStrict(page, '[data-backup-section]')) === 0) {
    const cats = await page.locator('#spNav [data-spcat]').evaluateAll((els) => els.map((el) => el.getAttribute('data-spcat')));
    for (const cat of cats) {
      await page.locator(`#spNav [data-spcat="${cat}"]`).first().click({ timeout: 5000 }).catch(() => {});
      await sleep(300);
      if ((await countVisibleStrict(page, '[data-backup-section]')) > 0) break;
    }
  }
  await pollVisibleStrict(
    page,
    '[data-backup-section]',
    true,
    5000,
    `${label}: 설정 전 카테고리를 순회해도 백업 섹션([data-backup-section])이 보이지 않습니다 — 셸 백업 UI 주입 실패 (fail-closed)`
  );
}

test.describe('A45 무료 단독 출시판 경계', () => {
  /* ════ 1) 무료 하한 안티-테스트 — 동결 실기능 전체 + 보드 무제한 ════ */
  test('A45: 무료 하한 — 라이선스 없이 사진 첨부·배경 업로드·사진 스티커·스티커 3세트·스킨 3종·꾸미기 전부 + 보드 5개까지 동작 (하나라도 잠기면 FAIL)', async () => {
    test.setTimeout(240 * 1000);
    requirePostit();
    requireElectronShell('A45');
    const userDir = freshUserDataDir('grader-a45-free-');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grader-a45-fx-'));
    let shell = null;
    try {
      shell = await launchElectronShell(userDir, { label: 'A45', env: NO_AUTORUN_ENV });
      const page = await getAppWindow(shell, 'postit.html', 30000, 'A45');
      await dismissMigrateIfPresent(page, 'A45');
      await dismissOnboardingIfPresent(page, 'A45');

      // ── 보드 무제한 (rev.9 확대: 4·5번째까지 실제 생성) ──
      await requireHook(page, '[data-board-switcher]', 'A45 보드 전환기');
      await assertNotProLocked(page, '[data-add-board]', '새 보드 버튼');
      for (let want = 2; want <= BOARD_TARGET; want++) {
        await addBoardExpectTabs(page, want, `A45 보드 ${want}`);
        await assertNotProLocked(page, '[data-add-board]', `보드 ${want}개 상태의 새 보드 버튼`);
      }

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
        'A45: 라이선스 없는 상태에서 노트 사진 첨부가 동작하지 않았습니다 (data:image img 미표시 — 무료 하한 위반)'
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
        'A45: 줄노트 스킨 적용 후 노트 background-image 가 변하지 않았습니다 (무료 하한 위반)'
      );
      await page.keyboard.press('Escape').catch(() => {});

      // ── 꾸미기 패널 열기 (동결 빌드 UI: #decorBtn) ──
      await openDecorPanel(page, 'A45');

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

  /* ════ 2) 무료 하한 확대 — 예약 자동 백업 (감사 권고 #24) ════ */
  test('A45: 무료 하한 — 예약 자동 백업이 라이선스 없이 켜지고(backup-config.json auto:true) 재기동 후에도 유지된다', async () => {
    test.setTimeout(240 * 1000);
    requirePostit();
    requireElectronShell('A45');
    const userDir = freshUserDataDir('grader-a45-auto-');
    let shell = null;
    try {
      shell = await launchElectronShell(userDir, { label: 'A45 자동백업', env: NO_AUTORUN_ENV });
      let page = await getAppWindow(shell, 'postit.html', 30000, 'A45 자동백업');
      await dismissMigrateIfPresent(page, 'A45 자동백업');
      await dismissOnboardingIfPresent(page, 'A45 자동백업');

      await openBackupSection(page, 'A45 자동백업');

      // 비잠금 단언 — 토글 자체와 백업 섹션 전체
      await assertNotProLocked(page, '[data-backup-auto]', '예약 자동 백업 토글');
      const secLocks = await countVisibleStrict(page, '[data-backup-section] [data-pro-lock]');
      expect(
        secLocks,
        `A45: 백업 섹션에 visible [data-pro-lock] 이 ${secLocks}개입니다 — ` +
          '무료 단독 출시판에서 예약 자동 백업은 무료 기능입니다 (감사 권고 #24: 무료 사용자에게 자동 백업이 없는 것이 현재 최대 데이터 유실 리스크)'
      ).toBe(0);

      // 켜기 → main 이 실제로 수락했는지 userData\backup-config.json 로 확인
      const autoBox = page.locator('[data-backup-auto]').first();
      await autoBox.click({ timeout: 5000 }).catch((e) => {
        throw new Error(
          'A45: [data-backup-auto] 를 클릭할 수 없습니다 (disabled/가림 여부 확인) — 예약 자동 백업 무료화 미구현: ' + e.message
        );
      });
      await pollBackupAuto(
        userDir,
        true,
        6000,
        'A45: [data-backup-auto] 를 켠 뒤 6초 내 userData\\backup-config.json 의 auto 가 true 가 되지 않았습니다 — ' +
          "main 의 Pro 게이트(petit:backup:set-auto → isProUnlocked)가 여전히 살아 있습니다 (감사 권고 #24: Free 에게 개방)"
      );
      await pollPage(
        page,
        () => {
          const el = document.querySelector('[data-backup-auto]');
          return !!el && el.checked === true && el.disabled !== true;
        },
        null,
        5000,
        'A45: 켠 뒤에도 [data-backup-auto] 가 checked/enabled 로 관찰되지 않습니다 (UI 가 잠금 상태로 되돌아갔는지 확인)'
      );

      assertNoDialogs(shell.state, 'A45 자동백업');
      expect(
        shell.state.pageErrors,
        `A45: pageerror ${shell.state.pageErrors.length}건 (0건이어야 함): ${shell.state.pageErrors.join(' | ')}`
      ).toHaveLength(0);
      await closeElectronShell(shell);
      shell = null;

      // ── 재기동 유지 ──
      shell = await launchElectronShell(userDir, { label: 'A45 자동백업 재기동', env: NO_AUTORUN_ENV });
      page = await getAppWindow(shell, 'postit.html', 30000, 'A45 자동백업 재기동');
      await dismissMigrateIfPresent(page, 'A45 자동백업 재기동');
      await dismissOnboardingIfPresent(page, 'A45 자동백업 재기동');
      await openBackupSection(page, 'A45 자동백업 재기동');
      await pollPage(
        page,
        () => {
          const el = document.querySelector('[data-backup-auto]');
          return !!el && el.checked === true && el.disabled !== true;
        },
        null,
        7000,
        'A45: 재기동 후 [data-backup-auto] 가 켜진 상태(checked·enabled)로 복원되지 않았습니다 — 예약 자동 백업 설정 유지 실패'
      );
      const cfg = readBackupConfig(userDir);
      expect(
        cfg && cfg.auto === true,
        `A45: 재기동 후 backup-config.json 의 auto 가 true 가 아닙니다 (${cfg ? JSON.stringify(cfg) : '파일 없음'})`
      ).toBe(true);
      const secLocks2 = await countVisibleStrict(page, '[data-backup-section] [data-pro-lock]');
      expect(secLocks2, `A45: 재기동 후 백업 섹션에 visible [data-pro-lock] ${secLocks2}개 (0개여야 함)`).toBe(0);

      assertNoDialogs(shell.state, 'A45 자동백업 재기동');
      expect(
        shell.state.pageErrors,
        `A45: 재기동 pageerror ${shell.state.pageErrors.length}건 (0건이어야 함): ${shell.state.pageErrors.join(' | ')}`
      ).toHaveLength(0);
    } finally {
      await closeElectronShell(shell);
      await removeDirWithRetry(userDir);
    }
  });

  /* ════ 3) 잠금 비노출 단언 — 정상 조작 전수 + 지연 주입 감시 ════ */
  test('A45: 잠금 비노출 — 정상 조작 전수·3초 지연 감시에서 visible [data-pro-lock]·[data-license-import] 0개, 가격·구매 유도 문구 0건', async () => {
    test.setTimeout(300 * 1000);
    requirePostit();
    requireElectronShell('A45');
    const userDir = freshUserDataDir('grader-a45-nolock-');
    let shell = null;
    try {
      shell = await launchElectronShell(userDir, { label: 'A45 비노출', env: NO_AUTORUN_ENV });
      const page = await getAppWindow(shell, 'postit.html', 30000, 'A45 비노출');
      await dismissMigrateIfPresent(page, 'A45 비노출');
      await dismissOnboardingIfPresent(page, 'A45 비노출');

      const snaps = [];
      snaps.push(await snapshotExposure(page, '기동 직후'));

      // ── 보드 5개까지 생성 시도 (막히더라도 계속 — 여기서는 "노출" 만 판정한다) ──
      await requireHook(page, '[data-add-board]', 'A45 비노출');
      for (let i = 2; i <= BOARD_TARGET; i++) {
        await page.locator('[data-add-board]').first().click({ timeout: 5000 }).catch(() => {});
        await sleep(600);
        const tabs = await page.locator('[data-board-tab]').count();
        snaps.push(await snapshotExposure(page, `보드 ${i}번째 생성 시도 (현재 탭 ${tabs}개)`));
      }

      // ── 꾸미기 패널 전 섹션 스크롤 ──
      await openDecorPanel(page, 'A45 비노출');
      await scrollThrough(page, '#decorPanel');
      snaps.push(await snapshotExposure(page, '꾸미기 패널 전 섹션 스크롤'));
      await page.locator('#dpClose').first().click({ timeout: 3000 }).catch(() => {});
      await sleep(250);

      // ── 설정 전 카테고리 개방 ──
      await openSettingsPanel(page, 'A45 비노출');
      const cats = await page.locator('#spNav [data-spcat]').evaluateAll((els) =>
        els.map((el) => ({ cat: el.getAttribute('data-spcat'), label: (el.textContent || '').trim() }))
      );
      if (cats.length === 0) {
        throw new Error('A45 비노출: 설정 카테고리 탭(#spNav [data-spcat])이 없습니다 — 동결 빌드 UI 후퇴 (fail-closed)');
      }
      for (const c of cats) {
        await page.locator(`#spNav [data-spcat="${c.cat}"]`).first().click({ timeout: 5000 }).catch(() => {});
        await sleep(300);
        await scrollThrough(page, '#settingsPanel');
        snaps.push(await snapshotExposure(page, `설정 카테고리 "${c.label || c.cat}" 개방`));
      }

      // ── 백업 섹션 조작 (첫 카테고리로 복귀 후 토글 시도) ──
      await page.locator(`#spNav [data-spcat="${cats[0].cat}"]`).first().click({ timeout: 5000 }).catch(() => {});
      await sleep(300);
      if ((await page.locator('[data-backup-auto]').count()) > 0) {
        await page.locator('[data-backup-auto]').first().click({ timeout: 5000 }).catch(() => {});
        await sleep(700);
      }
      snaps.push(await snapshotExposure(page, '백업 섹션 조작(예약 자동 백업 토글)'));

      // ── 설정 검색: Pro 항목이 검색 결과로 노출되는가 ──
      const searchExposure = [];
      if ((await page.locator('[data-settings-search]').count()) > 0) {
        for (const q of ['프리미엄', '구매']) {
          const input = page.locator('[data-settings-search]').first();
          await input.fill(q).catch(() => {});
          await sleep(700);
          const hitTexts = await page.locator('[data-settings-hit]').evaluateAll((els) => {
            const effOpacity = (el) => {
              let o = 1;
              for (let c = el; c && c.nodeType === 1; c = c.parentElement) o *= parseFloat(getComputedStyle(c).opacity) || 0;
              return o;
            };
            return els
              .filter((el) => {
                const r = el.getBoundingClientRect();
                const s = getComputedStyle(el);
                return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && effOpacity(el) > 0.05;
              })
              .map((el) => (el.textContent || '').trim());
          });
          const bad = hitTexts.filter((t) => salesHits(t).length > 0);
          if (bad.length > 0) searchExposure.push(`"${q}" → ${bad.length}행: ${bad.slice(0, 3).join(' / ')}`);
          await input.fill('').catch(() => {});
          await sleep(300);
        }
      }
      await closeSettingsPanel(page);

      // ── 지연 주입 감시 (3초) — 뒤늦게 뜨는 잠금 배너·프로모 팝업 차단 ──
      const watchDeadline = Date.now() + 3000;
      let maxLocks = 0;
      let maxImports = 0;
      const lateHits = new Set();
      for (;;) {
        const s = await snapshotExposure(page, '지연 주입 감시(3초)');
        maxLocks = Math.max(maxLocks, s.locks);
        maxImports = Math.max(maxImports, s.imports);
        for (const h of s.hits) lateHits.add(h);
        if (Date.now() > watchDeadline) break;
        await sleep(250);
      }
      snaps.push({ stage: '지연 주입 감시(3초)', locks: maxLocks, imports: maxImports, hits: Array.from(lateHits) });

      // ── 판정 (한 번에 전부 보고) ──
      const lockBad = snaps.filter((s) => s.locks > 0);
      const importBad = snaps.filter((s) => s.imports > 0);
      const salesBad = snaps.filter((s) => s.hits.length > 0);
      const problems = [];
      if (lockBad.length > 0) {
        problems.push(
          'visible [data-pro-lock] 노출 — ' +
            lockBad.map((s) => `${s.stage}: ${s.locks}개`).join(' / ') +
            ' (무료 단독 출시판 계약: 잠금 UI 는 어떤 정상 조작에서도 보이면 안 됩니다 — 감사 권고 #25, proBanner·dpProSec·셸 백업 잠금 마크를 전부 끌 것)'
        );
      }
      if (importBad.length > 0) {
        problems.push(
          'visible [data-license-import] 노출 — ' +
            importBad.map((s) => `${s.stage}: ${s.imports}개`).join(' / ') +
            ' (라이선스 적용 UI 는 이번 판에서 노출 금지 — 코드는 보존하되 화면에는 내보내지 않습니다)'
        );
      }
      if (salesBad.length > 0) {
        problems.push(
          '가격·구매 유도 문구 노출 — ' +
            salesBad.map((s) => `${s.stage}: [${s.hits.join(', ')}]`).join(' / ') +
            ' (구매 채널이 0건인 판에서 유료 문구는 원망만 남깁니다 — 문구 제거 필요)'
        );
      }
      if (searchExposure.length > 0) {
        problems.push(
          '설정 검색에 Pro 항목 잔존 — ' +
            searchExposure.join(' / ') +
            ' (검색 사전에서 Pro 항목·유료 동의어를 제거할 것 — 검색은 숨긴 잠금 UI 로 가는 뒷문입니다)'
        );
      }
      expect(problems.length === 0, 'A45: 잠금 비노출 계약 위반 —\n  · ' + problems.join('\n  · ')).toBe(true);

      assertNoDialogs(shell.state, 'A45 비노출');
      expect(
        shell.state.pageErrors,
        `A45: pageerror ${shell.state.pageErrors.length}건 (0건이어야 함): ${shell.state.pageErrors.join(' | ')}`
      ).toHaveLength(0);
    } finally {
      await closeElectronShell(shell);
      await removeDirWithRetry(userDir);
    }
  });

  /* ════ 4) 라이선스 검증 코드 보존 (정적) — 미래 Pro 재출시용, UI 노출은 금지 ════ */
  test('A45: 라이선스 검증 코드 보존 — 공개키(EC P-256)·WebCrypto verify 정적 존재, 개인키·서명 생성 코드 0건, 테스트 픽스처 보존', async () => {
    test.setTimeout(60 * 1000);
    requirePostit();

    const src = fs.readFileSync(POSTIT_SRC, 'utf8');

    // ── 공개키 JWK (kty EC / crv P-256 / x·y base64url ≥40자) ──
    const hasKty = /\bkty\s*:\s*['"]EC['"]/.test(src);
    const hasCrv = /\bcrv\s*:\s*['"]P-256['"]/.test(src);
    const hasX = /\bx\s*:\s*['"][A-Za-z0-9_-]{40,}['"]/.test(src);
    const hasY = /\by\s*:\s*['"][A-Za-z0-9_-]{40,}['"]/.test(src);
    expect(
      hasKty && hasCrv && hasX && hasY,
      'A45: postit.html 에서 서명 검증용 공개키 JWK(kty:"EC", crv:"P-256", x·y)를 찾지 못했습니다 — ' +
        `관찰: kty=${hasKty} crv=${hasCrv} x=${hasX} y=${hasY}. ` +
        '무료 단독 출시판에서도 **검증 경로는 보존**해야 합니다 (미래 Pro 재출시 시 A45-P 로 복원 — UI 만 끄고 코드는 남길 것)'
    ).toBe(true);

    // ── WebCrypto 오프라인 검증 경로 ──
    const hasImport = /crypto\.subtle\.importKey/.test(src);
    const hasVerify = /crypto\.subtle\.verify/.test(src);
    const hasEcdsa = /['"]ECDSA['"]/.test(src);
    const hasSha = /['"]SHA-256['"]/.test(src);
    expect(
      hasImport && hasVerify && hasEcdsa && hasSha,
      'A45: postit.html 에서 WebCrypto 서명 검증 경로를 찾지 못했습니다 — ' +
        `관찰: importKey=${hasImport} verify=${hasVerify} ECDSA=${hasEcdsa} SHA-256=${hasSha}. ` +
        '라이선스 검증 함수는 삭제하지 말고 보존할 것 (UI 노출만 금지)'
    ).toBe(true);

    // ── 개인키·서명 생성 코드 0건 (앱·셸 어디에도) ──
    const scanFiles = [POSTIT_SRC, CALENDAR_SRC];
    for (const f of fs.readdirSync(ELECTRON_DIR)) {
      if (f.toLowerCase().endsWith('.js')) scanFiles.push(path.join(ELECTRON_DIR, f));
    }
    const forbidden = [
      { re: /-----BEGIN[A-Z ]*PRIVATE KEY/, why: 'PEM 개인키' },
      { re: /subtle\.sign\s*\(/, why: 'WebCrypto 서명 생성(subtle.sign)' },
      { re: /createSign\s*\(/, why: 'Node 서명 생성(createSign)' },
      { re: /subtle\.generateKey\s*\(/, why: '키쌍 생성(generateKey)' },
      { re: /\bd\s*:\s*['"][A-Za-z0-9_-]{40,}['"]/, why: 'JWK 개인키 필드 d' },
    ];
    const leaks = [];
    for (const file of scanFiles) {
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      for (const rule of forbidden) {
        if (rule.re.test(text)) leaks.push(`${path.relative(APP_ROOT, file)} — ${rule.why}`);
      }
    }
    expect(
      leaks.length === 0,
      'A45: 개인키·서명 생성 코드가 앱/셸에 포함되어 있습니다 (배포물 포함 금지 — 라이선스 위조 가능): ' + leaks.join(' | ')
    ).toBe(true);

    // ── 테스트 라이선스 픽스처 보존 (미래 A45-P 재개용 — 삭제 금지) ──
    if (!fs.existsSync(LICENSE_FIXTURE_PATH)) {
      throw new Error(
        'A45: 커밋된 테스트 라이선스 픽스처 electron/test-license/petit-test.license 가 없습니다 — ' +
          'rev.9 는 라이선스 UI 를 끄지만 픽스처·검증 코드는 **보존** 대상입니다 (Pro 재출시 시 A45-P 로 즉시 복원)'
      );
    }
    const licBuf = fs.readFileSync(LICENSE_FIXTURE_PATH);
    expect(
      licBuf.length > 0 && licBuf.length <= 64 * 1024,
      `A45: 라이선스 픽스처 크기 ${licBuf.length}바이트 (1바이트~64KB 계약)`
    ).toBe(true);
  });
});
