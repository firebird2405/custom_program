// ============================================================================
// 쁘띠캘린더 — 패키징 afterPack 훅: Electron fuse 적용 (electron-builder.yml에서 참조)
//
// ★ A42 채점 가능성 계약 (protocol/SCORECARD-rev6-draft.md) ★
//   EnableNodeCliInspectArguments 는 반드시 true 유지.
//   Playwright _electron.launch 는 --inspect 계열 스위치로 main 프로세스에
//   붙으므로, 이 fuse를 끄면 "패키지 exe 채점"이 영구 불가능해진다.
//
// 참고: electron-builder 26.x의 내장 electronFuses 옵션은 Node 20+ 전용
// (@noble/hashes 2.x ESM-only)이라, 이 프로젝트(Node 18)는 25.x + 본 훅으로
// 동일 효과를 낸다. 도구는 기존 devDep @electron/fuses 만 사용 (신규 의존성 0).
// ============================================================================
'use strict';

const path = require('path');
const fs = require('fs');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

exports.default = async function afterPack(context) {
  // win-unpacked 최상위의 실행 파일(PetitCalendar.exe)을 찾는다.
  const exeName = fs
    .readdirSync(context.appOutDir)
    .find((f) => f.toLowerCase().endsWith('.exe'));
  if (!exeName) {
    throw new Error('afterPack(fuses): appOutDir에서 실행 파일을 찾지 못했다 — ' + context.appOutDir);
  }
  const exePath = path.join(context.appOutDir, exeName);

  await flipFuses(exePath, {
    version: FuseVersion.V1,

    // ── A42 계약: 절대 false 금지 — 패키지 exe 채점(_electron.launch) 필수 ──
    [FuseV1Options.EnableNodeCliInspectArguments]: true,

    // ── 보안 기본선 강화 (A49 정신) — 채점기는 아래 벡터를 사용하지 않음 ──
    [FuseV1Options.RunAsNode]: false, // ELECTRON_RUN_AS_NODE plain Node 기동 차단
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false, // NODE_OPTIONS 주입 차단
    [FuseV1Options.OnlyLoadAppFromAsar]: true // 앱 코드는 asar에서만 (스왑 변조 방지)

    // EnableEmbeddedAsarIntegrityValidation 은 3주차 서명 파이프라인 확정 후
    // 검증을 거쳐 활성화 검토 (미검증 상태로 켜면 기동 실패 위험).
  });

  console.log('  • afterPack(fuses) 적용 완료 — ' + exeName +
    ' [EnableNodeCliInspectArguments=true(A42), RunAsNode=false, NodeOptions=false, OnlyLoadAppFromAsar=true]');

  // ── A46 경량화 ②: WebGPU 셰이더 컴파일러 DLL 제거 (약 27MB) ──────────────
  // dxcompiler.dll·dxil.dll은 Chromium이 WebGPU 초기화 시에만 지연 로드하는
  // DirectX 셰이더 컴파일러다. 본 앱(2D DOM 전용 HTML)은 WebGPU를 사용하지
  // 않으므로 안전하게 제외한다 — WebGPU만 비활성이 되고 일반 GPU 합성·
  // 렌더링(ANGLE/libGLESv2·vk_swiftshader)은 영향 없음.
  // 제거 후 패키지 exe 실기동 스모크(창 2개·렌더 정상)로 실증할 것.
  for (const dll of ['dxcompiler.dll', 'dxil.dll']) {
    const p = path.join(context.appOutDir, dll);
    if (fs.existsSync(p)) {
      fs.rmSync(p);
      console.log('  • afterPack(trim) 제거 — ' + dll + ' (WebGPU 전용, 미사용)');
    }
  }
};
