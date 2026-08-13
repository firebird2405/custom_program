'use strict';
/**
 * A10 — 에셋 라이선스·번들 검증 (SCORECARD A10)
 *
 * 정적:
 *  - assets/ 하위 전 파일이 ASSETS.md 마크다운 표(파일명|출처 URL|라이선스)와 전수 일치
 *    (표에 없는 파일·파일 없는 행 모두 FAIL, ASSETS.md 자신은 대상 제외)
 *  - 라이선스가 허용 목록(CC0·Public Domain·OFL·MIT·CC BY 등 개인 사용 허용 식별자)에 매치
 *    (빈 값·'불명' FAIL), 출처 URL 빈 값 FAIL
 * 런타임 (postit.html):
 *  - document.fonts.ready 후 assets/ 폰트가 loaded 이고 본문 computed font-family 로 사용됨
 *  - 보드의 computed background-image 가 assets/ 질감을 가리킴 (파일 ≥ 5KB, 렌더 영역 ≥ 100×100px)
 * 전 테스트 공통: dialog 0건.
 * assets/ 또는 postit.html 부재 시 크래시 없이 한국어 메시지로 즉시 실패 (3단계 예정).
 */
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const { test, expect } = require('@playwright/test');
const { APP_ROOT, POSTIT_PATH, requirePostit, withFreshApp } = require('../lib/helpers');

const ASSETS_DIR = path.join(APP_ROOT, 'assets');
const ASSETS_MD = path.join(ASSETS_DIR, 'ASSETS.md');
const BOARD_SEL = '[data-board], #board, .board, [data-role="board"]';

/* 개인 사용 허용 라이선스 식별자 (SCORECARD A10 허용 목록) */
const LICENSE_ALLOW = [
  /\bCC0\b/i,
  /public\s*domain/i,
  /퍼블릭\s*도메인/,
  /\bOFL\b/i,
  /SIL\s+Open\s+Font\s+License/i,
  /\bMIT\b/,
  /\bCC[\s-]?BY(?:[\s-]?(?:SA|NC|ND|NC[\s-]?SA|NC[\s-]?ND))?(?:[\s-]?\d(?:\.\d)?)?\b/i,
  /\bUnlicense\b/i,
  /\bWTFPL\b/i,
  /\bApache(?:[\s-]?2(?:\.0)?)?\b/i,
];
const LICENSE_DENY = [/불명/, /\bunknown\b/i, /미상/, /^\s*$/];

function requireAssets() {
  if (!fs.existsSync(ASSETS_DIR)) {
    throw new Error('assets/ 폴더가 없습니다 — 장식 에셋 미구현 (3단계 예정): ' + ASSETS_DIR);
  }
  if (!fs.existsSync(ASSETS_MD)) {
    throw new Error('assets/ASSETS.md 가 없습니다 — 에셋 출처·라이선스 표 미작성 (3단계 예정): ' + ASSETS_MD);
  }
}

/** assets/ 하위 전 파일의 상대경로 목록 (ASSETS.md 자신 제외, 슬래시 정규화) */
function listAssetFiles(dir, base) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push(...listAssetFiles(full, base));
    else {
      const rel = path.relative(base, full).replace(/\\/g, '/');
      if (rel.toLowerCase() !== 'assets.md') out.push(rel);
    }
  }
  return out;
}

/**
 * ASSETS.md 마크다운 표 파싱 → [{file, url, license, line}]
 * 형식: | 파일명 | 출처 URL | 라이선스 | (헤더·구분선 행 제외, 백틱·굵게 마크 제거)
 */
