'use strict';
/**
 * 아이콘 후보 3안 렌더 스크립트 (시사용 산출물 생성).
 * - grader의 playwright를 읽기 전용으로 require (grader 파일 수정 없음).
 * - 각 SVG를 512px·44px PNG(투명 배경)로 렌더 + preview-sheet.html 전체를 preview-sheet.png로 캡처.
 * 실행: node render.js  (이 디렉터리에서)
 */
const path = require('path');
const { chromium } = require('d:/custom_program/protocol/grader/node_modules/@playwright/test');

const DIR = __dirname;
const ICONS = [
  ['a', 'icon-a-cork.svg'],
  ['b', 'icon-b-flat.svg'],
  ['c', 'icon-c-monogram.svg'],
];
const SIZES = [512, 44];

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    // 1) 개별 PNG — SVG 문서를 뷰포트 크기로 렌더 (viewBox만 있어 뷰포트에 맞게 스케일)
    for (const [key, file] of ICONS) {
      for (const size of SIZES) {
        const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
        await page.goto('file:///' + path.join(DIR, file).replace(/\\/g, '/'));
        await page.waitForTimeout(250); // 필터(노이즈) 렌더 안정화
        await page.screenshot({
          path: path.join(DIR, `icon-${key}-${size}.png`),
          omitBackground: true,
          clip: { x: 0, y: 0, width: size, height: size },
        });
        await page.close();
        console.log(`icon-${key}-${size}.png 생성`);
      }
    }

    // 2) 비교 시트 — preview-sheet.html 전체 페이지 캡처
    const page = await browser.newPage({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 1 });
    await page.goto('file:///' + path.join(DIR, 'preview-sheet.html').replace(/\\/g, '/'));
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(DIR, 'preview-sheet.png'), fullPage: true });
    await page.close();
    console.log('preview-sheet.png 생성');
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('렌더 실패:', e);
  process.exit(1);
});
