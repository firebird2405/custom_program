'use strict';
/**
 * A48 — 스토어 심사·자산 정적 검사 (SCORECARD rev.6 A48)
 *
 * ── REQUIRED CONTRACT (rev.6 — 이 주석이 정본, 구현을 여기에 맞춘다) ──
 * ① 아이콘: electron/build/appx/ 에 실규격 세트 실존 + PNG IHDR 치수 일치 —
 *    StoreLogo.png(50×50) · Square44x44Logo.png(44×44) + targetsize-{16,24,32,48,256} 변형 ·
 *    Square150x150Logo.png(150×150) + scale-200(300×300) · Wide310x150Logo.png(310×150).
 *    플레이스홀더 차단: 각 아이콘 고유색(RGBA) 수 ≥ 8 (단색/2색 사각형 차단).
 *    main.js·electron-builder.yml 이 참조하는 아이콘 경로는 실파일이어야 한다.
 * ② 브랜드: 설정(package.json productName·electron-builder.yml productName/appx displayName 등)과
 *    스토어 패키지(.appx/.msix → zip 해제 → AppxManifest.xml)의 Identity·DisplayName 이
 *    확정 브랜드(쁘띠캘린더/PetitCalendar)를 포함 — MyApp 류 플레이스홀더 리터럴 금지.
 * ③ 개인정보처리방침 파일 존재(파일명에 privacy|개인정보) + "수집 0(수집하지 않음)" 명시
 *    (텔레메트리 0 판정은 A44 런타임 증명과 결합).
 * ④ 스토어 자산: store-assets/ 스크린샷 PNG ≥ 4장 — MS Store 데스크톱 규격 해상도
 *    (1366×768 ~ 3840×2160) · 한국어 설명문 ≥ 200자(비공백, 한글 ≥ 100자).
 * ⑤ 상업 라이선스: assets/ASSETS.md 전수(신규 스티커·스킨·아이콘 포함)가 상업 배포 허용
 *    식별자(CC0·Public Domain·OFL·MIT·CC BY)만 — NC/ND/불명 FAIL. 라이선스 고지 훅
 *    [data-licenses](셸 오버레이 또는 앱 정보 화면)가 존재하고 ASSETS.md 전수와 일치.
 *
 * fail-closed: 산출물·자산·훅 부재 = 크래시 없이 한국어 메시지로 즉시 FAIL
 * ("electron 셸 미구축 (2단계 진행 중)" / "3주차 예정" 류) — skip-pass 금지.
 */
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { APP_ROOT, CALENDAR_PATH, POSTIT_PATH, withFreshApp } = require('../lib/helpers');
const {
  ELECTRON_DIR,
  ELECTRON_MAIN_JS,
  ELECTRON_BUILDER_YML,
  ELECTRON_PKG_JSON,
  APPX_ICON_DIR,
  DIST_DIR,
  SHELL_MISSING_MSG,
  BRAND_RE,
  PLACEHOLDER_RE,
  pngSize,
  countPngUniqueColors,
  zipEntryText,
  listFilesRel,
  parseAssetsTable,
  commercialLicenseProblem,
  withShell,
  waitForAppWindows,
  electronExecutable,
} = require('../lib/electron-helpers');

const ASSETS_DIR = path.join(APP_ROOT, 'assets');
const ASSETS_MD = path.join(ASSETS_DIR, 'ASSETS.md');
const STORE_DIR = path.join(APP_ROOT, 'store-assets');

/** ① 실규격 아이콘 세트 (파일명 → 기대 치수) */
const REQUIRED_APPX_ICONS = [
  ['StoreLogo.png', 50, 50],
  ['Square44x44Logo.png', 44, 44],
  ['Square44x44Logo.targetsize-16.png', 16, 16],
  ['Square44x44Logo.targetsize-24.png', 24, 24],
  ['Square44x44Logo.targetsize-32.png', 32, 32],
  ['Square44x44Logo.targetsize-48.png', 48, 48],
  ['Square44x44Logo.targetsize-256.png', 256, 256],
  ['Square150x150Logo.png', 150, 150],
  ['Square150x150Logo.scale-200.png', 300, 300],
  ['Wide310x150Logo.png', 310, 150],
];
const MIN_UNIQUE_COLORS = 8;

