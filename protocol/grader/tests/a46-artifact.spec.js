'use strict';
/**
 * A46 — 산출물 검사 (SCORECARD rev.6)
 * "산출물 검사(채점기 fs 직접 측정 — 자기신고 스크립트 금지): 인스톨러 파일 ≤120MB +
 *  `dist/win-unpacked/` 총합 ≤300MB (dist 부재 시 명시적 SKIP). 개인 데이터 블랙리스트:
 *  산출물(인스톨러·포터블 ZIP)을 풀어 backups/·.edge/·protocol/·*.log·실사용 저장 데이터
 *  부재를 정적 검사 — 지인 배포판도 동일 검사 통과가 1주차 완료 조건"
 *
 * ══ rev.6 필수 계약 (REQUIRED CONTRACT — 본 주석이 A46 검사 계약의 정본) ══
 *
 * 대상 경로: electron/dist (electron-builder.yml directories.output 정본).
 *  - electron/dist 부재 → 명시적 SKIP (draft 명시 "dist 부재 시 명시적 SKIP" — 빌드 전 상태).
 *  - dist 존재 + dist/win-unpacked 부재 → 빌드 불완전 FAIL (fail-closed — skip-pass 금지).
 *
 * 크기 상한 (모두 채점기 fs 직접 측정 — 앱/스크립트 자기신고 금지):
 *  - dist/win-unpacked/ 재귀 총합 ≤ 300MB.
 *  - dist 루트의 인스톨러 파일(.exe/.msi/.msix/.appx/.zip/.nupkg/.7z) 각각 ≤ 120MB.
 *    인스톨러가 아직 없으면(1주차 --dir 빌드) 크기·해제 검사는 존재하는 산출물에만 적용하고
 *    그 사실을 리포트 주석(annotation)으로 남긴다 — win-unpacked 검사는 항상 수행.
 *
 * 개인 데이터 블랙리스트 (경로 세그먼트/파일명 대소문자 무시):
 *  - 디렉터리 세그먼트: backups · .edge · protocol · .git
 *  - 파일: *.log
 *  - 실사용 저장 데이터: 세그먼트 "Local Storage" · "IndexedDB" · "Session Storage",
 *    파일 window-state.json · *.ldb · *.sqlite
 *  적용 범위: ① dist/win-unpacked 트리 전체, ② zip 계열 인스톨러(.zip/.msix/.appx/.nupkg —
 *  모두 zip 컨테이너)를 tmpdir 에 풀어 그 트리 전체, ③ 발견되는 모든 *.asar 아카이브의
 *  내부 경로(헤더 JSON 직접 파싱 — 외부 도구 불요). NSIS .exe 는 압축 해제 도구 없이는 풀 수
 *  없으므로 내용물 검사는 동일 트리인 win-unpacked 검사로 갈음하고 크기 상한만 직접 잰다
 *  (electron-builder nsis 는 win-unpacked 를 그대로 패킹한다 — 계약 주석으로 명시).
 *
 * 해제는 System32 절대 경로 PowerShell 의 Expand-Archive 사용 (PATH 섀도잉 차단 — B 실행 환경
 * 후킹 금지 관용구, a13/a39 와 동일).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, expect } = require('@playwright/test');
const { removeDirWithRetry } = require('../lib/helpers');
const {
  ELECTRON_DIST_DIR,
  WIN_UNPACKED_DIR,
  listFilesRecursive,
  dirSizeBytes,
  readAsarPaths,
} = require('../lib/electron-helpers');

const MB = 1024 * 1024;
const INSTALLER_MAX = 120 * MB;
const UNPACKED_MAX = 300 * MB;
const INSTALLER_EXTS = new Set(['.exe', '.msi', '.msix', '.appx', '.zip', '.nupkg', '.7z']);
const ZIP_FAMILY = new Set(['.zip', '.msix', '.appx', '.nupkg']);

const POWERSHELL_EXE = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'
);

const BLACKLIST_DIR_SEGMENTS = ['backups', '.edge', 'protocol', '.git', 'local storage', 'indexeddb', 'session storage'];
const BLACKLIST_FILES = ['window-state.json'];
const BLACKLIST_FILE_RES = [/\.log$/i, /\.ldb$/i, /\.sqlite$/i];

/** 상대경로(슬래시 구분) 하나에 대한 블랙리스트 위반 사유 (없으면 null) */
function blacklistViolation(relPath) {
  const segs = relPath.split(/[\\/]+/).filter(Boolean);
  const base = segs.length ? segs[segs.length - 1] : '';
  for (const seg of segs.slice(0, -1)) {
    if (BLACKLIST_DIR_SEGMENTS.includes(seg.toLowerCase())) return `금지 디렉터리 세그먼트 "${seg}"`;
  }
  // 파일명 자체가 금지 디렉터리명과 같아도(예: 최상위 "protocol" 파일) 배포 오염이므로 동일 취급
  if (BLACKLIST_DIR_SEGMENTS.includes(base.toLowerCase())) return `금지 이름 "${base}"`;
  if (BLACKLIST_FILES.includes(base.toLowerCase())) return `실사용 저장 데이터 파일 "${base}"`;
  for (const re of BLACKLIST_FILE_RES) {
    if (re.test(base)) return `금지 확장자 파일 "${base}" (${re})`;
  }
  return null;
}

