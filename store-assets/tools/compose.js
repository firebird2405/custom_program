'use strict';
/**
 * 연동 장면 합성 컷 만들기 (포스트잇 ↔ 캘린더)
 *
 *  1) dsf=3 으로 "확대 조각"(ctx 메뉴 날짜 행 · 캘린더 사이드 패널)을 크게 떠 둔다.
 *     3배 픽셀로 떠서 합성 화면에서 줄여 쓰므로 글자가 또렷하다.
 *  2) 그 조각의 원본(1920×1080) 좌표도 같이 받아 두었다가, 축소해 놓은 전체 스크린샷 위에
 *     같은 자리에 강조 링을 얹는다.
 *  3) 합성판(_compose.html)을 file:// 로 열어 1920×1080 으로 한 장 찍는다.
 *     국문판·영문판 두 장을 만든다 (영문 리스팅용 캡션 오버레이).
 *
 * 앱 파일은 읽기만 한다. 폰트·코르크 질감은 저장소 assets/ 의 OFL·CC0 자료를 그대로 쓴다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.resolve(__dirname, '..');
const FRAG = path.join(OUT, 'fragments');
const { chromium } = require(path.join(ROOT, 'protocol', 'grader', 'node_modules', '@playwright', 'test'));
const seed = require('./seed');

const fileUrl = (p) => pathToFileURL(p).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function seedInto(page, htmlPath) {
  await page.goto(fileUrl(htmlPath), { waitUntil: 'load' });
  await page.evaluate((payload) => {
    for (const [k, v] of Object.entries(payload)) localStorage.setItem(k, v);
  }, {
    'postit-notes': JSON.stringify(seed.postitNotes()),
    'postit-decor-layout': JSON.stringify(seed.decorLayout()),
    'cal-events': JSON.stringify(seed.buildCalEvents())
  });
  await page.reload({ waitUntil: 'load' });
  await sleep(1200);
}

/** dsf=3 으로 확대 조각 두 장 + 원본 좌표를 얻는다 */
async function grabFragments() {
  fs.mkdirSync(FRAG, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petit-frag-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: 'msedge', headless: true,
    viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 3,
    locale: 'ko-KR', timezoneId: 'Asia/Seoul'
  });
  await ctx.route((u) => /^https?:/i.test(u.href), (r) => r.abort());
  const page = ctx.pages()[0];
  const boxes = {};
  try {
    /* ── 포스트잇: 노트 우클릭 메뉴의 "날짜 지정" 행 ── */
    await seedInto(page, path.join(ROOT, 'postit.html'));
    const note = page.locator('[data-note][data-id="demo-birthday"]');
    const nb = await note.boundingBox();
    await note.evaluate((el, pt) => {
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y }));
    }, { x: nb.x + nb.width * 0.55, y: nb.y + nb.height * 0.6 });
    await sleep(1200);
    const row = await page.evaluate(() => {
      const inp = document.querySelector('[data-note-date]');
      if (!inp) return null;
      const r = inp.closest('[data-ctx-item]').getBoundingClientRect();
      const m = document.querySelector('[data-ctx-menu]').getBoundingClientRect();
      /* 잘라낼 상자는 메뉴 안쪽으로 한정한다 — 바깥 코르크가 끼어들지 않게 */
      return {
        x: Math.round(m.x + 2), width: Math.round(m.width - 4),
        y: Math.round(r.y - 5), height: Math.round(r.height + 10)
      };
    });
    if (!row) throw new Error('[data-note-date] 행을 찾지 못했습니다.');
    boxes.dateRow = row;
    await page.screenshot({ path: path.join(FRAG, 'frag-note-date-row.png'), clip: boxes.dateRow });

    /* ── 캘린더: 선택한 날짜의 사이드 패널(수동 일정 + 📌 연동 일정) ── */
    await seedInto(page, path.join(ROOT, 'calendar.html'));
    const day = seed.dayKey(4);
    await page.evaluate((d) => {
      const c = document.querySelector('.cell[data-key="' + d + '"]');
      if (c) c.click();
    }, day);
    await sleep(700);
    const pan = await page.evaluate(() => {
      const head = document.getElementById('panelDate');
      const list = document.getElementById('eventList');
      if (!head || !list) return null;
      const a = head.getBoundingClientRect(), b = list.getBoundingClientRect();
      const items = list.querySelectorAll('li, .evRow, div');
      let bottom = a.bottom + 40;
      items.forEach((el) => { const r = el.getBoundingClientRect(); if (r.height > 0) bottom = Math.max(bottom, r.bottom); });
      return { x: Math.min(a.x, b.x), y: a.y, width: Math.max(a.width, b.width), height: bottom - a.y };
    });
    if (!pan) throw new Error('#panelDate / #eventList 를 찾지 못했습니다.');
    boxes.calPanel = {
      x: Math.round(pan.x - 14), y: Math.round(pan.y - 14),
      width: Math.round(pan.width + 28), height: Math.round(pan.height + 18)
    };
    await page.screenshot({ path: path.join(FRAG, 'frag-cal-panel.png'), clip: boxes.calPanel });

    /* 캘린더에서 강조할 날짜 칸 좌표 (링용) */
    boxes.calCell = await page.evaluate((d) => {
      const c = document.querySelector('.cell[data-key="' + d + '"]');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }, day);
  } finally {
    await ctx.close().catch(() => {});
    for (let i = 0; i < 8; i++) { try { fs.rmSync(dir, { recursive: true, force: true }); break; } catch (e) { await sleep(250); } }
  }
  fs.writeFileSync(path.join(FRAG, 'boxes.json'), JSON.stringify(boxes, null, 2), 'utf8');
  return boxes;
}

