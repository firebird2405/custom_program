'use strict';
/* 커서 그림(SVG) 확인용 미리보기 — 실제 크기와 8배 확대를 나란히 렌더한다. */
const path = require('path');
const os = require('os');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const { chromium } = require(path.join(ROOT, 'protocol', 'grader', 'node_modules', '@playwright', 'test'));
const { CURSOR_SVG_RAW } = require('./cursor');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-prev-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: 'msedge', headless: true, viewport: { width: 700, height: 380 }, deviceScaleFactor: 1
  });
  const page = ctx.pages()[0];
  await page.setContent(
    '<body style="margin:0;background:#8a5a3b;display:flex;gap:40px;align-items:center;justify-content:center;height:380px">' +
    '<div style="width:34px;height:36px">' + CURSOR_SVG_RAW + '</div>' +
    '<div style="width:272px;height:288px">' + CURSOR_SVG_RAW + '</div>' +
    '</body>'
  );
  await page.screenshot({ path: path.join(__dirname, 'cursor-preview.png') });
  await ctx.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('ok');
})();
