'use strict';
/**
 * A50 — 설치 실물 검증 (SCORECARD rev.6 A50)
 *
 * ── REQUIRED CONTRACT (rev.6 — 이 주석이 정본, 구현을 여기에 맞춘다) ──
 * 빌드된 MSIX(.appx/.msix, electron/dist 하위)를 테스트 설치(Add-AppxPackage)
 *  → 시작 메뉴 엔트리 존재(Get-StartApps, PackageFamilyName 매칭)
 *  → 표시 이름이 확정 브랜드(쁘띠캘린더/PetitCalendar)와 일치
 *  → 아이콘 리소스 일치(매니페스트가 선언한 로고 경로가 패키지 안에 실재)
 *  → 테스트 후 제거(Remove-AppxPackage — finally 보장).
 *
 * 명시적 SKIP (rev.5 관례 — A13·A16·A38~A40 동형):
 *  - 비 Windows 플랫폼
 *  - 산출물(.appx/.msix) 부재 (3주차 빌드 전)
 *  - 비대화형 데스크톱 세션
 *  - 설치 권한/정책/서명 신뢰 불가 환경 (sideload 비활성·개발자 모드 꺼짐·인증서 미신뢰 등)
 *  - 동일 Identity 패키지가 이미 설치된 경우 (실사용 설치 불가침 — 테스트 설치/제거 금지)
 * 그 외 실패는 전부 한국어 메시지 FAIL — skip-pass·크래시 금지.
 *
 * teardown 안전: 이 테스트가 설치한 PackageFullName 만 제거한다.
 */
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
  DIST_DIR,
  BRAND_RE,
  runPowerShell,
  psq,
  zipEntryText,
  zipEntryList,
  listFilesRel,
} = require('../lib/electron-helpers');