/* ─────────────────────────── 합성판 HTML ─────────────────────────── */

const TEXT = {
  ko: {
    title: '포스트잇에 날짜만 정하면, 달력에 저절로 📌',
    sub: '두 창은 같은 컴퓨터 안에서 바로 이어져요 — 인터넷도, 계정도 필요 없어요.',
    step1: '① 메모를 우클릭해 <b>날짜 지정</b>',
    step2: '② 그 날짜 달력에 <b>📌 로 등장</b>',
    zoom1: '메모 우클릭 메뉴',
    zoom2: '달력 · 8월 25일',
    foot: '쁘띠캘린더 — 포스트잇 월 ↔ 캘린더 연동'
  },
  en: {
    title: 'Give a sticky note a date — it lands on your calendar 📌',
    sub: 'Both windows share one local store on your PC. No account, no internet.',
    step1: '① Right-click a note → <b>Set date</b>',
    step2: '② It appears on that day as <b>📌</b>',
    zoom1: 'Note right-click menu',
    zoom2: 'Calendar · Aug 25',
    foot: 'PetitCalendar — Post-it Wall ↔ Calendar link (Korean UI shown)'
  }
};

function composeHtml(lang, boxes) {
  const t = TEXT[lang];
  const SHOT_W = 880, SCALE = SHOT_W / 1920;
  const LX = 58, RX = 982, SY = 168;
  const ring = (box, ox) => {
    if (!box) return '';
    const x = ox + box.x * SCALE, y = SY + box.y * SCALE;
    const w = box.width * SCALE, h = box.height * SCALE;
    return `<div class="ring" style="left:${x - 6}px;top:${y - 6}px;width:${w + 12}px;height:${h + 12}px"></div>`;
  };
  return `<meta charset="utf-8"><title>compose</title>
<style>
@font-face{font-family:"PenKR";src:url("../../assets/NanumPenScript-Regular.ttf") format("truetype");font-display:block}
@font-face{font-family:"GaeguKR";src:url("../../assets/Gaegu-Regular.ttf") format("truetype");font-display:block}
*{box-sizing:border-box;margin:0;padding:0}
body{width:1920px;height:1080px;overflow:hidden;position:relative;
  background:
    radial-gradient(120% 90% at 50% 0%, #fff8ea 0%, #f6e7cd 55%, #eddcbe 100%);
  font-family:"GaeguKR","PenKR",system-ui,sans-serif;color:#4a3221}
.title{position:absolute;left:0;right:0;top:34px;text-align:center;
  font-family:"PenKR","GaeguKR",cursive;font-size:${lang === 'ko' ? 66 : 58}px;line-height:1.05;color:#4a3221;
  text-shadow:0 2px 0 rgba(255,255,255,0.75)}
.sub{position:absolute;left:0;right:0;top:${lang === 'ko' ? 112 : 108}px;text-align:center;
  font-size:${lang === 'ko' ? 27 : 25}px;color:#7a5c3d;letter-spacing:.2px}
.shot{position:absolute;top:${SY}px;width:${SHOT_W}px;height:${Math.round(1080 * SCALE)}px;
  border-radius:16px;overflow:hidden;box-shadow:0 18px 40px rgba(64,38,12,.30),0 0 0 3px rgba(255,255,255,.85);
  background:#000}
.shot img{width:100%;height:100%;display:block}
.ring{position:absolute;border:4px solid #e2497e;border-radius:12px;
  box-shadow:0 0 0 4px rgba(226,73,126,.22),0 6px 16px rgba(226,73,126,.30);pointer-events:none}
.arrow{position:absolute;left:${LX + SHOT_W - 6}px;top:${SY + 150}px;width:${RX - (LX + SHOT_W) + 12}px;height:110px;
  display:flex;align-items:center;justify-content:center}
.arrow svg{filter:drop-shadow(0 4px 6px rgba(90,50,20,.28))}
.chip{position:absolute;top:${SY + Math.round(1080 * SCALE) + 22}px;width:${SHOT_W}px;text-align:center;
  font-size:31px;color:#5a4029}
.chip b{color:#c23b6c}
.zoomrow{position:absolute;left:58px;right:58px;top:790px;display:flex;gap:44px;align-items:flex-start}
.zoom{flex:1;min-height:236px;background:rgba(255,255,255,.72);border-radius:18px;padding:18px 20px 14px;
  box-shadow:0 10px 26px rgba(64,38,12,.20);display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:12px}
.zoom img{max-width:100%;max-height:184px;width:auto;height:auto;object-fit:contain;display:block;border-radius:10px}
.zoom .cap{font-size:23px;color:#8a6a48}
.foot{position:absolute;left:0;right:0;bottom:20px;text-align:center;font-size:22px;color:#9b7d5c}
</style>
<div class="title">${t.title}</div>
<div class="sub">${t.sub}</div>

<div class="shot" style="left:${LX}px"><img src="../screenshot-07-note-date-menu.png"></div>
<div class="shot" style="left:${RX}px"><img src="../screenshot-08-calendar-linked.png"></div>
${ring(boxes.dateRowFull, LX)}
${ring(boxes.calCell, RX)}

<div class="arrow"><svg width="86" height="62" viewBox="0 0 86 62">
  <path d="M4 31 H62" stroke="#c23b6c" stroke-width="9" stroke-linecap="round" fill="none"/>
  <path d="M52 12 L78 31 L52 50 Z" fill="#c23b6c"/>
</svg></div>

<div class="chip" style="left:${LX}px">${t.step1}</div>
<div class="chip" style="left:${RX}px">${t.step2}</div>

<div class="zoomrow">
  <div class="zoom"><img src="../fragments/frag-note-date-row.png"><span class="cap">${t.zoom1}</span></div>
  <div class="zoom"><img src="../fragments/frag-cal-panel.png"><span class="cap">${t.zoom2}</span></div>
</div>
<div class="foot">${t.foot}</div>
`;
}