/** 트리 전체 블랙리스트 검사 + 내부 *.asar 검사. 위반 목록(문자열) 반환 */
function scanTree(rootDir, originLabel) {
  const violations = [];
  for (const abs of listFilesRecursive(rootDir)) {
    const rel = path.relative(rootDir, abs);
    const v = blacklistViolation(rel);
    if (v) violations.push(`${originLabel}: ${rel} — ${v}`);
    if (/\.asar$/i.test(abs)) {
      for (const inner of readAsarPaths(abs)) {
        const iv = blacklistViolation(inner);
        if (iv) violations.push(`${originLabel} 내 ${rel}(asar) 내부: ${inner} — ${iv}`);
      }
    }
  }
  return violations;
}

function expandZipFamily(archivePath, destDir) {
  // Expand-Archive 는 .zip 확장자만 받으므로 사본을 만들어 푼다 (.msix/.appx/.nupkg 도 zip 컨테이너)
  const zipCopy = path.join(destDir, path.basename(archivePath) + '.as.zip');
  fs.copyFileSync(archivePath, zipCopy);
  const outDir = path.join(destDir, path.basename(archivePath) + '.extracted');
  fs.mkdirSync(outDir, { recursive: true });
  execFileSync(
    POWERSHELL_EXE,
    [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      `Expand-Archive -LiteralPath '${zipCopy.replace(/'/g, "''")}' -DestinationPath '${outDir.replace(/'/g, "''")}' -Force`,
    ],
    { encoding: 'utf8', timeout: 180000, windowsHide: true }
  );
  fs.rmSync(zipCopy, { force: true });
  return outDir;
}

test.describe('A46 산출물 검사', () => {
  test('A46: 인스톨러 ≤120MB·win-unpacked ≤300MB (fs 직접 측정) + 개인 데이터 블랙리스트(backups/.edge/protocol/*.log·저장 데이터) 부재', async ({}, testInfo) => {
    test.setTimeout(300 * 1000);
    test.skip(
      !fs.existsSync(ELECTRON_DIST_DIR),
      'electron/dist 부재 — 빌드 산출물이 아직 없어 A46 을 명시적으로 SKIP 합니다 (SCORECARD rev.6 A46: dist 부재 시 SKIP)'
    );

    // ── win-unpacked: 존재(빌드 완결성) + 총합 ≤300MB + 블랙리스트 ──
    if (!fs.existsSync(WIN_UNPACKED_DIR)) {
      throw new Error(
        'A46: electron/dist 는 있으나 dist/win-unpacked 가 없습니다 — 빌드 불완전 상태 (fail-closed: ' +
          'electron-builder --dir 또는 인스톨러 빌드는 항상 win-unpacked 를 남깁니다)'
      );
    }
    const unpackedBytes = dirSizeBytes(WIN_UNPACKED_DIR);
    expect(
      unpackedBytes <= UNPACKED_MAX,
      `A46: dist/win-unpacked 총합 ${(unpackedBytes / MB).toFixed(1)}MB > 상한 300MB (경량 유지 계약 2-d)`
    ).toBe(true);
    const violations = scanTree(WIN_UNPACKED_DIR, 'win-unpacked');

    // ── 인스톨러: dist 루트 글롭 → 각각 ≤120MB + zip 계열 해제 검사 ──
    const rootEntries = fs.readdirSync(ELECTRON_DIST_DIR, { withFileTypes: true });
    const installers = rootEntries
      .filter((e) => e.isFile() && INSTALLER_EXTS.has(path.extname(e.name).toLowerCase()))
      .map((e) => path.join(ELECTRON_DIST_DIR, e.name));

    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'grader-a46-'));
    try {
      if (installers.length === 0) {
        testInfo.annotations.push({
          type: 'a46-참고',
          description: '인스톨러 산출물 없음 (1주차 --dir 빌드 상태) — win-unpacked 검사만 수행. 인스톨러 상한·해제 검사는 3주차 빌드 후 자동 적용.',
        });
      }
      for (const inst of installers) {
        const size = fs.statSync(inst).size;
        expect(
          size <= INSTALLER_MAX,
          `A46: 인스톨러 ${path.basename(inst)} 크기 ${(size / MB).toFixed(1)}MB > 상한 120MB (다운로드 전환율 계약 2-d)`
        ).toBe(true);
        const ext = path.extname(inst).toLowerCase();
        if (ZIP_FAMILY.has(ext)) {
          let outDir = null;
          try {
            outDir = expandZipFamily(inst, scratch);
          } catch (e) {
            throw new Error(
              `A46: 인스톨러 ${path.basename(inst)} 압축 해제 실패 — 개인 데이터 블랙리스트를 검증할 수 없어 FAIL 처리합니다 (fail-closed): ${e.message}`
            );
          }
          violations.push(...scanTree(outDir, path.basename(inst)));
        }
        // NSIS .exe: 계약 주석대로 내용물 검사는 win-unpacked 로 갈음 (위에서 항상 수행)
      }

      expect(
        violations.length,
        'A46: 산출물에서 개인 데이터/금지 항목이 발견되었습니다 (배포판 오염 — B rev.6):\n  - ' + violations.join('\n  - ')
      ).toBe(0);
    } finally {
      await removeDirWithRetry(scratch);
    }
  });
});
