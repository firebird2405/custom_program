'use strict';
/**
 * A12 채점기 무결성 해시 — SCORECARD 명세 그대로 구현:
 *  - 대상: protocol/grader/ 하위 전 파일
 *  - 제외: node_modules, test-results, playwright-report (디렉터리·동명 파일 모두), .last-run.json
 *  - 정렬: 슬래시(/) 구분 상대경로의 서수(ordinal) 정렬 (JS 기본 문자열 정렬 = UTF-16 코드유닛)
 *  - 연결: 각 파일마다 상대경로 + "\n" + (CRLF→LF 정규화한 내용) + "\n" 을 이어붙임
 *  - 결과: 연결 문자열의 UTF-8 바이트에 대한 SHA256 hex(소문자)
 *
 * 독립 검증(PowerShell 한 줄)은 INDEPENDENT_HASH.txt 및 SCORECARD 하단 참조 — 동일 명세.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GRADER_ROOT = path.resolve(__dirname, '..');
const EXCLUDED_NAMES = new Set(['node_modules', 'test-results', 'playwright-report']);
const EXCLUDED_FILES = new Set(['.last-run.json']);

function listFiles(dir, base, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_NAMES.has(ent.name)) continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      listFiles(abs, base, out);
    } else if (ent.isFile()) {
      if (EXCLUDED_FILES.has(ent.name)) continue;
      out.push(path.relative(base, abs).split(path.sep).join('/'));
    }
  }
  return out;
}

function computeGraderHash(root = GRADER_ROOT) {
  const rels = listFiles(root, root, []);
  rels.sort(); // 서수(ordinal) 정렬
  const chunks = [];
  for (const rel of rels) {
    const content = fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
    chunks.push(rel + '\n' + content + '\n');
  }
  return crypto.createHash('sha256').update(chunks.join(''), 'utf8').digest('hex');
}

module.exports = { computeGraderHash, GRADER_ROOT };

if (require.main === module) {
  console.log(computeGraderHash());
}
