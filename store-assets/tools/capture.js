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

/* ───────────────────────────── 장면들 ───────────────────────────── */

/** ① 드래그 도중 — 노트가 들리고(그림자·scale) 진행 방향으로 기울어진 순간 */
async function shotDrag(page) {
  const note = page.locator('[data-note][data-id="demo-movie"]');
  const handle = note.locator('[data-drag-handle]');
  const box = await handle.boundingBox();
  const sx = box.x + box.width / 2, sy = box.y + box.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  /* 오른쪽·위로 크게 끌어 --tilt 가 최대(+2.5deg)로 걸린 상태를 만든다 */
  const path0 = [[60, -20], [130, -55], [210, -95], [285, -130], [340, -150], [372, -158]];
  for (const [dx, dy] of path0) {
    await page.mouse.move(sx + dx, sy + dy, { steps: 6 });
    await sleep(40);
  }
  await sleep(120);
  await page.screenshot({ path: path.join(OUT, 'screenshot-06-drag-in-progress.png') });
  await page.mouse.up();
  await sleep(300);
}

/** ② 포스트잇 → 캘린더 연동: 노트 우클릭 메뉴의 "날짜 지정"에 날짜가 들어간 순간 */
async function shotLinkPostit(page) {
  const note = page.locator('[data-note][data-id="demo-birthday"]');
  await note.click({ position: { x: 20, y: 60 } });
  await sleep(200);
  await note.click({ button: 'right', position: { x: 90, y: 100 } });
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, 'screenshot-07-note-date-menu.png') });
  await page.keyboard.press('Escape');
  await sleep(200);
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

/** 보드 전체 — 시딩된 예쁜 기본 화면 (기존 01 을 대체할 수 있는 새 컷) */
async function shotBoard(page) {
  await page.screenshot({ path: path.join(OUT, 'screenshot-09-board-seeded.png') });
}

/** ④ 캘린더 — 📌 연동 일정이 수동 일정과 나란히 보이는 달 */
async function shotCalendar(page) {
  await page.screenshot({ path: path.join(OUT, 'screenshot-08-calendar-linked.png') });
}

/* ─────────────────────── GIF 프레임 (드래그 3초 루프) ─────────────────────── */

/**
 * 드래그 궤적을 따라가며 클립 영역을 연속 촬영한다.
 * 왕복 궤적이라 마지막 프레임이 첫 프레임과 거의 같아 루프가 매끄럽다.
 */
async function captureFrames(page) {
  fs.rmSync(FRAMES, { recursive: true, force: true });
  fs.mkdirSync(FRAMES, { recursive: true });

  const CLIP = { x: 360, y: 300, width: 1000, height: 620 };
  const note = page.locator('[data-note][data-id="demo-movie"]');
  const handle = note.locator('[data-drag-handle]');
  const box = await handle.boundingBox();
  const sx = box.x + box.width / 2, sy = box.y + box.height / 2;

  /* 오른쪽 위로 갔다가 제자리로 돌아오는 부드러운 곡선 (ease-in-out) */
  const N = 30;
  const AX = 300, AY = -120;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const t = i / N;                       /* 0 → 1 (마지막 프레임 뒤가 곧 첫 프레임) */
    const s = 0.5 - 0.5 * Math.cos(2 * Math.PI * t);   /* 0 → 1 → 0 왕복 */
    pts.push([AX * s, AY * s + 26 * Math.sin(2 * Math.PI * t) * -1]);
  }

  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 1, sy);      /* dragging 클래스 진입 */
  await sleep(60);

  const files = [];
  for (let i = 0; i < pts.length; i++) {
    const [dx, dy] = pts[i];
    await page.mouse.move(sx + dx, sy + dy, { steps: 3 });
    const f = path.join(FRAMES, 'drag-' + String(i).padStart(2, '0') + '.png');
    await page.screenshot({ path: f, clip: CLIP });
    files.push(f);
  }
  await page.mouse.up();
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

  const made = [];
  try {
    await openSeeded(page, path.join(ROOT, 'postit.html'));

    if (mode === 'all' || mode === 'shots') {
      await shotBoard(page);            made.push('screenshot-09-board-seeded.png');
      await shotDrag(page);             made.push('screenshot-06-drag-in-progress.png');
      await shotLinkPostit(page);       made.push('screenshot-07-note-date-menu.png');
      await shotSettingsSearch(page, '백업', 'screenshot-10-settings-search.png');
      made.push('screenshot-10-settings-search.png');
    }

    if (mode === 'all' || mode === 'frames') {
      /* 드래그 장면 때문에 노트가 옮겨졌을 수 있으니 원래 배치로 되돌린 뒤 촬영 */
      await openSeeded(page, path.join(ROOT, 'postit.html'));
      const files = await captureFrames(page);
      made.push(files.length + '개 프레임 → frames/');
    }

    if (mode === 'all' || mode === 'shots') {
      await openSeeded(page, path.join(ROOT, 'calendar.html'));
      await shotCalendar(page);         made.push('screenshot-08-calendar-linked.png');
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
