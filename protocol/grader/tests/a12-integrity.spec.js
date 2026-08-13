'use strict';
/**
 * A12 — 채점기 무결성: protocol/grader/ 해시 대상의 SHA256 이 SCORECARD.md 하단
 * "채점기 SHA256 기대값" 기재값과 일치해야 한다.
 * 기대값이 아직 기재되지 않았으면(미기록/(2단계...) 명확한 한국어 메시지로 실패.
 * 채점기 자기 출력은 참고용 — 독립 검증은 SCORECARD 하단 PowerShell 한 줄로 사용자가 직접 수행.
 */
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { computeGraderHash } = require('../lib/hash');

const SCORECARD_PATH = path.resolve(__dirname, '..', '..', 'SCORECARD.md');

test.describe('A12 채점기 무결성', () => {
  // 제목에 "SHA256" 을 쓰면 부분 문자열 "A2" 때문에 `-g "A2"` 개별 실행에 A12 가 섞여 들어온다
  // (레드팀 확인) — 제목만 "SHA-256" 표기로 회피. 검사 내용은 동일.
  test('A12: 채점기 SHA-256 이 채점표 기재 기대값과 일치', () => {
    expect(
      fs.existsSync(SCORECARD_PATH),
      '채점표 파일을 찾을 수 없습니다: ' + SCORECARD_PATH
    ).toBe(true);

    const scorecard = fs.readFileSync(SCORECARD_PATH, 'utf8');
    const m = scorecard.match(/채점기 SHA256 기대값\s*[:：]\s*([^\r\n]*)/);
    expect(m, "채점표(SCORECARD.md)에서 '채점기 SHA256 기대값' 줄을 찾을 수 없습니다").not.toBeNull();

    const expected = m[1].trim();
    if (!/^[0-9a-fA-F]{64}$/.test(expected)) {
      throw new Error(
        `기대값 미기록 — 채점표의 "채점기 SHA256 기대값" 항목에 64자리 SHA256 이 아직 기재되지 않았습니다 (현재 값: "${expected}")`
      );
    }

    const actual = computeGraderHash();
    expect(
      actual.toLowerCase(),
      `채점기 SHA256 불일치 — 채점기 변조 가능성이 있습니다.\n  기대값: ${expected.toLowerCase()}\n  실제값: ${actual.toLowerCase()}`
    ).toBe(expected.toLowerCase());
  });
});
