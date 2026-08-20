'use strict';
/**
 * A49 — Electron 보안 3중 검증 (SCORECARD rev.6 A49)
 *
 * ── REQUIRED CONTRACT (rev.6 — 이 주석이 정본, 구현을 여기에 맞춘다) ──
 * ① 렌더러: _electron.launch(개발 트리, PETIT_USERDATA=fresh tmpdir 격리)로 기동한
 *    두 창(calendar.html·postit.html) 각각에서 evaluate 로
 *    `typeof require === 'undefined' && typeof process === 'undefined'` 관찰.
 * ② main 정적: electron/main.js(주석 제거 후)에
 *    nodeIntegration:true · contextIsolation:false · sandbox:false · webSecurity:false ·
 *    allowRunningInsecureContent:true · webviewTag:true · loadURL(http(s) 리터럴) 0건 +
 *    setWindowOpenHandler deny-all 존재 + will-navigate 외부 차단(preventDefault) 존재.
 * ③ preload 정적: electron/preload.js(또는 main.js 가 참조하는 preload)가
 *    contextBridge.exposeInMainWorld 로 "이름 붙은 채널 화이트리스트 API만" 노출 —
 *    require/fs/child_process/ipcRenderer 원본 노출 0건, ipcRenderer 호출의 채널 인자는
 *    전부 문자열 리터럴(호출자 지정 채널 패스스루 금지), 무검증 shell.openExternal 노출 0건.
 *    require 는 electron·path·url(node: 접두 포함)만 허용.
 *
 * fail-closed: 셸/preload 부재 = 크래시 없이 "electron 셸 미구축 (2단계 진행 중)" 류
 * 한국어 메시지로 즉시 FAIL — skip-pass 금지.
 *
 * rev.7 추가 (기존 검사 약화 없음 — 검사 대상 확대만):
 *  - ①에 탭바 렌더러 검사 추가: 병합 셸의 탭바(WebContentsView, electron/tabbar.html)
 *    페이지가 열려 있으면 동일하게 typeof require/process === "undefined" 를 관찰한다
 *    (뷰 페이지는 app.windows() 에 노출 — electron-helpers rev.7 실측 주석 참조).
 *  - ③의 preload 검사 대상에 electron/tabbar-preload.js 를 추가한다 (존재 시 —
 *    화이트리스트·채널 리터럴·원본 노출 금지 규칙 동일 적용).
 */
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
  ELECTRON_DIR,
  ELECTRON_MAIN_JS,
  ELECTRON_PRELOAD_JS,
  ELECTRON_TABBAR_PRELOAD,
  SHELL_MISSING_MSG,
  stripJsComments,
  withShell,
  waitForAppWindows,
} = require('../lib/electron-helpers');

function requireMainJs() {
  if (!fs.existsSync(ELECTRON_MAIN_JS)) {
    throw new Error(`electron/main.js 부재 — ${SHELL_MISSING_MSG}: ${ELECTRON_MAIN_JS}`);
  }
  return stripJsComments(fs.readFileSync(ELECTRON_MAIN_JS, 'utf8'));
}

/** preload 후보: electron/preload.js + tabbar-preload.js(rev.7) + main.js 가 preload: 로 참조하는 *.js (실존만) */
function findPreloadFiles() {
  const found = new Set();
  if (fs.existsSync(ELECTRON_PRELOAD_JS)) found.add(ELECTRON_PRELOAD_JS);
  if (fs.existsSync(ELECTRON_TABBAR_PRELOAD)) found.add(ELECTRON_TABBAR_PRELOAD); // rev.7 추가 (존재 시)
  if (fs.existsSync(ELECTRON_MAIN_JS)) {
    const src = stripJsComments(fs.readFileSync(ELECTRON_MAIN_JS, 'utf8'));
    const re = /['"`]([^'"`]*preload[^'"`]*\.js)['"`]/gi;
    let m;
    while ((m = re.exec(src))) {
      const abs = path.isAbsolute(m[1]) ? m[1] : path.join(ELECTRON_DIR, m[1]);
      if (fs.existsSync(abs)) found.add(abs);
    }
  }
  return Array.from(found);
}

