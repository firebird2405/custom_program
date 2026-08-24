'use strict';
/**
 * 국문 리스팅용 캡션 오버레이 생성기 (captionize.js 의 한국어판 — 발주 #26 후속).
 *
 * 파트너센터 목록 화면에서 스크린샷은 손톱만 하게 보인다 — 화면만으로는 1초 안에
 * 기능이 안 읽히므로, 제출용 6장 아래에 반투명 띠 + 국문 한 줄을 얹어 kr/ 에 저장한다.
 * (원본 픽셀은 손대지 않는다 — 띠만 덧그린다. 문구는 스토어 설명문과 같은 사실만 말한다.)
 *
 *    node tools/captionize-kr.js
 *
 * 출력: kr/<원본 파일명> (1920×1200 = 원본 1080 + 캡션 띠 120). 제출은 kr/ 판으로 한다.
 * 문구를 바꾸려면 아래 CAPTIONS 표만 고치고 다시 돌리면 된다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.resolve(__dirname, '..');
const KR = path.join(OUT, 'kr');
const { chromium } = require(path.join(ROOT, 'protocol', 'grader', 'node_modules', '@playwright', 'test'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 파일 → 국문 캡션 — README §2-2 제출 순서 그대로 (합성·구버전·Pro 컷 없음) */
const CAPTIONS = [
  ['screenshot-09-board-seeded.png',
    '바탕화면 코르크보드 — 포스트잇을 5가지 색으로 어디든 붙여요'],
  ['screenshot-06-drag-in-progress.png',
    '잡아서 끌면 살짝 들리고 기울어져요 — 놓은 자리에 그대로'],
  ['screenshot-08-calendar-linked.png',
    '공휴일·음력·색 태그 — 포스트잇에서 \u{1F4CC} 붙인 일정까지 한눈에'],
  ['screenshot-10-settings-search.png',
    '설정은 검색으로 — 이름이든 #태그든 치면 바로 나와요'],
  ['screenshot-07-note-date-menu.png',
    '우클릭 한 번 — 색·크기·사진·날짜 지정까지'],
  ['screenshot-12-onboarding-spotlight.png',
    '처음 켜면 4단계 안내가 누를 곳을 비춰 줘요']
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
.cap{color:#fff8ec;font-family:"GaeguKR",system-ui,sans-serif;font-size:46px;line-height:1.1;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.brand{color:rgba(255,226,190,.60);font-family:"GaeguKR",system-ui,sans-serif;font-size:24px;
  letter-spacing:.5px;white-space:nowrap;padding-left:28px}
</style>
<img src="${imgRel}">
<div class="bar"><div class="cap">${caption}</div><div class="brand">쁘띠캘린더 · 무료 · 광고 없음</div></div>
`;
}

async function main() {
  fs.mkdirSync(KR, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petit-capkr-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: 'msedge', headless: true, viewport: { width: 1920, height: 1200 }, deviceScaleFactor: 1
  });
  await ctx.route((u) => /^https?:/i.test(u.href), (r) => r.abort());
  const page = ctx.pages()[0];
  const made = [], skipped = [];
  try {
    for (const [file, cap] of CAPTIONS) {
      if (!fs.existsSync(path.join(OUT, file))) { skipped.push(file); continue; }
      const html = path.join(__dirname, '_caption_kr.html');
      fs.writeFileSync(html, pageHtml('../' + file, cap), 'utf8');
      await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await sleep(350);
      const out = path.join(KR, file);
      await page.screenshot({ path: out });
      made.push(file);
    }
  } finally {
    await ctx.close().catch(() => {});
    try { fs.rmSync(path.join(__dirname, '_caption_kr.html'), { force: true }); } catch (e) { /* 무해 */ }
    for (let i = 0; i < 8; i++) { try { fs.rmSync(dir, { recursive: true, force: true }); break; } catch (e) { await sleep(250); } }
  }
  console.log('kr/ 생성 ' + made.length + '장' + (skipped.length ? ' · 원본 없음: ' + skipped.join(', ') : ''));
}

main().catch((e) => { console.error('실패:', (e && e.stack) || e); process.exit(1); });
