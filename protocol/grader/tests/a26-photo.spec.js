'use strict';
/**
 * A26 — 사진 포스트잇 (rev.5 설계서 §1 A26)
 * "노트 메뉴의 이미지 첨부(filechooser)로 큰 이미지(≥1200×900) 선택 → 노트 내부 img 의 src 가
 *  `data:image/` 로 시작하고 naturalWidth>0, 저장된 데이터 URI 길이 ≤ 300×1024 바이트(다운스케일),
 *  재기동 후 동일 표시. 비이미지 파일 선택 시 img 미생성 + 비모달 안내([data-toast]) 표시 +
 *  dialog·pageerror 0건"
 *
 * ── rev.5 필수 DOM 계약 (설계서 §2 A26 — 그대로 기록) ──
 * 첨부 진입점은 노트 컨텍스트 메뉴 항목(라벨 "사진" 또는 "이미지" 포함, [data-ctx-item]) +
 * 숨김 input[type=file][data-note-image-input](accept="image/*"). 렌더는 createElement('img')
 * 후 img.src = 검증된 data URI 대입만 허용(§4 B-1 예외). 다운스케일: 최장변 ≤ 640px 권장 —
 * 판정은 저장 길이 상한만.
 * 픽스처는 채점기 저장소에 넣지 않고 런타임 생성(canvas 1600×1200 → JPEG → os.tmpdir()).
 * 신규 훅은 폴백 셀렉터 없음: data-속성 부재 = 즉시 FAIL (fail-closed).
 * 굿하트 차단(설계서 §6): 이미지 원본을 무제한 저장(localStorage 포화) → 데이터 URI ≤ 300KB 상한.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
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
  openContextMenuOn,
} = require('../lib/helpers');

const MAX_URI_LEN = 300 * 1024;

/** 노트 컨텍스트 메뉴를 열고 "사진"/"이미지" 항목을 filechooser 와 함께 클릭 (fail-closed) */
async function attachViaMenu(page, noteLoc, filePath, label) {
  await openContextMenuOn(page, noteLoc);
  await sleep(200);
  const menuCount = await page.locator('[data-ctx-menu]').count();
  if (menuCount === 0) {
    throw new Error(
      `${label}: 필수 훅 [data-ctx-menu] 이(가) 없습니다 — 이미지 첨부 진입점은 노트 컨텍스트 메뉴입니다 (rev.5 DOM 계약, fail-closed)`
    );
  }
  const item = page
    .locator('[data-ctx-menu] [data-ctx-item]')
    .filter({ hasText: /사진|이미지/ })
    .first();
  if ((await item.count()) === 0) {
    throw new Error(
      `${label}: 컨텍스트 메뉴에 라벨 "사진" 또는 "이미지" 를 포함한 [data-ctx-item] 항목이 없습니다 (rev.5 DOM 계약, fail-closed)`
    );
  }
  const fileInput = page.locator('input[type="file"][data-note-image-input]');
  if ((await fileInput.count()) === 0) {
    throw new Error(
      `${label}: 필수 훅 input[type=file][data-note-image-input] 이(가) 없습니다 — rev.5 DOM 계약 미구현 (fail-closed)`
    );
  }
  const accept = (await fileInput.first().getAttribute('accept')) || '';
  if (!accept.includes('image')) {
    throw new Error(`${label}: [data-note-image-input] 의 accept 속성("${accept}")에 "image" 가 없습니다 (accept="image/*" 계약)`);
  }
  let chooser = null;
  try {
    [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), item.click()]);
  } catch (e) {
    throw new Error(
      `${label}: 이미지 첨부 항목 클릭 후 파일 선택기(filechooser)가 열리지 않았습니다 — 숨김 input[type=file][data-note-image-input] 필요: ` +
        e.message
    );
  }
  await chooser.setFiles(filePath);
}

async function noteImgInfo(page, idx) {
  return page.evaluate(
    ({ N, idx }) => {
      const note = document.querySelectorAll(N)[idx];
      if (!note) return { err: `노트 ${idx + 1}번을 찾을 수 없습니다` };
      const imgs = Array.from(note.querySelectorAll('img'));
      const img = imgs[0] || null;
      return {
        count: imgs.length,
        src: img ? img.src : null,
        srcLen: img ? img.src.length : 0,
        naturalWidth: img ? img.naturalWidth : 0,
        renderWidth: img ? img.getBoundingClientRect().width : 0,
      };
    },
    { N: POSTIT_SEL.NOTE, idx }
  );
}