/** exposeInMainWorld( … ) 호출의 괄호 균형 인자 구간 추출 */
function extractExposeCalls(src) {
  const calls = [];
  let idx = 0;
  for (;;) {
    const at = src.indexOf('exposeInMainWorld', idx);
    if (at < 0) break;
    const open = src.indexOf('(', at);
    if (open < 0) break;
    let depth = 0;
    let end = -1;
    for (let i = open; i < src.length; i++) {
      const c = src[i];
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) break;
    calls.push(src.slice(open + 1, end));
    idx = end + 1;
  }
  return calls;
}

test.describe('A49 Electron 보안 3중 검증', () => {
  test('A49: ① 렌더러 격리 — 두 창 모두 typeof require/process === "undefined"', async () => {
    test.setTimeout(150 * 1000);
    await withShell(async ({ app }) => {
      const win = await waitForAppWindows(app, 2, 60 * 1000);
      expect(
        win.calendar,
        '캘린더 창(calendar.html)을 찾지 못했습니다 — 열린 창: ' + win.all.map((p) => p.url()).join(', ')
      ).toBeTruthy();
      expect(
        win.postit,
        '포스트잇 창(postit.html)을 찾지 못했습니다 — 열린 창: ' + win.all.map((p) => p.url()).join(', ')
      ).toBeTruthy();

      // rev.7 추가: 탭바 렌더러(WebContentsView, electron/tabbar.html)가 열려 있으면 동일 검사
      // (병합 셸 여부는 A42 가 판정 — 여기서는 '노출된 렌더러 전부의 격리'만 판정한다)
      const tabbarPage =
        app.windows().find((p) => {
          try {
            return /\/tabbar\.html$/i.test((p.url() || '').split(/[?#]/)[0]);
          } catch (e) {
            return false;
          }
        }) || null;
      const targets = [['캘린더', win.calendar], ['포스트잇', win.postit]];
      if (tabbarPage) targets.push(['탭바', tabbarPage]);

      for (const [label, pg] of targets) {
        const r = await pg.evaluate(() => ({ req: typeof require, proc: typeof process }));
        expect(
          r.req,
          `${label} 창 렌더러에서 typeof require === "${r.req}" — "undefined" 여야 합니다 ` +
            '(nodeIntegration 누출: contextIsolation·sandbox 기본선 위반, A49①)'
        ).toBe('undefined');
        expect(
          r.proc,
          `${label} 창 렌더러에서 typeof process === "${r.proc}" — "undefined" 여야 합니다 ` +
            '(Node 전역 누출: 렌더러 격리 위반, A49①)'
        ).toBe('undefined');
      }
    });
  });

  test('A49: ② main 정적 — 위험 플래그·http loadURL 0건 + setWindowOpenHandler deny + will-navigate 차단', () => {
    const src = requireMainJs();
    const problems = [];

    const FORBIDDEN = [
      [/nodeIntegration\s*:\s*true/, 'nodeIntegration: true'],
      [/contextIsolation\s*:\s*false/, 'contextIsolation: false'],
      [/sandbox\s*:\s*false/, 'sandbox: false'],
      [/webSecurity\s*:\s*false/, 'webSecurity: false'],
      [/allowRunningInsecureContent\s*:\s*true/, 'allowRunningInsecureContent: true'],
      [/webviewTag\s*:\s*true/, 'webviewTag: true'],
      [/loadURL\s*\(\s*['"`]https?:/i, 'loadURL(http(s) 리터럴)'],
    ];
    for (const [re, label] of FORBIDDEN) {
      if (re.test(src)) problems.push(`금지 패턴 발견: ${label} (A49② — 0건이어야 함)`);
    }

    if (!/setWindowOpenHandler[\s\S]{0,300}?['"`]deny['"`]/.test(src)) {
      problems.push('setWindowOpenHandler deny-all 이 없습니다 (새 창 열기 전면 거부 필요, A49②)');
    }
    if (!/['"`]will-navigate['"`][\s\S]{0,500}?preventDefault/.test(src)) {
      problems.push('will-navigate 외부 항해 차단(preventDefault)이 없습니다 (A49②)');
    }

    expect(
      problems,
      `A49② main 정적 검사 실패 ${problems.length}건 (electron/main.js):\n` +
        problems.map((p) => '  - ' + p).join('\n')
    ).toEqual([]);
  });

  test('A49: ③ preload 정적 — contextBridge 화이트리스트만 노출 (원본·무검증 노출 0건)', () => {
    const preloads = findPreloadFiles();
    expect(
      preloads.length > 0,
      `electron/preload.js 부재 — ${SHELL_MISSING_MSG}: window.petit 계약(migrate/license/onboarding)을 ` +
        'contextBridge 화이트리스트로 노출하는 preload 가 필요합니다 (fail-closed FAIL)'
    ).toBe(true);

    const problems = [];
    for (const file of preloads) {
      const rel = path.relative(ELECTRON_DIR, file).replace(/\\/g, '/');
      const src = stripJsComments(fs.readFileSync(file, 'utf8'));

      // contextBridge 필수
      if (!/contextBridge/.test(src) || !/exposeInMainWorld/.test(src)) {
        problems.push(`${rel}: contextBridge.exposeInMainWorld 노출이 없습니다 (window.petit 계약 미구현)`);
      }

      // require 화이트리스트: electron · path · url (node: 접두 허용)
      const ALLOWED_REQUIRE = /^(?:node:)?(?:electron|path|url)$/;
      const reqRe = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      let m;
      while ((m = reqRe.exec(src))) {
        if (!ALLOWED_REQUIRE.test(m[1])) {
          problems.push(`${rel}: 화이트리스트 외 모듈 require("${m[1]}") — preload 는 electron·path·url 만 허용 (fs/child_process 등 금지, A49③)`);
        }
      }

      // 동적 require/원본 노출
      if (/window\s*\.\s*require\s*=/.test(src)) problems.push(`${rel}: window.require 원본 노출 금지 (A49③)`);
      for (const seg of extractExposeCalls(src)) {
        if (/(^|[{,\s(])ipcRenderer\s*[,})]/.test(seg) || /ipcRenderer\s*:\s*ipcRenderer/.test(seg)) {
          problems.push(`${rel}: exposeInMainWorld 에 ipcRenderer 원본 노출 — 이름 붙은 채널 래퍼만 허용 (A49③)`);
        }
        if (/(^|[{,\s(])require\s*[,})]/.test(seg) || /:\s*require\b/.test(seg)) {
          problems.push(`${rel}: exposeInMainWorld 에 require 노출 금지 (A49③)`);
        }
      }

      // 채널 화이트리스트: ipcRenderer 호출 1번째 인자는 전부 문자열 리터럴이어야 한다
      const ipcRe = /ipcRenderer\s*\.\s*(invoke|send|sendSync|on|once|removeListener|removeAllListeners|postMessage)\s*\(\s*([^\s)])/g;
      while ((m = ipcRe.exec(src))) {
        const firstChar = m[2];
        const isLiteral = firstChar === "'" || firstChar === '"';
        if (!isLiteral) {
          problems.push(
            `${rel}: ipcRenderer.${m[1]}(…) 채널 인자가 문자열 리터럴이 아닙니다 ` +
              `(호출자 지정 채널 패스스루 = god-object 금지, A49③): "…${src.slice(m.index, m.index + 60).replace(/\s+/g, ' ')}…"`
          );
        }
      }

      // 무검증 shell.openExternal
      if (/openExternal/.test(src) && !/startsWith|new\s+URL|허용\s*목록|allowlist|whitelist/i.test(src)) {
        problems.push(`${rel}: 무검증 shell.openExternal 노출 — URL 검증(허용 목록) 없는 노출 금지 (A49③)`);
      }
    }

    expect(
      problems,
      `A49③ preload 정적 검사 실패 ${problems.length}건 (검사 파일: ${preloads
        .map((p) => path.relative(ELECTRON_DIR, p))
        .join(', ')}):\n` + problems.map((p) => '  - ' + p).join('\n')
    ).toEqual([]);
  });
});