/** 스토어 패키지(.appx/.msix) 나열 — 최신 우선 */
function findStorePackages() {
  if (!fs.existsSync(DIST_DIR)) return [];
  return listFilesRel(DIST_DIR)
    .filter((rel) => /\.(appx|msix|appxbundle|msixbundle)$/i.test(rel))
    .map((rel) => path.join(DIST_DIR, rel))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

/** YAML/JS 설정에서 아이콘 경로 참조 추출 → [{src, ref}] (electron/ 기준 상대 해석) */
function collectConfigIconRefs() {
  const refs = [];
  if (fs.existsSync(ELECTRON_BUILDER_YML)) {
    const yml = fs.readFileSync(ELECTRON_BUILDER_YML, 'utf8');
    for (const line of yml.split(/\r?\n/)) {
      const noComment = line.replace(/#.*$/, '');
      const m = /^\s*(icon|installerIcon|uninstallerIcon|installerHeaderIcon)\s*:\s*("([^"]+)"|'([^']+)'|(\S+))\s*$/.exec(noComment);
      if (m) refs.push({ src: 'electron-builder.yml', ref: (m[3] || m[4] || m[5] || '').trim() });
    }
  }
  if (fs.existsSync(ELECTRON_MAIN_JS)) {
    const mainSrc = fs.readFileSync(ELECTRON_MAIN_JS, 'utf8');
    const re = /icon\s*:\s*['"`]([^'"`]+\.(?:png|ico))['"`]/g;
    let m;
    while ((m = re.exec(mainSrc))) refs.push({ src: 'main.js', ref: m[1] });
  }
  return refs;
}

/** YAML 에서 값 필드 추출 (주석 제거 후 `key: value` 1건) */
function ymlValue(ymlText, key) {
  for (const line of ymlText.split(/\r?\n/)) {
    const noComment = line.replace(/#.*$/, '');
    const m = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`).exec(noComment);
    if (m) return m[1].replace(/^["']|["']$/g, '').trim();
  }
  return null;
}

test.describe('A48 스토어 심사·자산 정적 검사', () => {
  test('A48: ① 아이콘 실규격 세트(치수·고유색 ≥8) + 설정 아이콘 경로 실파일', () => {
    expect(
      fs.existsSync(APPX_ICON_DIR),
      `build/appx 아이콘 세트 미제작 — ${SHELL_MISSING_MSG}: ${APPX_ICON_DIR} 이(가) 없습니다 ` +
        '(A48① 계약: StoreLogo·Square44x44+targetsize 변형·Square150x150+scale-200·Wide310x150)'
    ).toBe(true);

    const problems = [];
    for (const [name, w, h] of REQUIRED_APPX_ICONS) {
      const p = path.join(APPX_ICON_DIR, name);
      if (!fs.existsSync(p)) {
        problems.push(`build/appx/${name}: 파일이 없습니다 (기대 치수 ${w}×${h})`);
        continue;
      }
      try {
        const size = pngSize(p);
        if (size.width !== w || size.height !== h) {
          problems.push(`build/appx/${name}: PNG IHDR 치수 ${size.width}×${size.height} — 기대 ${w}×${h} 와 다릅니다`);
        }
        const colors = countPngUniqueColors(p, 64);
        if (colors < MIN_UNIQUE_COLORS) {
          problems.push(
            `build/appx/${name}: 고유색 ${colors}종 — 하한 ${MIN_UNIQUE_COLORS}종 미만 (단색/플레이스홀더 아이콘 차단, A48①)`
          );
        }
      } catch (e) {
        problems.push(`build/appx/${name}: PNG 검사 실패 — ${(e && e.message) || e}`);
      }
    }

    const refs = collectConfigIconRefs();
    if (refs.length === 0) {
      problems.push('electron-builder.yml/main.js 에서 아이콘 경로 참조를 하나도 찾지 못했습니다 (win.icon 등 필요)');
    }
    for (const { src, ref } of refs) {
      const abs = path.isAbsolute(ref) ? ref : path.join(ELECTRON_DIR, ref);
      if (!fs.existsSync(abs)) problems.push(`${src} 아이콘 경로 "${ref}": 실파일이 없습니다 (${abs})`);
    }

    expect(
      problems,
      `A48① 아이콘 검사 실패 ${problems.length}건:\n` + problems.map((p) => '  - ' + p).join('\n')
    ).toEqual([]);
  });

  test('A48: ② 설정 브랜드 — productName 등이 쁘띠캘린더/PetitCalendar 포함 + 플레이스홀더 금지', () => {
    expect(
      fs.existsSync(ELECTRON_PKG_JSON) && fs.existsSync(ELECTRON_BUILDER_YML),
      `electron/package.json 또는 electron-builder.yml 부재 — ${SHELL_MISSING_MSG}`
    ).toBe(true);

    const problems = [];
    let pkg = null;
    try {
      pkg = JSON.parse(fs.readFileSync(ELECTRON_PKG_JSON, 'utf8'));
    } catch (e) {
      problems.push('electron/package.json 파싱 실패: ' + ((e && e.message) || e));
    }
    const yml = fs.readFileSync(ELECTRON_BUILDER_YML, 'utf8');

    // 브랜드 포함 필수 값 필드
    const brandFields = [
      ['package.json productName', pkg && pkg.productName],
      ['electron-builder.yml productName', ymlValue(yml, 'productName')],
      ['electron-builder.yml appx displayName', ymlValue(yml, 'displayName')],
    ];
    for (const [label, value] of brandFields) {
      if (!value) problems.push(`${label}: 값이 없습니다 (쁘띠캘린더/PetitCalendar 포함 필수)`);
      else if (!BRAND_RE.test(value)) {
        problems.push(`${label} = "${value}": 확정 브랜드(쁘띠캘린더/PetitCalendar)를 포함하지 않습니다`);
      }
    }

    // 플레이스홀더 리터럴 금지 (값 필드에만 적용 — 주석 제외)
    const placeholderFields = brandFields.concat([
      ['package.json name', pkg && pkg.name],
      ['electron-builder.yml appId', ymlValue(yml, 'appId')],
      ['electron-builder.yml executableName', ymlValue(yml, 'executableName')],
      ['electron-builder.yml applicationId', ymlValue(yml, 'applicationId')],
      ['electron-builder.yml shortcutName', ymlValue(yml, 'shortcutName')],
      ['electron-builder.yml identityName', ymlValue(yml, 'identityName')],
    ]);
    for (const [label, value] of placeholderFields) {
      if (value && PLACEHOLDER_RE.test(value)) {
        problems.push(`${label} = "${value}": MyApp 류 플레이스홀더 리터럴 금지 (A48②)`);
      }
    }

    expect(
      problems,
      `A48② 설정 브랜드 검사 실패 ${problems.length}건:\n` + problems.map((p) => '  - ' + p).join('\n')
    ).toEqual([]);
  });

  test('A48: ② 스토어 패키지 매니페스트(AppxManifest.xml) Identity·브랜드 일치', () => {
    test.skip(process.platform !== 'win32', 'Windows 전용(zip 해제 PowerShell) — 명시적 SKIP');
    const pkgs = findStorePackages();
    expect(
      pkgs.length > 0,
      `스토어 패키지(.appx/.msix) 미빌드 — 3주차 빌드 전이므로 A48② 매니페스트 검사를 진행할 수 없습니다 ` +
        `(fail-closed FAIL): ${DIST_DIR} 에서 .appx/.msix 를 찾지 못했습니다`
    ).toBe(true);

    const pkg = pkgs[0];
    const manifest = zipEntryText(pkg, 'AppxManifest.xml');
    expect(manifest, `패키지에 AppxManifest.xml 이 없습니다 (손상/비표준 패키지): ${pkg}`).toBeTruthy();

    const problems = [];
    const idName = (/<Identity[^>]*?\bName\s*=\s*"([^"]*)"/.exec(manifest) || [])[1] || '';
    const idPublisher = (/<Identity[^>]*?\bPublisher\s*=\s*"([^"]*)"/.exec(manifest) || [])[1] || '';
    const displayNames = [];
    let m;
    const dnRe = /<DisplayName>([^<]*)<\/DisplayName>/g;
    while ((m = dnRe.exec(manifest))) displayNames.push(m[1]);
    const veRe = /DisplayName\s*=\s*"([^"]*)"/g;
    while ((m = veRe.exec(manifest))) displayNames.push(m[1]);

    if (!idName) problems.push('AppxManifest.xml Identity Name 이 비어 있습니다');
    if (!/^CN=/.test(idPublisher)) problems.push(`Identity Publisher "${idPublisher}" 가 CN= 형식이 아닙니다`);
    for (const [label, v] of [['Identity Name', idName], ['Identity Publisher', idPublisher]]) {
      if (v && PLACEHOLDER_RE.test(v)) problems.push(`${label} = "${v}": 플레이스홀더 리터럴 금지 (A48②)`);
    }
    const realNames = displayNames.filter((d) => d && !/^ms-resource:/i.test(d));
    if (realNames.length === 0) {
      problems.push('매니페스트에서 리터럴 DisplayName 을 찾지 못했습니다 (ms-resource 간접 참조만 존재)');
    } else if (!realNames.some((d) => BRAND_RE.test(d)) && !/petitcalendar/i.test(idName)) {
      problems.push(
        `DisplayName [${realNames.join(', ')}] / Identity Name "${idName}" 어느 것도 ` +
          '확정 브랜드(쁘띠캘린더/PetitCalendar)를 포함하지 않습니다'
      );
    }
    for (const d of realNames) {
      if (PLACEHOLDER_RE.test(d)) problems.push(`DisplayName = "${d}": 플레이스홀더 리터럴 금지 (A48②)`);
    }

    expect(
      problems,
      `A48② 매니페스트 검사 실패 ${problems.length}건 (패키지: ${path.basename(pkg)}):\n` +
        problems.map((p) => '  - ' + p).join('\n')
    ).toEqual([]);
  });

  test('A48: ③ 개인정보처리방침 — 파일 존재 + 수집 0 명시', () => {
    // 후보: 루트/electron/store-assets 하위, 파일명에 privacy 또는 개인정보 (.md/.txt/.html)
    const candidates = [];
    const scanDirs = [APP_ROOT, ELECTRON_DIR, STORE_DIR].filter((d) => fs.existsSync(d));
    for (const dir of scanDirs) {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (!fs.statSync(full).isFile()) continue;
        if (/privacy|개인정보/i.test(name) && /\.(md|txt|html?)$/i.test(name)) candidates.push(full);
      }
    }
    expect(
      candidates.length > 0,
      '개인정보처리방침 파일이 없습니다 (3주차 예정 — fail-closed FAIL): ' +
        '루트/electron/store-assets 에서 파일명에 privacy|개인정보 를 포함한 .md/.txt/.html 을 찾지 못했습니다 ' +
        `(검색 위치: ${scanDirs.join(' , ')})`
    ).toBe(true);

    const ZERO_RE = /수집\s*하지\s*않|수집하지\s*않|수집\s*0|수집하는\s*(?:개인\s*)?정보(?:가|는)?\s*없|어떠한\s*(?:개인\s*)?정보도\s*수집하지\s*않/;
    const ok = candidates.some((p) => {
      const text = fs.readFileSync(p, 'utf8');
      return /개인\s*정보|개인정보/.test(text) && ZERO_RE.test(text);
    });
    expect(
      ok,
      `개인정보처리방침 후보(${candidates.map((p) => path.relative(APP_ROOT, p)).join(', ')})에서 ` +
        '"개인정보" + "수집 0(수집하지 않음)" 명시 문구를 찾지 못했습니다 (A48③ — 텔레메트리 0 판정은 A44 와 결합)'
    ).toBe(true);
  });

  test('A48: ④ 스토어 자산 — 스크린샷 ≥4장(규격 해상도) + 한국어 설명문 ≥200자', () => {
    expect(
      fs.existsSync(STORE_DIR),
      `store-assets/ 미작성 — 3주차 예정 (fail-closed FAIL): ${STORE_DIR} 이(가) 없습니다 ` +
        '(계약: 규격 해상도 스크린샷 PNG ≥ 4장 + 한국어 설명문 ≥ 200자)'
    ).toBe(true);

    const all = listFilesRel(STORE_DIR);
    const problems = [];

    // 스크린샷: PNG, MS Store 데스크톱 규격(1366×768 ~ 3840×2160)
    const pngs = all.filter((rel) => /\.png$/i.test(rel));
    let conforming = 0;
    const details = [];
    for (const rel of pngs) {
      try {
        const { width, height } = pngSize(path.join(STORE_DIR, rel));
        const ok = width >= 1366 && width <= 3840 && height >= 768 && height <= 2160;
        details.push(`${rel}: ${width}×${height}${ok ? '' : ' (규격 밖)'}`);
        if (ok) conforming++;
      } catch (e) {
        details.push(`${rel}: PNG 파싱 실패 — ${(e && e.message) || e}`);
      }
    }
    if (conforming < 4) {
      problems.push(
        `규격 해상도(1366×768 ~ 3840×2160) 스크린샷 PNG 가 ${conforming}장 — 4장 이상 필요. ` +
          `관찰: ${details.join(' | ') || '(store-assets/ 에 PNG 없음)'}`
      );
    }

    // 한국어 설명문: .md/.txt 중 비공백 ≥ 200자 + 한글 ≥ 100자
    const texts = all.filter((rel) => /\.(md|txt)$/i.test(rel));
    const descOk = texts.some((rel) => {
      const t = fs.readFileSync(path.join(STORE_DIR, rel), 'utf8');
      const nonWs = t.replace(/\s+/g, '').length;
      const hangul = (t.match(/[가-힣]/g) || []).length;
      return nonWs >= 200 && hangul >= 100;
    });
    if (!descOk) {
      problems.push(
        `한국어 설명문(.md/.txt, 비공백 ≥ 200자·한글 ≥ 100자)을 store-assets/ 에서 찾지 못했습니다 ` +
          `(발견된 텍스트 파일: ${texts.join(', ') || '없음'})`
      );
    }

    expect(
      problems,
      `A48④ 스토어 자산 검사 실패 ${problems.length}건:\n` + problems.map((p) => '  - ' + p).join('\n')
    ).toEqual([]);
  });

  test('A48: ⑤ 상업 라이선스 — ASSETS.md 전수 상업 배포 허용 + [data-licenses] 고지 전수 일치', async () => {
    test.setTimeout(180 * 1000); // 앱/셸 기동 포함

    expect(fs.existsSync(ASSETS_MD), `assets/ASSETS.md 가 없습니다: ${ASSETS_MD}`).toBe(true);
    const rows = parseAssetsTable(fs.readFileSync(ASSETS_MD, 'utf8'));
    expect(rows.length, 'ASSETS.md 에서 표 행(파일명|출처 URL|라이선스)을 찾지 못했습니다').toBeGreaterThanOrEqual(1);

    const problems = [];

    // 전수 일치 (a10 동형) + 상업 배포 허용 판정 (rev.6 문언 개정: "개인 사용 허용" → "상업 배포 허용 명시")
    const files = listFilesRel(ASSETS_DIR).filter((f) => f.toLowerCase() !== 'assets.md');
    const rowFiles = new Set(rows.map((r) => r.file.toLowerCase()));
    const realFiles = new Set(files.map((f) => f.toLowerCase()));
    for (const f of files) {
      if (!rowFiles.has(f.toLowerCase())) problems.push(`assets/${f}: ASSETS.md 표에 항목이 없습니다`);
    }
    for (const r of rows) {
      if (!realFiles.has(r.file.toLowerCase())) {
        problems.push(`ASSETS.md ${r.line}행 "${r.file}": 해당 파일이 assets/ 에 없습니다`);
      }
      const why = commercialLicenseProblem(r.license);
      if (why) problems.push(`ASSETS.md ${r.line}행 "${r.file}": ${why}`);
    }

    // [data-licenses] 고지 — 앱 정보 화면(file://) 우선, 없으면 Electron 셸 오버레이에서 탐색
    let notice = null;
    let where = null;
    for (const [label, htmlPath] of [['postit.html', POSTIT_PATH], ['calendar.html', CALENDAR_PATH]]) {
      if (notice !== null || !fs.existsSync(htmlPath)) continue;
      const got = await withFreshApp(htmlPath, async ({ page }) => {
        return page.evaluate(() => {
          const el = document.querySelector('[data-licenses]');
          return el ? el.textContent || '' : null;
        });
      });
      if (got !== null) {
        notice = got;
        where = label + ' (file:// 앱 정보)';
      }
    }
    if (notice === null && fs.existsSync(path.join(ELECTRON_DIR, 'main.js')) && electronExecutable()) {
      try {
        await withShell(async ({ app }) => {
          const win = await waitForAppWindows(app, 2, 30 * 1000);
          for (const pg of win.all) {
            const got = await pg
              .evaluate(() => {
                const el = document.querySelector('[data-licenses]');
                return el ? el.textContent || '' : null;
              })
              .catch(() => null);
            if (got !== null) {
              notice = got;
              where = 'electron 셸 오버레이 (' + pg.url() + ')';
              break;
            }
          }
        });
      } catch (e) {
        problems.push(`[data-licenses] 탐색 중 electron 셸 기동 실패: ${(e && e.message) || e}`);
      }
    }

    if (notice === null) {
      problems.push(
        '[data-licenses] 라이선스 고지 훅이 어디에도 없습니다 — 셸 오버레이 또는 앱 정보 화면에 필요 ' +
          `(fail-closed: 훅 부재 = FAIL, ${SHELL_MISSING_MSG})`
      );
    } else {
      for (const r of rows) {
        const base = r.file.split('/').pop();
        if (!notice.includes(base)) {
          problems.push(`[data-licenses] 고지(${where})에 ASSETS.md 항목 "${base}" 이(가) 없습니다 (전수 일치 필요)`);
        }
      }
    }

    expect(
      problems,
      `A48⑤ 상업 라이선스 검사 실패 ${problems.length}건:\n` + problems.map((p) => '  - ' + p).join('\n')
    ).toEqual([]);
  });
});
