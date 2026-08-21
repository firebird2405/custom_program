'use strict';
/**
 * 스토어 스크린샷·GIF 프레임 촬영기 (읽기 전용 구동)
 *
 * ── 원칙 ─────────────────────────────────────────────────────────────
 *  - 앱(calendar.html·postit.html)·Electron 셸·채점기 파일을 일절 수정하지 않는다.
 *    playwright 는 채점기 node_modules 에서 require 만 한다 (읽기 전용).
 *  - 매번 os.tmpdir() 아래 새 프로필을 만들어 한국어 샘플 데이터를 시딩한다.
 *    사용자의 실제 데이터(.edge\calendar·.edge\postit)는 건드리지 않는다.
 *  - 런타임 http(s) 요청은 route 로 차단한다 (오프라인 원칙 확인 겸).
 *  - 마우스 커서는 헤드리스 캡처에 찍히지 않으므로, 드래그 장면에 한해 촬영 시점의
 *    실제 포인터 좌표에 커서 그림(SVG 오버레이)을 덧그린다. 앱 UI 가 아니라 촬영
 *    주석이며 위치·모양(grabbing 손) 모두 실제 동작과 같다 — README 에 명시.
 *
 * 사용법
 *    node tools/capture.js            # 전체 장면 + GIF 프레임
 *    node tools/capture.js shots      # 스크린샷만
 *    node tools/capture.js frames     # GIF 프레임만
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');              // d:\custom_program
const OUT = path.resolve(__dirname, '..');                     // store-assets
const FRAMES = path.join(OUT, 'frames');
const GRADER_PW = path.join(ROOT, 'protocol', 'grader', 'node_modules', '@playwright', 'test');
const { chromium } = require(GRADER_PW);

const seed = require('./seed');

const VW = 1920, VH = 1080;

const { CURSOR_URI, HOTSPOT, SIZE } = require('./cursor');

function fileUrl(p) { return pathToFileURL(p).href; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function launch(profileDir) {
  const ctx = await chromium.launchPersistentContext(profileDir, {
    channel: 'msedge',
    headless: true,
    viewport: { width: VW, height: VH },
    deviceScaleFactor: 1,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul'
  });
  await ctx.route((u) => /^https?:/i.test(u.href), (route) => route.abort());
  const page = ctx.pages()[0] || (await ctx.newPage());
  return { ctx, page };
}

/** 앱을 열고 한국어 샘플 데이터를 심은 뒤 다시 읽어들인다 */
async function openSeeded(page, htmlPath, extra) {
  await page.goto(fileUrl(htmlPath), { waitUntil: 'load' });
  await page.evaluate((payload) => {
    for (const [k, v] of Object.entries(payload)) localStorage.setItem(k, v);
  }, Object.assign({
    'postit-notes': JSON.stringify(seed.postitNotes()),
    'postit-decor-layout': JSON.stringify(seed.decorLayout()),
    'cal-events': JSON.stringify(seed.buildCalEvents())
  }, extra || {}));
  await page.reload({ waitUntil: 'load' });
  await sleep(1200);   /* 등장 애니메이션(pop-in 220ms)·폰트 안착 대기 */
}

/** 촬영 주석: 실제 포인터 좌표에 커서 그림을 얹는다 (앱 DOM 은 파일 수정 없이 런타임에만) */
async function drawCursor(page, x, y) {
  await page.evaluate(({ x, y, uri, hs, sz }) => {
    let el = document.getElementById('__shotCursor');
    if (!el) {
      el = document.createElement('div');
      el.id = '__shotCursor';
      el.style.cssText =
        'position:fixed;left:0;top:0;pointer-events:none;z-index:2147483647;' +
        'background-repeat:no-repeat;background-size:contain;' +
        'filter:drop-shadow(0 3px 4px rgba(0,0,0,0.40))';
      el.style.width = sz.w + 'px';
      el.style.height = sz.h + 'px';
      el.style.backgroundImage = 'url("' + uri + '")';
      document.body.appendChild(el);
    }
    const k = sz.w / 30;   /* viewBox 30 기준 핫스팟 → 실제 렌더 크기로 환산 */
    el.style.transform = 'translate(' + (x - hs.x * k) + 'px,' + (y - hs.y * k) + 'px)';
  }, { x, y, uri: CURSOR_URI, hs: HOTSPOT, sz: SIZE });
}

async function clearCursor(page) {
  await page.evaluate(() => {
    const el = document.getElementById('__shotCursor');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });
}

/* ───────────────────────────── 장면들 ───────────────────────────── */

/** 보드 전체 — 시딩된 기본 화면 */
async function shotBoard(page) {
  await page.screenshot({ path: path.join(OUT, 'screenshot-09-board-seeded.png') });
}

/** ① 드래그 도중 — 노트가 들리고(그림자·확대) 진행 방향으로 기울어진 순간 */
async function shotDrag(page) {
  const note = page.locator('[data-note][data-id="demo-movie"]');
  const handle = note.locator('[data-drag-handle]');
  const box = await handle.boundingBox();
  const sx = box.x + box.width / 2, sy = box.y + box.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  /* 왼쪽 위로 끌어 --tilt 를 -2.5deg 로 걸어 둔다 (노트 자체 회전 -2.2deg 과 같은 방향) */
  const legs = [[-40, -25], [-85, -55], [-130, -95], [-165, -135], [-188, -168], [-200, -185]];
  for (const [dx, dy] of legs) {
    await page.mouse.move(sx + dx, sy + dy, { steps: 5 });
    await sleep(45);
  }
  const last = legs[legs.length - 1];
  await drawCursor(page, sx + last[0], sy + last[1]);
  await sleep(120);
  await page.screenshot({ path: path.join(OUT, 'screenshot-06-drag-in-progress.png') });
  await page.mouse.up();
  await clearCursor(page);
  await sleep(250);
}