async function render(lang, boxes) {
  const htmlPath = path.join(__dirname, '_compose.' + lang + '.html');
  fs.writeFileSync(htmlPath, composeHtml(lang, boxes), 'utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petit-compose-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: 'msedge', headless: true,
    viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, locale: 'ko-KR'
  });
  await ctx.route((u) => /^https?:/i.test(u.href), (r) => r.abort());
  const page = ctx.pages()[0];
  await page.goto(fileUrl(htmlPath), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await sleep(700);
  const out = path.join(OUT, lang === 'ko' ? 'screenshot-11-link-flow.png' : 'screenshot-11-link-flow.en.png');
  await page.screenshot({ path: out });
  await ctx.close().catch(() => {});
  for (let i = 0; i < 8; i++) { try { fs.rmSync(dir, { recursive: true, force: true }); break; } catch (e) { await sleep(250); } }
  return out;
}

async function main() {
  const boxes = await grabFragments();
  /* 조각 좌표는 dsf=3 클립이지만 CSS 좌표계는 1x 이므로 링 좌표는 그대로 쓸 수 있다 */
  boxes.dateRowFull = boxes.dateRow;
  const made = [];
  made.push(await render('ko', boxes));
  made.push(await render('en', boxes));
  console.log('생성:', made.map((p) => path.basename(p)).join(', '));
}

main().catch((e) => { console.error('실패:', (e && e.stack) || e); process.exit(1); });
