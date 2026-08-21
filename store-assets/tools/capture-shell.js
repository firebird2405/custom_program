'use strict';
/**
 * Electron 셸 장면 촬영 — 온보딩 스포트라이트(A47).
 *
 * 온보딩은 셸(preload.js)이 주입하는 레이어라 file:// 단독 실행으로는 나타나지 않는다.
 * 그래서 이 장면만 실제 Electron 셸을 fresh PETIT_USERDATA 로 띄워 찍는다.
 * 셸·앱 파일은 읽기만 한다 (기동만). userData 는 os.tmpdir() 아래 임시 폴더.
 *
 *    node tools/capture-shell.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.resolve(__dirname, '..');
const ELECTRON_DIR = path.join(ROOT, 'electron');
const ELECTRON_EXE = path.join(ELECTRON_DIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const { _electron } = require(path.join(ROOT, 'protocol', 'grader', 'node_modules', '@playwright', 'test'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findWindow(app, name, timeoutMs) {
  const want = name.toLowerCase();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const w of app.windows()) {
      let u = '';
      try { u = (w.url() || '').toLowerCase(); } catch (e) { u = ''; }
      if (u.endsWith('/' + want)) {
        try { await w.waitForLoadState('domcontentloaded', { timeout: 8000 }); } catch (e) { /* 이미 로드 */ }
        return w;
      }
    }
    if (Date.now() > deadline) {
      const urls = app.windows().map((w) => { try { return w.url(); } catch (e) { return '?'; } });
      throw new Error(name + ' 창을 찾지 못했습니다. 현재 창: ' + JSON.stringify(urls));
    }
    await sleep(300);
  }
}

async function main() {
  if (!fs.existsSync(ELECTRON_EXE)) throw new Error('electron.exe 부재 — 셸 장면은 건너뜁니다: ' + ELECTRON_EXE);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'petit-shot-shell-'));
  const env = { ...process.env, PETIT_USERDATA: userData };
  delete env.NODE_OPTIONS;
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await _electron.launch({ executablePath: ELECTRON_EXE, args: [ELECTRON_DIR], env, timeout: 60000 });
  const made = [];
  try {
    const win = await findWindow(app, 'postit.html', 40000);
    /* 다른 컷과 같은 1920×1080 으로 맞춘다.
       이 PC 는 150% 배율이라 창 크기만으로는 1080 이 안 나온다 —
       렌더러 뷰포트를 CDP 로 직접 지정한다 (창은 그대로, 캡처만 1920×1080). */
    let sized = false;
    try {
      const cdp = await app.context().newCDPSession(win);
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false
      });
      sized = true;
    } catch (e) {
      await app.evaluate(({ BrowserWindow }) => {
        for (const w of BrowserWindow.getAllWindows()) {
          try { w.setContentSize(1600, 900); } catch (err) { /* 무시 */ }
        }
      }).catch(() => {});
    }
    await sleep(1000);
    /* 온보딩 루트가 뜰 때까지 기다린다 (fresh 첫 실행 전용 레이어) */
    await win.waitForSelector('[data-onboarding]', { state: 'visible', timeout: 20000 });
    await sleep(1600);   /* 스포트라이트 딤·링 등장 애니메이션 안착 */
    const shot1 = path.join(OUT, 'screenshot-12-onboarding-spotlight.png');
    await win.screenshot({ path: shot1 });
    made.push(path.basename(shot1));

    /* 단계가 있으면 한 칸 진행해 "지목(스포트라이트) + 실제 UI" 가 함께 보이는 컷도 남긴다 */
    const target = win.locator('[data-onboarding-target]').first();
    if (await target.count()) {
      const act = (await target.getAttribute('data-onboarding-target')) || 'click';
      if (act === '' || act === 'click') {
        await target.click({ timeout: 5000 }).catch(() => {});
        await sleep(1800);
        fs.mkdirSync(path.join(OUT, 'extras'), { recursive: true });
        const shot2 = path.join(OUT, 'extras', 'onboarding-step2.png');
        await win.screenshot({ path: shot2 });
        made.push(path.basename(shot2));
      }
    }
  } finally {
    await app.close().catch(() => {});
    for (let i = 0; i < 10; i++) {
      try { fs.rmSync(userData, { recursive: true, force: true }); break; } catch (e) { await sleep(300); }
    }
  }
  console.log('생성:', made.join(', ') || '(없음)');
}

main().catch((e) => { console.error('실패:', (e && e.message) || e); process.exit(1); });
