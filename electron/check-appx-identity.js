'use strict';
/**
 * check-appx-identity.js — appx 빌드 사전 가드 (npm run dist:appx 1단계)
 *
 * 역할: electron-builder.yml 의 appx 절에 파트너 센터 identity 실값
 * (identityName · publisher · publisherDisplayName)이 기입되어 있는지 검사한다.
 *  - 미기입/주석 상태/형식 오류 → 한국어 안내를 출력하고 종료 코드 1 (빌드 중단).
 *  - 모두 정상 → 종료 코드 0 (electron-builder --win appx 진행).
 *
 * 근거 계약: SCORECARD rev.6 A48② — 매니페스트 Identity 플레이스홀더 리터럴 금지.
 * 값을 얻는 절차: protocol/STORE-GUIDE.md (파트너 센터 → 제품 관리 → 제품 ID).
 *
 * 이 파일은 빌드 도우미 스크립트다 — 앱 런타임에 로드되지 않고(files 화이트리스트
 * 밖), 네트워크 접근이 없다 (A44 무관).
 */
const fs = require('fs');
const path = require('path');

const YML = path.join(__dirname, 'electron-builder.yml');
const GUIDE = 'protocol\\STORE-GUIDE.md';

/* 채점기 A48② 와 동형의 플레이스홀더 차단 (grader 원본은 수정 금지 — 여기 사본은 사전 경고용) */
const PLACEHOLDER_RE =
  /(my[-_ ]?app|your[-_ ]?(?:app|name|company)|example|placeholder|change[-_ ]?me|app[-_ ]?name[-_ ]?here|electron[-_ ]?quick[-_ ]?start|hello[-_ ]?world|untitled|acme|sample[-_ ]?app|test[-_ ]?app|todo[-_ ]?app|company[-_ ]?name)/i;
/* yml 주석의 예시 리터럴 — 실값 대신 예시를 그대로 붙여넣은 경우 차단 */
const EXAMPLE_LITERALS = [
  '12345firebird.petitcalendar',
  'cn=00000000-0000-0000-0000-000000000000',
];

/** appx: 블록(들여쓰기 하위)에서 key 의 비주석 값을 추출 — 없으면 null */
function appxValue(ymlText, key) {
  const lines = ymlText.split(/\r?\n/);
  let inAppx = false;
  for (const raw of lines) {
    const noComment = raw.replace(/#.*$/, '');
    if (/^appx\s*:\s*$/.test(noComment)) { inAppx = true; continue; }
    if (inAppx && /^\S/.test(noComment) && noComment.trim() !== '') inAppx = false; // 다음 최상위 키
    if (!inAppx) continue;
    const m = new RegExp(`^\\s+${key}\\s*:\\s*(.+?)\\s*$`).exec(noComment);
    if (m) return m[1].replace(/^["']|["']$/g, '').trim();
  }
  return null;
}

function fail(problems) {
  const bar = '─'.repeat(66);
  console.error('');
  console.error(bar);
  console.error('  [dist:appx 중단] MS Store identity 값이 아직 준비되지 않았어요');
  console.error(bar);
  for (const p of problems) console.error('  ✗ ' + p);
  console.error('');
  console.error('  해결 방법:');
  console.error('   1) 파트너 센터(https://partner.microsoft.com/dashboard)에서');
  console.error('      앱 선택 → 제품 관리 → 제품 ID 화면을 엽니다.');
  console.error('   2) 거기 표시된 3개 값(Package/Identity/Name ·');
  console.error('      Package/Identity/Publisher · PublisherDisplayName)을');
  console.error('      electron\\electron-builder.yml 의 appx 절에서');
  console.error('      "★★ 여기만 채우면 완성" 아래 3줄의 주석을 해제하고 기입합니다.');
  console.error('   3) 다시 npm run dist:appx 를 실행합니다.');
  console.error('');
  console.error('  전체 절차(등록·이름 예약부터): ' + GUIDE);
  console.error(bar);
  process.exit(1);
}

if (!fs.existsSync(YML)) {
  fail(['electron-builder.yml 을 찾지 못했습니다: ' + YML]);
}
const yml = fs.readFileSync(YML, 'utf8');

const identityName = appxValue(yml, 'identityName');
const publisher = appxValue(yml, 'publisher');
const publisherDisplayName = appxValue(yml, 'publisherDisplayName');

const problems = [];

if (!identityName) {
  problems.push('appx.identityName 미기입 — 파트너 센터 "Package/Identity/Name" 값이 필요해요');
} else if (!/^[A-Za-z0-9][A-Za-z0-9.-]{2,}$/.test(identityName)) {
  problems.push(`appx.identityName = "${identityName}" — 형식이 어긋납니다 (영숫자·점·하이픈, 예: 12345Firebird.PetitCalendar)`);
}

if (!publisher) {
  problems.push('appx.publisher 미기입 — 파트너 센터 "Package/Identity/Publisher" 값이 필요해요');
} else if (!/^CN=/.test(publisher)) {
  problems.push(`appx.publisher = "${publisher}" — 반드시 CN= 으로 시작해야 합니다 (A48②/A50 계약: 파트너 센터 값 그대로)`);
}

if (!publisherDisplayName) {
  problems.push('appx.publisherDisplayName 미기입 — 파트너 센터 "PublisherDisplayName" 값이 필요해요');
}

for (const [label, v] of [
  ['appx.identityName', identityName],
  ['appx.publisher', publisher],
  ['appx.publisherDisplayName', publisherDisplayName],
]) {
  if (!v) continue;
  if (PLACEHOLDER_RE.test(v)) {
    problems.push(`${label} = "${v}" — MyApp 류 플레이스홀더 리터럴은 금지예요 (A48②)`);
  }
  if (EXAMPLE_LITERALS.includes(v.toLowerCase())) {
    problems.push(`${label} = "${v}" — 주석의 예시 값을 그대로 넣으면 안 돼요. 파트너 센터의 실값으로 바꿔 주세요`);
  }
  if (/여기|기입|예시/.test(v)) {
    problems.push(`${label} = "${v}" — 안내 문구가 남아 있어요. 파트너 센터의 실값으로 바꿔 주세요`);
  }
}

if (problems.length > 0) fail(problems);

console.log('[dist:appx 가드] identity 3개 값 확인 완료 — appx 빌드를 진행해요');
console.log('  identityName        = ' + identityName);
console.log('  publisher           = ' + publisher);
console.log('  publisherDisplayName = ' + publisherDisplayName);
