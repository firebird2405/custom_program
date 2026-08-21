'use strict';
/**
 * 만든 GIF 가 진짜 브라우저에서 재생되는지 확인한다 (자체 인코더 검증).
 * 크로미움의 GIF 디코더로 열어 naturalWidth/Height 를 확인하고,
 * 재생 중 세 시점을 캡처해 tools/gif-check.png 로 붙여 낸다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.resolve(__dirname, '..');
const { chromium } = require(path.join(ROOT, 'protocol', 'grader', 'node_modules', '@playwright', 'test'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const gif = path.join(OUT, 'demo-drag.gif');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gif-check-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: 'msedge', headless: true, viewport: { width: 1700, height: 360 }, deviceScaleFactor: 1
  });
  await ctx.route((u) => /^https?:/i.test(u.href), (r) => r.abort());
  const page = ctx.pages()[0];
  /* about:blank 에서는 file:// 하위 자원이 차단되므로 임시 html 을 같은 폴더에 두고 연다 */
  const htmlPath = path.join(__dirname, '_gifcheck.html');
  fs.writeFileSync(htmlPath,
    '<meta charset="utf-8"><body style="margin:0;background:#222;display:flex;gap:10px;padding:10px">' +
    '<img id="a" src="../demo-drag.gif"><img id="b" src="../demo-drag.gif"><img id="c" src="../demo-drag.gif">' +
    '</body>', 'utf8');
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const i = document.getElementById('a');
    return i && i.complete;
  }, null, { timeout: 15000 });
  const info = await page.evaluate(() => {
    const i = document.getElementById('a');
    return { w: i.naturalWidth, h: i.naturalHeight };
  });
  /* 세 장의 <img> 는 각자 로드 시점이 달라 서로 다른 프레임에 머문다 —
     한 장에 세 시점이 함께 담기면 애니메이션이 실제로 진행된다는 증거다. */
  await sleep(1500);
  await page.screenshot({ path: path.join(__dirname, 'gif-check.png') });
  await ctx.close();
  fs.rmSync(dir, { recursive: true, force: true });
  const bytes = fs.statSync(gif).size;
  console.log(JSON.stringify({ naturalWidth: info.w, naturalHeight: info.h, bytes }));
  if (!info.w || !info.h) { console.error('디코드 실패: 브라우저가 GIF 를 읽지 못했습니다.'); process.exit(1); }
})();