function parseAssetsTable(mdText) {
  const rows = [];
  const lines = mdText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) continue;
    const cells = line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.replace(/`/g, '').replace(/\*\*/g, '').trim());
    if (cells.length < 3) continue;
    if (/^:?-{2,}:?$/.test(cells[0])) continue; // 구분선 |---|---|---|
    if (/파일|^file/i.test(cells[0]) && /라이선스|license/i.test(cells[2])) continue; // 헤더 ("파일"/"파일명"/"File" 모두)
    rows.push({
      file: cells[0].replace(/\\/g, '/').replace(/^\.?\/*/, '').replace(/^assets\//i, ''),
      url: cells[1],
      license: cells[2],
      line: i + 1,
    });
  }
  return rows;
}

function assertNoDialog(state) {
  expect(
    state.dialogs,
    `dialog ${state.dialogs.length}건 발생 (0건이어야 함): ${state.dialogs.map((d) => d.type + ':' + d.message).join(' | ')}`
  ).toHaveLength(0);
}

test.describe('A10 에셋 라이선스·번들', () => {
  test('A10: assets/ 전 파일 ↔ ASSETS.md 표 전수 일치 + 라이선스 허용 목록 매치', () => {
    requireAssets();

    const files = listAssetFiles(ASSETS_DIR, ASSETS_DIR);
    const rows = parseAssetsTable(fs.readFileSync(ASSETS_MD, 'utf8'));
    const problems = [];

    expect(
      rows.length,
      'ASSETS.md 에서 마크다운 표 행(파일명|출처 URL|라이선스)을 하나도 찾지 못했습니다'
    ).toBeGreaterThanOrEqual(1);

    const rowFiles = new Set(rows.map((r) => r.file.toLowerCase()));
    const realFiles = new Set(files.map((f) => f.toLowerCase()));

    for (const f of files) {
      if (!rowFiles.has(f.toLowerCase())) problems.push(`assets/${f}: ASSETS.md 표에 항목이 없습니다`);
    }
    for (const r of rows) {
      if (!realFiles.has(r.file.toLowerCase()))
        problems.push(`ASSETS.md ${r.line}행 "${r.file}": 해당 파일이 assets/ 에 존재하지 않습니다`);
    }
    for (const r of rows) {
      if (!r.url || LICENSE_DENY.some((re) => re.test(r.url)))
        problems.push(`ASSETS.md ${r.line}행 "${r.file}": 출처 URL 이 비었거나 '불명'입니다 (값: "${r.url}")`);
      const denied = LICENSE_DENY.some((re) => re.test(r.license));
      const allowed = !denied && LICENSE_ALLOW.some((re) => re.test(r.license));
      if (!allowed)
        problems.push(
          `ASSETS.md ${r.line}행 "${r.file}": 라이선스 "${r.license}" 가 허용 목록(CC0·Public Domain·OFL·MIT·CC BY 등)에 매치하지 않습니다`
        );
    }

    expect(
      problems,
      `에셋 라이선스·표 불일치 ${problems.length}건:\n` + problems.map((p) => '  - ' + p).join('\n')
    ).toEqual([]);
  });

  test('A10: 런타임 — assets/ 폰트 loaded·본문 사용 + 보드 배경 assets/ 질감(≥5KB, ≥100×100px)', async () => {
    requireAssets();
    requirePostit();

    await withFreshApp(POSTIT_PATH, async ({ page, state }) => {
      const res = await page.evaluate(async (B) => {
        await document.fonts.ready;

        // 문서 내 @font-face 규칙 수집 (src 에 assets/ 포함 여부)
        const faces = [];
        for (const sheet of Array.from(document.styleSheets)) {
          let rules = null;
          try { rules = sheet.cssRules; } catch (e) { continue; }
          if (!rules) continue;
          for (const r of Array.from(rules)) {
            if (r.type === CSSRule.FONT_FACE_RULE) {
              faces.push({
                family: (r.style.getPropertyValue('font-family') || '').replace(/^["']|["']$/g, '').trim(),
                src: r.style.getPropertyValue('src') || '',
              });
            }
          }
        }

        const bodyFamRaw = getComputedStyle(document.body).fontFamily || '';
        const bodyFam = (bodyFamRaw.split(',')[0] || '').replace(/^["']|["']$/g, '').trim();
        let bodyFontLoaded = false;
        try { bodyFontLoaded = document.fonts.check('12px "' + bodyFam + '"'); } catch (e) {}

        const board = document.querySelector(B);
        let boardBg = null;
        let boardRect = null;
        if (board) {
          boardBg = getComputedStyle(board).backgroundImage;
          const r = board.getBoundingClientRect();
          boardRect = { width: r.width, height: r.height };
        }
        return { faces, bodyFam, bodyFontLoaded, boardBg, boardRect };
      }, BOARD_SEL);

      // 폰트: 본문 1순위 패밀리가 assets/ 를 가리키는 @font-face 이고 loaded
      const face = res.faces.find(
        (f) => f.family && f.family.toLowerCase() === res.bodyFam.toLowerCase() && /assets\//i.test(f.src)
      );
      expect(
        !!face,
        `본문 computed font-family "${res.bodyFam}" 가 assets/ 를 가리키는 @font-face 로 resolve 되지 않습니다 ` +
          `(발견된 @font-face: ${res.faces.map((f) => `${f.family}←${f.src}`).join(' | ') || '없음'})`
      ).toBe(true);
      expect(
        res.bodyFontLoaded,
        `본문 폰트 "${res.bodyFam}" 가 document.fonts.ready 후에도 loaded 상태가 아닙니다`
      ).toBe(true);

      // 질감: 보드 computed background-image → assets/ 파일 (≥5KB) + 렌더 영역 ≥ 100×100px
      expect(res.boardBg, '보드 요소([data-board]/#board/.board)를 찾을 수 없습니다').not.toBeNull();
      const um = /url\(["']?([^"')]+)["']?\)/i.exec(res.boardBg || '');
      expect(
        um && /assets\//i.test(um[1]),
        `보드의 computed background-image 가 assets/ 질감을 가리키지 않습니다 (현재: ${res.boardBg})`
      ).toBeTruthy();

      let texturePath = null;
      try {
        texturePath = um[1].startsWith('file:') ? fileURLToPath(um[1]) : null;
      } catch (e) {
        texturePath = null;
      }
      expect(
        texturePath && fs.existsSync(texturePath),
        `보드 질감 파일을 로컬 assets/ 에서 찾을 수 없습니다 (URL: ${um && um[1]})`
      ).toBeTruthy();
      const size = fs.statSync(texturePath).size;
      expect(
        size,
        `보드 질감 파일이 ${size} 바이트입니다 (5KB = 5120 바이트 이상이어야 함): ${texturePath}`
      ).toBeGreaterThanOrEqual(5 * 1024);
      expect(
        res.boardRect && res.boardRect.width >= 100 && res.boardRect.height >= 100,
        `질감 렌더 영역이 ${res.boardRect && Math.round(res.boardRect.width)}×${res.boardRect && Math.round(res.boardRect.height)}px 입니다 (100×100px 이상이어야 함)`
      ).toBe(true);

      assertNoDialog(state);
    });
  });
});
