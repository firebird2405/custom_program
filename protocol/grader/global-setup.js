'use strict';
/**
 * globalSetup — 두 가지 역할:
 *
 * 1) 실행 환경 오염 트립와이어 (SCORECARD B: "실행 환경 후킹 금지 … 채점은 정돈된 환경변수로 실행")
 *    - NODE_OPTIONS / NODE_PATH / PW_TEST_SOURCE_TRANSFORM 이 설정되어 있으면 즉시 실패
 *      (--require 프리로드·모듈 섀도잉·테스트 소스 변환 후킹 경로).
 *    - .npmrc(채점기/앱 루트/사용자 홈)에 node-options 가 설정되어 있으면 즉시 실패
 *      (npm 이 lifecycle 스크립트에 NODE_OPTIONS 를 주입하는 경로).
 *    - @playwright/test 가 채점기 자신의 node_modules 밖에서 resolve 되면 즉시 실패.
 *    - 채점기 루트에 playwright.config.js 이외의 playwright.config.* 가 있으면 즉시 실패
 *      (설정 탐색 우선순위 가로채기 차단 — .ts 등이 .js 보다 먼저 잡히는 것 방지).
 *    ※ 한계: 이 검사는 같은 프로세스 안의 트립와이어다. 프리로드 코드가 흔적(NODE_OPTIONS)을
 *      스스로 지우면 여기서는 탐지할 수 없다. 최종 방어선은 사용자가 "깨끗한 새 셸"에서
 *      SCORECARD 하단 PowerShell 한 줄(독립 해시)과 함께 직접 실행하는 것이다.
 *
 * 2) A12 참고용 — 채점기 자기 해시 출력.
 *    SCORECARD A12: "채점기 자기 출력은 참고용 — 독립 검증은 하단의 PowerShell 한 줄로 사용자가 직접 수행"
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { computeGraderHash, GRADER_ROOT } = require('./lib/hash');

function fail(msg) {
  throw new Error('채점 환경 오염 감지 — ' + msg);
}

function checkEnvironment() {
  const nodeOptions = (process.env.NODE_OPTIONS || '').trim();
  if (nodeOptions !== '') {
    fail(
      `NODE_OPTIONS 가 설정되어 있습니다: "${nodeOptions}". ` +
        '--require 등 코드 주입 경로이므로(SCORECARD B), 환경변수를 비운 새 셸에서 다시 실행하세요.'
    );
  }
  const nodePath = (process.env.NODE_PATH || '').trim();
  if (nodePath !== '') {
    fail(
      `NODE_PATH 가 설정되어 있습니다: "${nodePath}". ` +
        '모듈 섀도잉 경로이므로(SCORECARD B), 환경변수를 비운 새 셸에서 다시 실행하세요.'
    );
  }
  if (process.env.PW_TEST_SOURCE_TRANSFORM) {
    fail(
      `PW_TEST_SOURCE_TRANSFORM 이 설정되어 있습니다: "${process.env.PW_TEST_SOURCE_TRANSFORM}". ` +
        'Playwright 테스트 소스 변환 후킹 경로이므로 환경변수를 비운 새 셸에서 다시 실행하세요.'
    );
  }

  // .npmrc node-options 주입 차단 (프로젝트: 채점기 루트, 상위 앱 루트 / 사용자: 홈)
  const npmrcCandidates = [
    path.join(GRADER_ROOT, '.npmrc'),
    path.resolve(GRADER_ROOT, '..', '.npmrc'), // protocol/
    path.resolve(GRADER_ROOT, '..', '..', '.npmrc'), // d:\custom_program
    path.join(os.homedir(), '.npmrc'),
  ];
  for (const p of npmrcCandidates) {
    try {
      if (fs.existsSync(p) && /^\s*node-options\s*=/im.test(fs.readFileSync(p, 'utf8'))) {
        fail(`.npmrc(${p})에 node-options 가 설정되어 있습니다 — 제거 후 다시 실행하세요 (SCORECARD B).`);
      }
    } catch (e) {
      /* 읽기 실패한 .npmrc 는 판정 불가 — 무시 (독립 해시가 최종 방어선) */
    }
  }

  // @playwright/test 섀도잉 탐지: 채점기 자신의 node_modules 에서 로드되어야 한다
  let resolved = null;
  try {
    resolved = require.resolve('@playwright/test');
  } catch (e) {
    fail('@playwright/test 를 resolve 할 수 없습니다 — protocol/grader 에서 npm install 후 다시 실행하세요.');
  }
  const expectedPrefix = path.join(GRADER_ROOT, 'node_modules') + path.sep;
  if (!resolved.startsWith(expectedPrefix)) {
    fail(
      `@playwright/test 가 채점기 밖에서 로드됩니다: "${resolved}" ` +
        `(기대: ${expectedPrefix}...) — 모듈 섀도잉 의심 (SCORECARD B).`
    );
  }

  // 승인되지 않은 Playwright 설정 파일 차단 (playwright.config.js 만 허용)
  const rogue = fs
    .readdirSync(GRADER_ROOT)
    .filter((n) => /^playwright\.config\./i.test(n) && n.toLowerCase() !== 'playwright.config.js');
  if (rogue.length) {
    fail(
      `허용되지 않은 Playwright 설정 파일이 있습니다: ${rogue.join(', ')} — ` +
        'playwright.config.js 만 허용됩니다 (설정 가로채기 차단, SCORECARD B).'
    );
  }
}

module.exports = async function globalSetup() {
  checkEnvironment();
  try {
    console.log('[A12 참고용] 채점기 SHA256 (자기 계산): ' + computeGraderHash());
  } catch (e) {
    console.log('[A12 참고용] 채점기 SHA256 계산 실패: ' + ((e && e.message) || e));
  }
};