/** ② 포스트잇 → 캘린더 연동: 노트 우클릭 메뉴의 "날짜 지정"에 날짜가 들어간 순간 */
async function shotLinkPostit(page) {
  const note = page.locator('[data-note][data-id="demo-birthday"]');
  const bb = await note.boundingBox();
  const px = bb.x + bb.width * 0.55, py = bb.y + bb.height * 0.6;
  await note.evaluate((el, pt) => {
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y }));
  }, { x: px, y: py });
  await sleep(1400);
  await page.screenshot({ path: path.join(OUT, 'screenshot-07-note-date-menu.png') });
  await page.keyboard.press('Escape');
  await sleep(250);
}

/** ③ 설정 — 중앙 모달 + 설정 검색 결과 */
async function shotSettingsSearch(page, query, file) {
  await page.locator('#settingsBtn').click();
  await sleep(500);
  const input = page.locator('[data-settings-search]');
  await input.click();
  await input.type(query, { delay: 55 });
  await sleep(700);
  await page.screenshot({ path: path.join(OUT, file) });
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.keyboard.press('Escape');
  await sleep(300);
}

/** ④ 캘린더 — 📌 연동 일정이 수동 일정과 나란히 보이는 달 (해당 날짜 선택 상태) */
async function shotCalendar(page) {
  const day = seed.dayKey(4);
  await page.evaluate((d) => {
    const cell = document.querySelector('.cell[data-key="' + d + '"]');
    if (cell) cell.click();
  }, day);
  await sleep(600);
  await page.screenshot({ path: path.join(OUT, 'screenshot-08-calendar-linked.png') });
}

/* ─────────────────────── GIF 프레임 (드래그 3초 루프) ─────────────────────── */

async function captureFrames(page) {
  fs.rmSync(FRAMES, { recursive: true, force: true });
  fs.mkdirSync(FRAMES, { recursive: true });

  const CLIP = { x: 150, y: 440, width: 1100, height: 620 };   /* → 2배 축소 시 550×310 */
  const note = page.locator('[data-note][data-id="demo-movie"]');
  const handle = note.locator('[data-drag-handle]');
  const box = await handle.boundingBox();
  const sx = box.x + box.width / 2, sy = box.y + box.height / 2;

  /* 왼쪽 위로 들었다가 제자리로 돌아오는 왕복 곡선 — 마지막 프레임 다음이 곧 첫 프레임 */
  const N = 30;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const t = i / N;
    const s = 0.5 - 0.5 * Math.cos(2 * Math.PI * t);       /* 0 → 1 → 0 */
    pts.push([-260 * s, -150 * s + 22 * Math.sin(4 * Math.PI * t)]);
  }

  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 1, sy);      /* dragging 클래스 진입 */
  await sleep(60);

  const files = [];
  for (let i = 0; i < pts.length; i++) {
    const [dx, dy] = pts[i];
    await page.mouse.move(sx + dx, sy + dy, { steps: 3 });
    await drawCursor(page, sx + dx, sy + dy);
    const f = path.join(FRAMES, 'drag-' + String(i).padStart(2, '0') + '.png');
    await page.screenshot({ path: f, clip: CLIP });
    files.push(f);
  }
  await page.mouse.up();
  await clearCursor(page);
  await sleep(300);
  return files;
}

/* ─────────────────────────────── 메인 ─────────────────────────────── */

async function main() {
  const mode = process.argv[2] || 'all';
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'petit-store-'));
  const { ctx, page } = await launch(profile);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message)));
  const http = [];
  ctx.on('request', (r) => { if (/^https?:/i.test(r.url())) http.push(r.url()); });

  const POSTIT = path.join(ROOT, 'postit.html');
  const CAL = path.join(ROOT, 'calendar.html');
  const made = [];
  try {
    if (mode === 'all' || mode === 'shots') {
      await openSeeded(page, POSTIT);
      await shotBoard(page);            made.push('screenshot-09-board-seeded.png');
      await shotDrag(page);             made.push('screenshot-06-drag-in-progress.png');

      await openSeeded(page, POSTIT);
      await shotLinkPostit(page);       made.push('screenshot-07-note-date-menu.png');

      await openSeeded(page, POSTIT);
      await shotSettingsSearch(page, '백업', 'screenshot-10-settings-search.png');
      made.push('screenshot-10-settings-search.png');

      await openSeeded(page, CAL);
      await shotCalendar(page);         made.push('screenshot-08-calendar-linked.png');
    }

    if (mode === 'all' || mode === 'frames') {
      await openSeeded(page, POSTIT);
      const files = await captureFrames(page);
      made.push(files.length + '개 프레임 → frames/');
    }
  } finally {
    await ctx.close().catch(() => {});
    for (let i = 0; i < 8; i++) {
      try { fs.rmSync(profile, { recursive: true, force: true }); break; } catch (e) { await sleep(250); }
    }
  }
  console.log('생성:', made.join(', '));
  console.log('pageerror:', errors.length, '| http(s) 요청:', http.length);
}

main().catch((e) => { console.error('실패:', e && e.stack || e); process.exit(1); });