test.describe('A26 사진 포스트잇', () => {
  test('A26: 큰 이미지 첨부 → data:image/ 렌더·저장 ≤300KB·재기동 유지, 비이미지 → img 미생성+토스트 안내', async () => {
    requirePostit();
    const dir = freshProfileDir();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grader-a26-'));
    const states = [];
    let app = null;
    try {
      // ── 기동 1 ──
      app = await launchApp(dir, POSTIT_PATH);
      states.push(app.state);
      let page = app.page;
      await addNote(page);
      await pollVisibleNoteCount(page, 1, 5000, 'A26');

      // 픽스처 런타임 생성: canvas 1600×1200 그라데이션 JPEG (≥1200×900 요건 충족)
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
        ctx.fillText('A26', 120, 220);
        return c.toDataURL('image/jpeg', 0.95);
      });
      const imgPath = path.join(tmpDir, 'a26-big.jpg');
      fs.writeFileSync(imgPath, Buffer.from(dataUrl.split(',')[1], 'base64'));

      // 첨부 → 노트 내부 img: data:image/ + naturalWidth > 0 + 렌더 폭 > 0
      await attachViaMenu(page, page.locator(POSTIT_SEL.NOTE).first(), imgPath, 'A26');
      await pollPage(
        page,
        (N) => {
          const note = document.querySelector(N);
          if (!note) return false;
          const img = note.querySelector('img');
          return (
            !!img &&
            typeof img.src === 'string' &&
            img.src.startsWith('data:image/') &&
            img.naturalWidth > 0 &&
            img.getBoundingClientRect().width > 0
          );
        },
        POSTIT_SEL.NOTE,
        5000,
        'A26: 첨부 후 5초 내 노트 내부에 src 가 "data:image/" 로 시작하고 naturalWidth > 0 인 img 가 표시되지 않았습니다'
      );

      // 저장 데이터 URI ≤ 300×1024 바이트 (다운스케일 강제)
      let storedLen = null;
      const deadline = Date.now() + 5000;
      for (;;) {
        storedLen = await page.evaluate(() => {
          for (const k of Object.keys(localStorage)) {
            const v = localStorage.getItem(k) || '';
            const m = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/.exec(v);
            if (m) return m[0].length;
          }
          return null;
        });
        if (storedLen !== null) break;
        if (Date.now() > deadline) {
          throw new Error('A26: 첨부 후 5초 내 데이터 URI 가 localStorage 에 저장되지 않았습니다');
        }
        await sleep(150);
      }
      expect(
        storedLen <= MAX_URI_LEN,
        `A26: 저장된 데이터 URI 길이가 ${storedLen} 바이트입니다 (${MAX_URI_LEN} 바이트 이하로 다운스케일해야 함 — localStorage 포화 방지)`
      ).toBe(true);
      const info1 = await noteImgInfo(page, 0);
      assertNoDialogs(app.state, 'A26');
      await closeApp(app);
      app = null;

      // ── 재기동: 동일 표시 (같은 src 길이) ──
      app = await launchApp(dir, POSTIT_PATH);
      states.push(app.state);
      page = app.page;
      await pollVisibleNoteCount(page, 1, 5000, 'A26 재기동');
      await pollPage(
        page,
        ({ N, wantLen }) => {
          const note = document.querySelector(N);
          if (!note) return false;
          const img = note.querySelector('img');
          return (
            !!img && img.src.startsWith('data:image/') && img.naturalWidth > 0 && img.src.length === wantLen
          );
        },
        { N: POSTIT_SEL.NOTE, wantLen: info1.srcLen },
        5000,
        `A26: 재기동 후 노트 이미지가 동일하게 표시되지 않았습니다 (기대 src 길이 ${info1.srcLen})`
      );

      // ── 거부 케이스: 비이미지(.txt) → img 미생성 + [data-toast] 안내 + dialog·pageerror 0건 ──
      await addNote(page);
      await pollVisibleNoteCount(page, 2, 5000, 'A26 거부 케이스');
      const txtPath = path.join(tmpDir, 'a26-not-image.txt');
      fs.writeFileSync(txtPath, 'A26 비이미지 파일 — 첨부 거부 대상', 'utf8');
      const note2 = page.locator(POSTIT_SEL.NOTE).nth(1);
      await attachViaMenu(page, note2, txtPath, 'A26 거부');
      await sleep(1500);
      const info2 = await noteImgInfo(page, 1);
      expect(
        info2.count,
        `A26: 비이미지 파일 첨부에 img 가 ${info2.count}개 생성되었습니다 (0개여야 함 — 파일 형식 검증 필요)`
      ).toBe(0);
      const toastVisible = await page.evaluate(() => {
        const effOpacity = (el) => {
          let o = 1;
          for (let c = el; c && c.nodeType === 1; c = c.parentElement) o *= parseFloat(getComputedStyle(c).opacity) || 0;
          return o;
        };
        for (const t of document.querySelectorAll('[data-toast]')) {
          const r = t.getBoundingClientRect();
          const s = getComputedStyle(t);
          if (r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && effOpacity(t) > 0.05) return true;
        }
        return false;
      });
      expect(
        toastVisible,
        'A26: 비이미지 파일 거부 시 비모달 안내([data-toast])가 표시되지 않았습니다 — rev.5 DOM 계약 (fail-closed)'
      ).toBe(true);
      expect(
        app.state.pageErrors,
        `A26: pageerror ${app.state.pageErrors.length}건 발생 (0건이어야 함): ${app.state.pageErrors.join(' | ')}`
      ).toHaveLength(0);
      for (const s of states) assertNoDialogs(s, 'A26');
    } finally {
      await closeApp(app);
      await removeDirWithRetry(dir);
      await removeDirWithRetry(tmpDir);
    }
  });
});