function findStorePackages() {
  if (!fs.existsSync(DIST_DIR)) return [];
  return listFilesRel(DIST_DIR)
    .filter((rel) => /\.(appx|msix|appxbundle|msixbundle)$/i.test(rel))
    .map((rel) => path.join(DIST_DIR, rel))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

/** PowerShell JSON 출력 파싱 (BOM 제거, 빈 출력 → null) */
function psJson(script, timeoutMs) {
  const out = runPowerShell(
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n' + script,
    timeoutMs
  );
  const text = String(out).replace(/^﻿/, '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

function getAppxPackage(identityName) {
  const r = psJson(
    `$p = Get-AppxPackage -Name '${psq(identityName)}' -ErrorAction SilentlyContinue | ` +
      'Select-Object Name, PackageFullName, PackageFamilyName, InstallLocation, Version; ' +
      'if ($null -ne $p) { ConvertTo-Json -InputObject $p -Compress }'
  );
  if (!r) return null;
  return Array.isArray(r) ? r[0] || null : r;
}

/** 설치 오류를 환경 문제(SKIP)와 실제 결함(FAIL)으로 분류 */
const ENV_SKIP_RE =
  /0x80073CFF|0x800B0100|0x800B010A|0x80070005|sideload|테스트\s*로드|개발자\s*모드|developer\s*mode|AllowDevelopmentWithoutDevLicense|signature|서명|인증서|certificat|access\s*is\s*denied|액세스가\s*거부|0x80073D01|정책/i;

test.describe('A50 설치 실물(MSIX)', () => {
  test('A50: MSIX 테스트 설치 → 시작 메뉴·표시 이름·아이콘 → 제거', async () => {
    test.setTimeout(300 * 1000); // 설치·제거 외부 프로세스 포함
    test.skip(process.platform !== 'win32', 'Windows 전용 항목 — A50 을 명시적으로 SKIP 합니다');

    const pkgs = findStorePackages();
    test.skip(
      pkgs.length === 0,
      `스토어 패키지(.appx/.msix) 산출물 부재 — 3주차 빌드 전이므로 A50 을 명시적으로 SKIP 합니다 (탐색: ${DIST_DIR})`
    );

    // 비대화형 데스크톱 세션(서비스·CI) — Add-AppxPackage/시작 메뉴 검증 불가
    let interactive = '';
    try {
      interactive = runPowerShell('[Environment]::UserInteractive').trim();
    } catch (e) {
      interactive = '';
    }
    test.skip(!/true/i.test(interactive), '비대화형 데스크톱 세션 — A50 을 명시적으로 SKIP 합니다 (3주차 C 시사로 이중화)');

    const pkg = pkgs[0];
    const manifest = zipEntryText(pkg, 'AppxManifest.xml');
    expect(manifest, `패키지에서 AppxManifest.xml 을 추출할 수 없습니다 (손상/비표준 패키지): ${pkg}`).toBeTruthy();
    const idName = (/<Identity[^>]*?\bName\s*=\s*"([^"]*)"/.exec(manifest) || [])[1] || '';
    expect(idName, `AppxManifest.xml Identity Name 을 찾지 못했습니다: ${pkg}`).toBeTruthy();

    // 실사용 설치 불가침: 동일 Identity 가 이미 설치되어 있으면 테스트 설치/제거를 하지 않는다
    const pre = getAppxPackage(idName);
    test.skip(
      !!pre,
      `동일 Identity("${idName}") 패키지가 이미 설치되어 있습니다 (${pre && pre.PackageFullName}) — ` +
        '실사용 설치 불가침 원칙에 따라 A50 테스트 설치를 명시적으로 SKIP 합니다'
    );

    // ── 아이콘 리소스 일치: 매니페스트가 선언한 로고 경로가 패키지 안에 실재해야 한다 ──
    const declared = new Set();
    let m;
    const logoTag = /<Logo>([^<]+)<\/Logo>/g;
    while ((m = logoTag.exec(manifest))) declared.add(m[1].trim());
    const logoAttr = /(?:Square44x44Logo|Square150x150Logo|Square71x71Logo|Wide310x150Logo|Square310x310Logo)\s*=\s*"([^"]+)"/g;
    while ((m = logoAttr.exec(manifest))) declared.add(m[1].trim());
    expect(declared.size, 'AppxManifest.xml 에서 로고 리소스 선언을 하나도 찾지 못했습니다').toBeGreaterThanOrEqual(1);

    const entries = zipEntryList(pkg).map((e) => e.toLowerCase());
    const iconProblems = [];
    for (const decl of declared) {
      const norm = decl.replace(/\\/g, '/').toLowerCase();
      const base = norm.replace(/\.png$/i, '');
      const hit = entries.some((e) => e === norm || (e.startsWith(base + '.') && e.endsWith('.png')));
      if (!hit) iconProblems.push(`매니페스트 선언 로고 "${decl}" 에 해당하는 PNG 가 패키지 안에 없습니다 (scale/targetsize 변형 포함 탐색)`);
    }
    expect(
      iconProblems,
      `A50 아이콘 리소스 불일치 ${iconProblems.length}건 (패키지: ${path.basename(pkg)}):\n` +
        iconProblems.map((p) => '  - ' + p).join('\n')
    ).toEqual([]);

    // ── 테스트 설치 → 검증 → 제거 ──
    let installedFullName = null;
    try {
      try {
        runPowerShell(`Add-AppxPackage -Path '${psq(pkg)}' -ErrorAction Stop`, 240 * 1000);
      } catch (e) {
        const msg = String((e && (e.stderr || e.message)) || '');
        test.skip(
          ENV_SKIP_RE.test(msg),
          '설치 권한/정책/서명 신뢰 불가 환경 — A50 을 명시적으로 SKIP 합니다 (3주차 C 시사로 이중화): ' +
            msg.slice(0, 400)
        );
        throw new Error(`Add-AppxPackage 설치 실패 (${path.basename(pkg)}): ` + msg.slice(0, 800));
      }

      const inst = getAppxPackage(idName);
      expect(
        inst,
        `설치 직후 Get-AppxPackage 에서 Identity "${idName}" 패키지를 찾지 못했습니다 (설치가 완료되지 않음)`
      ).toBeTruthy();
      installedFullName = inst.PackageFullName;

      // 시작 메뉴 엔트리 (PackageFamilyName 매칭) + 표시 이름 브랜드 일치
      const family = inst.PackageFamilyName;
      const startApps = psJson(
        `$a = @(Get-StartApps | Where-Object { $_.AppID -like '${psq(family)}*' } | Select-Object Name, AppID); ` +
          'ConvertTo-Json -InputObject $a -Compress'
      );
      const list = Array.isArray(startApps) ? startApps : startApps ? [startApps] : [];
      expect(
        list.length > 0,
        `설치 후 시작 메뉴(Get-StartApps)에서 PackageFamilyName "${family}" 엔트리를 찾지 못했습니다`
      ).toBe(true);
      const branded = list.find((a) => a && a.Name && BRAND_RE.test(a.Name));
      expect(
        branded,
        `시작 메뉴 표시 이름이 확정 브랜드(쁘띠캘린더/PetitCalendar)와 일치하지 않습니다 — ` +
          `관찰된 엔트리: ${list.map((a) => a && a.Name).join(', ')}`
      ).toBeTruthy();
    } finally {
      // teardown: 이 테스트가 설치한 패키지만 제거 (실사용 데이터 불가침)
      if (installedFullName) {
        try {
          runPowerShell(`Remove-AppxPackage -Package '${psq(installedFullName)}' -ErrorAction Stop`, 120 * 1000);
        } catch (e) {
          /* 제거 실패는 아래 검증에서 잡는다 */
        }
        const leftover = getAppxPackage(idName);
        if (leftover) {
          throw new Error(
            `테스트 설치 패키지 제거 실패 — 수동 제거 필요: Remove-AppxPackage -Package '${leftover.PackageFullName}'`
          );
        }
      }
    }
  });
});
