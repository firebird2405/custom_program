// ============================================================================
// 쁘띠캘린더 — 셸 탭바 preload (단일 창 탭 모드의 탭바 페이지 전용 브리지)
//
// 계약 (protocol/SCORECARD.md rev.8 A42·A49③):
//   - contextBridge 로 "이름 붙은 채널 화이트리스트 API"(window.petitShell)만 노출.
//     ipcRenderer 원본·require·Node 모듈 노출 0건, 채널 인자는 전부 문자열 리터럴.
//   - 노출 API: { getState, switchTab, setSettings, setStartup, setAlwaysOnTop, captureBoard,
//     onUiPush } — 각각 Promise/구독.
//     인자는 여기서 전부 검증·정규화한다 (main 쪽 assertTrustedSender 와 이중 방어).
//   - 창 구성 변경(창 분리·재병합) 브리지는 rev.8 에서 폐지됐다 — 창은 항상 1개다.
//   - A44: 이 파일은 http/https/net/dns/dgram/tls 를 일절 require 하지 않는다.
//
// 주의: sandbox:true 프리로드 — 사용 가능한 모듈은 electron(contextBridge·ipcRenderer)뿐.
// ============================================================================

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const petitShellApi = {
  /** 셸 상태 조회 — { ok, activeTab, defaultTab, alarms } */
  getState: function () {
    return ipcRenderer.invoke('petit:shell:state');
  },

  /** 활성 탭 전환 — 'postit' | 'calendar' 만 통과 (그 외는 postit 으로 정규화) */
  switchTab: function (tab) {
    return ipcRenderer.invoke('petit:shell:switch-tab', tab === 'calendar' ? 'calendar' : 'postit');
  },

  /**
   * 셸 설정 저장 — { defaultTab? } 는 즉시 영속.
   * panelOpen(boolean, 비영속)은 설정 드로어 개폐 전달용 — 열려 있는 동안
   * main 이 앱 뷰를 드로어 높이만큼 내려 드로어가 가려지지 않게 한다.
   */
  setSettings: function (patch) {
    const p = patch && typeof patch === 'object' ? patch : {};
    const clean = {};
    if (p.defaultTab === 'postit' || p.defaultTab === 'calendar') clean.defaultTab = p.defaultTab;
    if (typeof p.panelOpen === 'boolean') clean.panelOpen = p.panelOpen;
    return ipcRenderer.invoke('petit:shell:set-settings', clean);
  },

  /**
   * 항상 위 토글 (발주 #30) — 인자는 boolean 으로 정규화한다.
   * 상태의 정본은 창 실측값(win.isAlwaysOnTop)이며 main 이 적용 후 실측값을 되돌려준다:
   * { ok:true, alwaysOnTop } 또는 { ok:false, alwaysOnTop(실측), reason }.
   * 설정은 shell-settings.json 의 additive 필드에 영속된다 (기본 꺼짐).
   */
  setAlwaysOnTop: function (on) {
    return ipcRenderer.invoke('petit:shell:set-always-on-top', on === true);
  },

  /**
   * 보드 자랑하기 (발주 #31) — 지금 활성인 앱 뷰만 그림으로 담는다 (탭바 미포함).
   * mode: 'file' = PNG 저장 대화상자 / 그 외 = 클립보드 복사. 전부 로컬 처리 (외부 전송 0).
   */
  captureBoard: function (mode) {
    return ipcRenderer.invoke('petit:shell:capture-board', mode === 'file' ? 'file' : 'clipboard');
  },

  /**
   * 윈도우 시작 시 자동 실행 토글 — 인자는 boolean 으로 정규화한다.
   * 상태의 단일 진실은 OS(레지스트리 Run 항목)이며 main 이 실제 적용값을 되돌려준다:
   * { ok:true, openAtLogin } 또는 { ok:false, openAtLogin(실측), reason }.
   */
  setStartup: function (on) {
    return ipcRenderer.invoke('petit:shell:set-startup', on === true);
  },

  /**
   * main → 탭바 상태 push 구독 — 탭바 요청 없이 바뀐 셸 상태(단축키 탭 전환,
   * 백그라운드 캘린더의 일정 알림 배지 누적/해제, 앱 설정 모달 쪽 자동 실행 토글)를
   * 받아 표시를 갱신한다.
   * 핸들러에는 getState 와 동형의 페이로드({ ok, activeTab, defaultTab, openAtLogin,
   * alwaysOnTop, version, alarms })가 온다.
   * (수신 전용 — 페이지가 채널을 지정할 수 없다: 채널 인자는 문자열 리터럴, A49③)
   */
  onUiPush: function (handler) {
    if (typeof handler !== 'function') return;
    ipcRenderer.on('petit:shell:ui-push', function (_event, payload) {
      handler(payload && typeof payload === 'object' ? payload : null);
    });
  }
};

contextBridge.exposeInMainWorld('petitShell', petitShellApi);
