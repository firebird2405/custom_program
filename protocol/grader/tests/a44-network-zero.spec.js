'use strict';
/**
 * A44 — 외부 요청 0 (SCORECARD rev.6: 출시 트랙)
 * "감시 범위 = 렌더러 전 세션 + main 프로세스 + 모든 자식 프로세스:
 *  ① electronApp.evaluate 로 defaultSession+전 파티션 webRequest 카운터 설치 → 대표 시나리오
 *     조작 → http(s) 0건,
 *  ② main·preload 정적 검사 — http/https/net/dns/dgram/tls require·net.request·autoUpdater 0건,
 *  ③ 실행 중 앱 PID 트리 아웃바운드 소켓 OS 레벨(netstat) 0건.
 *  (각주: MS Store 결제·업데이트는 WinRT 브로커/스토어 프로세스 소관 — 앱 내 통신 0과 양립)"
 *
 * ── REQUIRED CONTRACT (rev.6 — 이 주석이 판정 방식의 정본, rev.5 관례) ──
 *  - ① 카운터는 조작 "이전"에 defaultSession + 기존 webContents 의 전 세션 + 이후 생성되는
 *    세션(app 'session-created')에 설치한다. 채점기는 네트워크를 차단하지 않는다 — 요청이
 *    실제로 나가려는 순간을 세어 0건을 요구한다 (http/https 만 집계, file:// 는 무관).
 *    대표 조작: 포스트잇 노트 생성·입력·드래그 + 캘린더 일정 추가 + 양 창 재로드.
 *    보조 관찰: Playwright page 'request' 이벤트의 http(s) 0건.
 *  - ② 정적 검사 대상: electron\ 루트 하위 셸 소스 전체(*.js·*.mjs·*.cjs, node_modules·
 *    dist·build·out 제외 — preload.js·migrate.js 가 생기면 자동 포함). 주석·문자열을
 *    lib/static-checks 토크나이저로 처리해 오탐을 막고, 코드로서의
 *    require/import('http'|'https'|'net'|'dns'|'dgram'|'tls'(node: 접두 포함)) ·
 *    net.request( · autoUpdater 식별자 사용을 0건으로 요구한다.
 *  - ③ netstat -ano 의 TCP 행 중 "앱 PID 트리(루트+전 자식)" 소유·LISTENING 외 상태·
 *    원격 주소가 루프백(127.* 또는 [::1])이나 미지정(0.0.0.0·[::]·별표)이 아닌 행 = 아웃바운드로
 *    판정, 2회 샘플(즉시·2.5초 후) 합집합 0건. (Playwright 채점 연결은 루프백이라 제외됨.)
 *  - fail-closed: 셸 미구축 시 "electron 셸 미구축 (2단계 진행 중)" 한국어 FAIL.
 *    SKIP 은 비 Windows(①③ — netstat/electron.exe 경로가 Windows 전용) 뿐.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, expect } = require('@playwright/test');
const {
  requirePostit,
  removeDirWithRetry,
  pollLocalStorage,
  pollPage,
  sleep,
  POSTIT_SEL,
  assertNoDialogs,
  addNote,
  setNoteText,
  pollVisibleNoteCount,
  dragNoteTo,
} = require('../lib/helpers');
const {
  ELECTRON_DIR,
  ELECTRON_MAIN,
  requireElectronShell,
  freshUserDataDir,
  launchElectronShell,
  getBothAppWindows,
  closeElectronShell,
  dismissOnboardingIfPresent,
  dismissMigrateIfPresent,
  calDayCell,
  calAddViaForm,
} = require('../lib/electron-helpers');
const { tokenize, stripHtmlComments } = require('../lib/static-checks');

// PATH 섀도잉 차단 — 시스템 도구는 절대 경로로만 실행 (SCORECARD B 실행 환경 후킹 금지)
const SYSTEM32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const POWERSHELL_EXE = path.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const NETSTAT_EXE = path.join(SYSTEM32, 'NETSTAT.EXE');

const CONTAINS_FN = (m) => Object.keys(localStorage).some((k) => (localStorage.getItem(k) || '').includes(m));

/** 대표 시나리오 조작 (포스트잇 + 캘린더 + 재로드) — ①·③ 공용 */
async function representativeOps(calPage, postitPage, label) {
  const M = 'A44-' + label + '-대표조작-노트';
  const E = 'A44-' + label + '-대표조작-일정';
  await addNote(postitPage);
  await pollVisibleNoteCount(postitPage, 1, 5000, 'A44 ' + label);
  await setNoteText(postitPage, postitPage.locator(POSTIT_SEL.NOTE).first(), M);
  await pollPage(postitPage, CONTAINS_FN, M, 5000, `A44 ${label}: 노트가 localStorage 에 저장되지 않았습니다 (대표 조작 실패)`);
  await dragNoteTo(postitPage, 0, { x: 240, y: 200 });
  await calDayCell(calPage, 12).click();
  await calAddViaForm(calPage, '10:30', E);
  await pollLocalStorage(calPage, 'cal-events', (raw) => !!raw && raw.includes(E), 5000);
  await postitPage.reload({ waitUntil: 'load' });
  await calPage.reload({ waitUntil: 'load' });
  await sleep(2000);
}

