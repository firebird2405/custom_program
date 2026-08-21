'use strict';
/**
 * 영문 리스팅용 캡션 오버레이 생성기.
 *
 * 앱 UI 가 전부 한국어라 영문 스토어에서는 화면만 보고 기능을 알기 어렵다.
 * 원본 스크린샷은 그대로 두고 아래쪽에 반투명 띠 + 영문 한 줄을 얹어 en/ 에 저장한다.
 * (원본 픽셀은 손대지 않는다 — 띠만 덧그린다.)
 *
 *    node tools/captionize.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.resolve(__dirname, '..');
const EN = path.join(OUT, 'en');
const { chromium } = require(path.join(ROOT, 'protocol', 'grader', 'node_modules', '@playwright', 'test'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 파일 → 영문 캡션 (스토어 리스팅 순서대로) */
const CAPTIONS = [
  ['screenshot-09-board-seeded.png',
    'Your cork board on the desktop — pin notes anywhere, in five colors.'],
  ['screenshot-06-drag-in-progress.png',
    'Grab a note and drop it anywhere — it lifts and tilts as you drag.'],
  ['screenshot-07-note-date-menu.png',
    'Right-click a note: recolor, resize, add a photo, or set a date.'],
  ['screenshot-08-calendar-linked.png',
    'Holidays, lunar dates, color tags — and \u{1F4CC} notes from your wall.'],
  ['screenshot-10-settings-search.png',
    'Search every setting by name or #tag — no digging through tabs.'],
  ['screenshot-12-onboarding-spotlight.png',
    'A four-step guided start — the app spotlights what to press next.'],
  ['screenshot-03-decor-panel.png',
    'Decorate: backgrounds, masking tape, emoji and photo stickers.'],
  ['screenshot-04-theme-lavender.png',
    'Premium theme: Lavender Mist — same board, a different mood.'],
  ['screenshot-05-theme-deepsea.png',
    'Premium theme: Deep-sea Blue — cozy for late nights.']
];

function pageHtml(imgRel, caption) {
  return `<meta charset="utf-8"><title>caption</title>
<style>
@font-face{font-family:"GaeguKR";src:url("../../assets/Gaegu-Regular.ttf") format("truetype");font-display:block}
*{margin:0;padding:0;box-sizing:border-box}
body{width:1920px;height:1200px;overflow:hidden;position:relative;background:#241505}
img{width:1920px;height:1080px;display:block}
.bar{position:absolute;left:0;right:0;top:1080px;height:120px;
  background:linear-gradient(180deg,#2b1a08,#1d1104);
  display:flex;align-items:center;justify-content:space-between;padding:0 64px;
  border-top:2px solid rgba(255,214,150,.30)}
.cap{color:#fff8ec;font-family:"GaeguKR",system-ui,sans-serif;font-size:44px;line-height:1.1;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.brand{color:rgba(255,226,190,.60);font-family:"GaeguKR",system-ui,sans-serif;font-size:24px;
  letter-spacing:.5px;white-space:nowrap;padding-left:28px}
</style>
<img src="${imgRel}">
<div class="bar"><div class="cap">${caption}</div><div class="brand">PetitCalendar · Korean UI</div></div>
`;
}

async function main() {
  fs.mkdirSync(EN, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petit-cap-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: 'msedge', headless: true, viewport: { width: 1920, height: 1200 }, deviceScaleFactor: 1
  });
  await ctx.route((u) => /^https?:/i.test(u.href), (r) => r.abort());
  const page = ctx.pages()[0];
  const made = [], skipped = [];
  try {
    for (const [file, cap] of CAPTIONS) {
      if (!fs.existsSync(path.join(OUT, file))) { skipped.push(file); continue; }
      const html = path.join(__dirname, '_caption.html');
      fs.writeFileSync(html, pageHtml('../' + file, cap), 'utf8');
      await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await sleep(350);
      const out = path.join(EN, file);
      await page.screenshot({ path: out });
      made.push(file);
    }
  } finally {
    await ctx.close().catch(() => {});
    for (let i = 0; i < 8; i++) { try { fs.rmSync(dir, { recursive: true, force: true }); break; } catch (e) { await sleep(250); } }
  }
  console.log('en/ 생성 ' + made.length + '장' + (skipped.length ? ' · 원본 없음: ' + skipped.join(', ') : ''));
}

main().catch((e) => { console.error('실패:', (e && e.stack) || e); process.exit(1); });
