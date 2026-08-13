'use strict';
/**
 * 채점기 Playwright 설정 — SCORECARD "채점 메커니즘 공통 규정" 준수
 * - workers 1, 병렬 금지 (persistent context user-data-dir 충돌 방지)
 * - 브라우저는 각 테스트가 lib/helpers.js 의 launchPersistentContext(channel:"msedge", headless)로 직접 기동
 * - globalSetup: A12 참고용 채점기 SHA256 자기 출력 (공식 검증은 SCORECARD 하단 PowerShell 한 줄)
 */
const path = require('path');

module.exports = {
  testDir: './tests',
  timeout: 90 * 1000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  globalSetup: path.join(__dirname, 'global-setup.js'),
};