test.describe('A44 외부 요청 0', () => {
  test('A44: ① 전 세션 webRequest 카운터 — 대표 조작·재로드 후 http(s) 0건', async () => {
    test.setTimeout(240 * 1000);
    test.skip(process.platform !== 'win32', 'Windows 전용 항목 — A44 ① 을 명시적으로 SKIP 합니다 (rev.5 관례)');
    requireElectronShell('A44');
    requirePostit();
    const dir = freshUserDataDir();
    let shell = null;
    try {
      shell = await launchElectronShell(dir, { label: 'A44' });
      const { calPage, postitPage } = await getBothAppWindows(shell, 'A44');
      for (const p of [postitPage, calPage]) {
        await dismissOnboardingIfPresent(p, 'A44');
        await dismissMigrateIfPresent(p, 'A44');
      }

      // 카운터 설치: defaultSession + 기존 webContents 전 세션 + 이후 생성 세션
      const installed = await shell.app.evaluate(({ app, session, webContents }) => {
        globalThis.__a44 = { count: 0, urls: [] };
        const hooked = new Set();
        // 감사 수정(2026-08-19): 설치 "성공"만 계수한다 — 이전 판은 hooked.add 가 try 앞이라
        // onBeforeRequest 가 throw 해도 설치된 것으로 세어 공허 통과 여지가 있었다 (fail-open 차단).
        const hook = (sess) => {
          if (!sess || hooked.has(sess)) return false;
          try {
            sess.webRequest.onBeforeRequest((details, cb) => {
              try {
                if (/^https?:/i.test(details.url)) {
                  globalThis.__a44.count++;
                  if (globalThis.__a44.urls.length < 20) globalThis.__a44.urls.push(details.url);
                }
              } catch (e) {
                /* 집계 실패가 요청을 막지 않도록 */
              }
              cb({});
            });
            hooked.add(sess);
            return true;
          } catch (e) {
            return false; /* 세션 후킹 실패 — 성공 계수에서 제외 (defaultSession 실패는 아래에서 FAIL) */
          }
        };
        const defaultOk = hook(session.defaultSession);
        for (const wc of webContents.getAllWebContents()) {
          try {
            hook(wc.session);
          } catch (e) {
            /* 무시 */
          }
        }
        app.on('session-created', hook);
        return { total: hooked.size, defaultOk };
      });
      expect(
        installed.defaultOk && installed.total >= 1,
        `A44: defaultSession 에 webRequest 카운터를 설치하지 못했습니다 (성공 ${installed.total}세션, defaultSession=${installed.defaultOk}) — 판정 불능 = FAIL`
      ).toBe(true);

      // 보조 관찰: Playwright page 요청 이벤트 (재로드 후에도 리스너 유지)
      const pageHttp = [];
      for (const p of [calPage, postitPage]) {
        p.on('request', (r) => {
          if (/^https?:/i.test(r.url())) pageHttp.push(r.url());
        });
      }

      await representativeOps(calPage, postitPage, '①');

      const counter = await shell.app.evaluate(() => globalThis.__a44 || { count: -1, urls: [] });
      expect(
        counter.count,
        `A44: 대표 조작 중 http(s) 요청 ${counter.count}건이 관찰되었습니다 (0건이어야 함 — 텔레메트리·원격 로깅 금지): ` +
          counter.urls.join(', ')
      ).toBe(0);
      expect(
        pageHttp.length,
        `A44: 렌더러 page 이벤트에서 http(s) 요청 ${pageHttp.length}건이 관찰되었습니다 (0건이어야 함): ` + pageHttp.join(', ')
      ).toBe(0);
      assertNoDialogs(shell.state, 'A44 ①');
    } finally {
      await closeElectronShell(shell);
      await removeDirWithRetry(dir);
    }
  });

  test('A44: ② main·preload 정적 검사 — 네트워크 모듈 require/import·net.request·autoUpdater 0건', async () => {
    test.setTimeout(120 * 1000);
    requireElectronShell('A44');
    expect(fs.existsSync(ELECTRON_MAIN), `A44: electron\\main.js 가 없습니다 — electron 셸 미구축 (2단계 진행 중)`).toBe(true);

    // 검사 대상: electron\ 루트 하위 셸 소스 전체 (node_modules·dist·build·out 제외)
    const EXCLUDE = new Set(['node_modules', 'dist', 'build', 'out']);
    const files = [];
    const walk = (dir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.isSymbolicLink()) continue;
        const abs = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          if (!EXCLUDE.has(ent.name)) walk(abs);
        } else if (ent.isFile() && /\.(js|mjs|cjs)$/i.test(ent.name)) {
          files.push(abs);
        }
      }
    };
    walk(ELECTRON_DIR);
    expect(files.length >= 1, 'A44: electron\\ 에서 검사할 셸 소스(*.js)를 찾지 못했습니다 — electron 셸 미구축 (2단계 진행 중)').toBe(true);
    test.info().annotations.push({
      type: 'A44-정적검사-대상',
      description: files.map((f) => path.relative(ELECTRON_DIR, f)).join(', '),
    });

    const lineOf = (src, idx) => {
      let line = 1;
      for (let i = 0; i < idx && i < src.length; i++) if (src[i] === '\n') line++;
      return line;
    };
    const snippetAt = (src, idx) => {
      const start = src.lastIndexOf('\n', idx) + 1;
      let end = src.indexOf('\n', idx);
      if (end < 0) end = src.length;
      return src.slice(start, end).trim().slice(0, 160);
    };

    const violations = [];
    for (const file of files) {
      const original = fs.readFileSync(file, 'utf8');
      const pre = stripHtmlComments(original); // .js 에는 무해 — 토크나이저 전처리 관례 유지
      const { masked, noComments } = tokenize(pre);
      const rel = path.relative(ELECTRON_DIR, file);
      const add = (idx, rule) => violations.push({ file: rel, line: lineOf(original, idx), rule, snippet: snippetAt(original, idx) });

      // 네트워크 모듈 require / import (문자열 원문 유지본 — 주석은 제거됨)
      const reqRe = /(?:require\s*\(\s*|from\s+|import\s*\(\s*|import\s+)(['"])(?:node:)?(https?|net|dns|dgram|tls)\1/g;
      let m;
      while ((m = reqRe.exec(noComments)) !== null) {
        add(m.index, `네트워크 모듈 "${m[2]}" require/import 금지 (A44 ② — 텔레메트리·원격 통신 벡터)`);
      }
      // net.request 호출 (마스킹본 — 문자열/주석 내 언급 오탐 없음)
      const netReqRe = /(?<![\w$.])net\s*\.\s*request\s*\(/g;
      while ((m = netReqRe.exec(masked)) !== null) add(m.index, 'net.request 사용 금지 (A44 ②)');
      // autoUpdater 식별자 (마스킹본 — electron.autoUpdater·구조분해 포함)
      const auRe = /(?<![\w$])autoUpdater\b/g;
      while ((m = auRe.exec(masked)) !== null) add(m.index, 'autoUpdater 사용 금지 (A44 ② — 자동 업데이트·원격 요청 금지)');
    }

    expect(
      violations.length,
      `A44: 셸 소스 정적 검사 위반 ${violations.length}건 (0건이어야 함):\n` +
        violations.map((v) => `  - ${v.file}:${v.line} ${v.rule} → ${v.snippet}`).join('\n')
    ).toBe(0);
  });

  test('A44: ③ 앱 PID 트리 아웃바운드 소켓(netstat) 0건 — OS 레벨 2회 샘플', async () => {
    test.setTimeout(240 * 1000);
    test.skip(process.platform !== 'win32', 'Windows 전용 항목 — A44 ③ 을 명시적으로 SKIP 합니다 (rev.5 관례)');
    requireElectronShell('A44');
    requirePostit();
    const dir = freshUserDataDir();
    let shell = null;

    const runPs = (cmd) =>
      execFileSync(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd], {
        encoding: 'utf8',
        timeout: 60000,
        windowsHide: true,
      });

    /**
     * 루트 PID 의 자손 전체(루트 포함) 집합 + 진단용 프로세스 정보 맵.
     * Windows PID 재사용 오염 차단: 무관 프로세스의 ParentProcessId 가 우리 트리의 재사용
     * PID 를 가리키는 허위 간선을 막기 위해, 루트 생성 시각(2초 여유)보다 먼저 생성된
     * 프로세스는 자식으로 인정하지 않는다 (실제 자식은 반드시 루트 이후에 생성된다).
     */
    const pidTreeOf = (rootPid) => {
      let out = '';
      try {
        out = runPs(
          '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ' +
            'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,' +
            "@{n='Start';e={ if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { 0 } }} | ConvertTo-Json -Compress"
        );
      } catch (e) {
        throw new Error('A44: 프로세스 트리 조회(PowerShell CIM) 실패 — PID 트리 판정 불능: ' + e.message);
      }
      let arr;
      try {
        arr = JSON.parse(String(out).replace(/^\uFEFF/, '').trim());
      } catch (e) {
        throw new Error('A44: 프로세스 목록 JSON 해석 실패 — PID 트리 판정 불능');
      }
      if (!Array.isArray(arr)) arr = [arr];
      const info = new Map(); // pid → {ppid, name, start}
      const children = new Map();
      for (const p of arr) {
        if (!p) continue;
        const pid = Number(p.ProcessId);
        const ppid = Number(p.ParentProcessId);
        info.set(pid, { ppid, name: String(p.Name || ''), start: Number(p.Start) || 0 });
        if (!children.has(ppid)) children.set(ppid, []);
        children.get(ppid).push(pid);
      }
      const root = info.get(rootPid);
      if (!root) throw new Error(`A44: 루트 PID ${rootPid} 를 프로세스 목록에서 찾지 못했습니다 (판정 불능)`);
      const minStart = root.start - 2 * 1000 * 10000; // FileTime 100ns 틱 — 루트보다 2초 이상 먼저 생성된 프로세스 제외
      const tree = new Set([rootPid]);
      const queue = [rootPid];
      while (queue.length) {
        const cur = queue.shift();
        for (const c of children.get(cur) || []) {
          const ci = info.get(c);
          if (!ci || ci.start < minStart) continue; // PID 재사용 허위 간선 차단
          if (!tree.has(c)) {
            tree.add(c);
            queue.push(c);
          }
        }
      }
      return { tree, info };
    };

    const hostOf = (addr) => {
      // "[::1]:135" → "[::1]", "127.0.0.1:9222" → "127.0.0.1"
      const i = addr.lastIndexOf(':');
      return i > 0 ? addr.slice(0, i) : addr;
    };
    const isLocalOrUnspecified = (addr) => {
      const h = hostOf(addr);
      return (
        h === '127.0.0.1' ||
        h.startsWith('127.') ||
        h === '[::1]' ||
        h === '::1' ||
        h === '0.0.0.0' ||
        h === '[::]' ||
        h === '*'
      );
    };

    /** netstat -ano 의 TCP 행 중 PID 트리 소유 아웃바운드(비루프백·비 LISTENING) 행 목록 */
    const sampleOutbound = ({ tree, info }) => {
      let out = '';
      try {
        out = execFileSync(NETSTAT_EXE, ['-ano'], { encoding: 'utf8', timeout: 60000, windowsHide: true });
      } catch (e) {
        throw new Error('A44: netstat 실행 실패 — OS 레벨 소켓 판정 불능: ' + e.message);
      }
      const bad = [];
      for (const line of String(out).split(/\r?\n/)) {
        const m = /^\s*(TCP)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s*$/i.exec(line);
        if (!m) continue;
        const [, , local, remote, state, pidStr] = m;
        const pid = Number(pidStr);
        if (!tree.has(pid)) continue;
        if (/^LISTENING$/i.test(state)) continue;
        if (isLocalOrUnspecified(remote)) continue;
        const name = (info.get(pid) || {}).name || '?';
        bad.push(`${local} → ${remote} [${state}] pid=${pid}(${name})`);
      }
      return bad;
    };

    try {
      shell = await launchElectronShell(dir, { label: 'A44' });
      const { calPage, postitPage } = await getBothAppWindows(shell, 'A44');
      for (const p of [postitPage, calPage]) {
        await dismissOnboardingIfPresent(p, 'A44');
        await dismissMigrateIfPresent(p, 'A44');
      }

      const rootPid = shell.app.process().pid;
      expect(!!rootPid, 'A44: Electron 루트 프로세스 PID 를 얻지 못했습니다 (판정 불능 = FAIL)').toBe(true);

      // 진단: 조작 전 샘플 (기동 자체의 발신과 조작 유발 발신을 구분)
      const badPre = sampleOutbound(pidTreeOf(rootPid));
      test.info().annotations.push({
        type: 'A44-조작전-아웃바운드',
        description: badPre.length ? badPre.join(' | ') : '0건',
      });

      // 대표 조작으로 지연 발신(lazy phone-home)까지 유도한 뒤 2회 샘플
      await representativeOps(calPage, postitPage, '③');
      const tree1 = pidTreeOf(rootPid);
      const bad1 = sampleOutbound(tree1);
      await sleep(2500);
      const tree2 = pidTreeOf(rootPid);
      const bad2 = sampleOutbound(tree2);
      const all = Array.from(new Set([...badPre, ...bad1, ...bad2])); // 기동 발신 포함 3회 샘플 합집합

      test.info().annotations.push({
        type: 'A44-pid-tree',
        description: `루트 ${rootPid}, 트리 ${tree2.tree.size}개 프로세스: ${Array.from(tree2.tree)
          .map((p) => `${p}(${(tree2.info.get(p) || {}).name || '?'})`)
          .join(', ')}`,
      });
      expect(
        all.length,
        `A44: 앱 PID 트리에서 아웃바운드 TCP 소켓 ${all.length}건이 관찰되었습니다 (0건이어야 함 — 루프백 제외):\n` +
          all.map((s) => '  - ' + s).join('\n')
      ).toBe(0);
      assertNoDialogs(shell.state, 'A44 ③');
    } finally {
      await closeElectronShell(shell);
      await removeDirWithRetry(dir);
    }
  });
});
