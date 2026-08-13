'use strict';
/**
 * A0 정적 검사 — SCORECARD B 금지 싱크 + 공통 규정(에러 은폐 차단).
 * "앱 코드 정적 검사: window.onerror/onunhandledrejection/console.* 재정의 금지" 포함.
 * postit.html 부재 시 크래시 없이 한국어 메시지로 즉시 실패.
 */
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { CALENDAR_PATH, POSTIT_PATH, POSTIT_MISSING_MSG } = require('../lib/helpers');
const { scanFile } = require('../lib/static-checks');

function formatFindings(findings) {
  return (
    '정적 검사 위반 ' + findings.length + '건:\n' +
    findings.map((f) => `  ${f.line}행 [${f.rule}] ${f.snippet}`).join('\n')
  );
}

test.describe('A0 앱 소스 정적 검사', () => {
  test('A0: calendar.html — 위험 싱크·에러 은폐 재정의 없음', () => {
    expect(fs.existsSync(CALENDAR_PATH), 'calendar.html 파일을 찾을 수 없습니다: ' + CALENDAR_PATH).toBe(true);
    const findings = scanFile(CALENDAR_PATH);
    expect(findings.length, formatFindings(findings)).toBe(0);
  });

  test('A0: postit.html — 위험 싱크·에러 은폐 재정의 없음', () => {
    if (!fs.existsSync(POSTIT_PATH)) throw new Error(POSTIT_MISSING_MSG);
    const findings = scanFile(POSTIT_PATH);
    expect(findings.length, formatFindings(findings)).toBe(0);
  });
});
