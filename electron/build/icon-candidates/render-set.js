'use strict';
/**
 * 정식 아이콘 세트 렌더 스크립트 — A안(icon-a-cork.svg) 확정본.
 * - grader의 playwright를 읽기 전용으로 require (grader 파일 수정 없음, render.js 방식 재사용).
 * - 소스 3종:
 *     icon-a-cork.svg        (정본 — 150px 이상)
 *     icon-a-cork-small.svg  (16~50px 판독성 변형 — 평탄 코르크 + 실루엣 위주)
 *     icon-a-cork-wide.svg   (Wide 310×150 전용 가로 재구성)
 * - 산출: build/icon.png(512) + build/appx/ 전체 세트 (Logo 계열 + electron-builder 관례명 사본 계열).
 * 실행: node render-set.js  (이 디렉터리에서)
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('d:/custom_program/protocol/grader/node_modules/@playwright/test');

const DIR = __dirname;
const BUILD = path.resolve(DIR, '..');
const APPX = path.join(BUILD, 'appx');

const FULL = path.join(DIR, 'icon-a-cork.svg');
const SMALL = path.join(DIR, 'icon-a-cork-small.svg');
const WIDE = path.join(DIR, 'icon-a-cork-wide.svg');

/** [소스 SVG, 폭, 높이, 산출 파일 목록(첫 파일 렌더 후 나머지는 사본)] */
const JOBS = [
  [FULL, 512, 512, [path.join(BUILD, 'icon.png')]],
  [FULL, 300, 300, [path.join(APPX, 'Square150x150Logo.scale-200.png'), path.join(APPX, 'Square150x150.scale-200.png')]],
  [FULL, 256, 256, [path.join(APPX, 'Square44x44Logo.targetsize-256.png'), path.join(APPX, 'Square44x44.targetsize-256.png')]],
  [FULL, 150, 150, [path.join(APPX, 'Square150x150Logo.png'), path.join(APPX, 'Square150x150.png')]],
  [SMALL, 50, 50, [path.join(APPX, 'StoreLogo.png')]],
  [SMALL, 48, 48, [path.join(APPX, 'Square44x44Logo.targetsize-48.png'), path.join(APPX, 'Square44x44.targetsize-48.png')]],
  [SMALL, 44, 44, [path.join(APPX, 'Square44x44Logo.png'), path.join(APPX, 'Square44x44.png')]],
  [SMALL, 32, 32, [path.join(APPX, 'Square44x44Logo.targetsize-32.png'), path.join(APPX, 'Square44x44.targetsize-32.png')]],
  [SMALL, 24, 24, [path.join(APPX, 'Square44x44Logo.targetsize-24.png'), path.join(APPX, 'Square44x44.targetsize-24.png')]],
  [SMALL, 16, 16, [path.join(APPX, 'Square44x44Logo.targetsize-16.png'), path.join(APPX, 'Square44x44.targetsize-16.png')]],
  [WIDE, 310, 150, [path.join(APPX, 'Wide310x150Logo.png'), path.join(APPX, 'Wide310x150.png')]],
];

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const [svg, w, h, outs] of JOBS) {
      // 뷰포트는 여유 있게 잡고 <img>를 정확한 픽셀 크기로 배치 → clip 스크린샷 (16px 등 극소 뷰포트 회피)
      const page = await browser.newPage({
        viewport: { width: Math.max(w, 120), height: Math.max(h, 120) },
        deviceScaleFactor: 1,
      });
      // about:blank(setContent)에서는 file:// 이미지가 차단되므로 file:// 래퍼 HTML을 경유
      const url = 'file:///' + svg.replace(/\\/g, '/');
      const wrapPath = path.join(require('os').tmpdir(), `icon-wrap-${w}x${h}-${path.basename(svg, '.svg')}.html`);
      fs.writeFileSync(
        wrapPath,
        '<!doctype html><body style="margin:0;background:transparent">' +
          `<img src="${url}" style="display:block;width:${w}px;height:${h}px"></body>`
      );
      await page.goto('file:///' + wrapPath.replace(/\\/g, '/'));
      await page.waitForFunction(() => {
        const i = document.querySelector('img');
        return i && i.complete && i.naturalWidth > 0;
      });
      await page.waitForTimeout(350); // 필터(노이즈) 렌더 안정화
      await page.screenshot({
        path: outs[0],
        omitBackground: true,
        clip: { x: 0, y: 0, width: w, height: h },
      });
      await page.close();
      for (const dup of outs.slice(1)) fs.copyFileSync(outs[0], dup);
      for (const o of outs) console.log(path.relative(BUILD, o) + ` <- ${path.basename(svg)} @ ${w}x${h}`);
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('렌더 실패:', e);
  process.exit(1);
});
