'use strict';
/**
 * 앱 소스(calendar.html / postit.html) 정적 검사 — SCORECARD B 조항 + 채점 메커니즘 공통 규정.
 *
 * 원칙: "사용자 텍스트" 경로를 겨냥한다.
 *  - innerHTML / outerHTML / insertAdjacentHTML:
 *      순수 문자열 리터럴(리터럴끼리의 + 연결 포함)만 허용 — 정적 템플릿·data-URI 파비콘은 통과.
 *      변수·함수호출·템플릿 보간(${})이 섞인 대입/인자는 위반. 복합대입(+= 등)은 무조건 위반.
 *  - document.write(ln) · DOMParser · createContextualFragment · eval · new Function/Function(): 사용 자체 위반.
 *  - setAttribute("on..."): 리터럴 on* 이벤트 속성명 위반.
 *  - window.onerror / window.onunhandledrejection / console(.*) 재정의: 위반 (에러 은폐 차단).
 *      (요소별 핸들러 대입 예: reader.onerror = ... 은 대상 아님 — 점(.) 선행 검사로 제외)
 *
 * 전처리: HTML 주석 제거 → 상태기계 토크나이저로 JS/CSS 주석 제거 + 문자열 리터럴 내용을 '_' 로 마스킹.
 *  템플릿 리터럴의 ${ } 구분자는 보존되어 "보간 존재 = 비리터럴"로 판정된다.
 *  마스킹 덕에 문자열/주석 안의 싱크 이름은 오탐하지 않는다.
 * 한계: 정규식 리터럴 안의 따옴표·이중 슬래시는 상태를 흐트러뜨릴 수 있다 — 앱 소스는 이를 피해 작성할 것.
 */
const fs = require('fs');

/** HTML 주석을 길이 보존(개행 유지)하며 공백으로 치환 */
function stripHtmlComments(src) {
  return src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
}

/**
 * @returns {{masked:string, noComments:string}}
 *  masked: 주석 제거 + 문자열 내용 '_' 마스킹 (따옴표·백틱·${ } 는 보존)
 *  noComments: 주석만 제거, 문자열 원문 유지 (setAttribute("on...") 검사용)
 */
function tokenize(src) {
  const masked = src.split('');
  const noComments = src.split('');
  const n = src.length;
  let i = 0;
  let state = 'code';
  const interpStack = []; // 템플릿 보간 ${ } 중첩별 중괄호 깊이

  while (i < n) {
    const c = src[i];
    const d = i + 1 < n ? src[i + 1] : '';
    if (state === 'code') {
      if (c === "'") { state = 'squote'; i++; }
      else if (c === '"') { state = 'dquote'; i++; }
      else if (c === '`') { state = 'template'; i++; }
      else if (c === '/' && d === '/') { masked[i] = noComments[i] = ' '; masked[i + 1] = noComments[i + 1] = ' '; state = 'line'; i += 2; }
      else if (c === '/' && d === '*') { masked[i] = noComments[i] = ' '; masked[i + 1] = noComments[i + 1] = ' '; state = 'block'; i += 2; }
      else if (c === '{' && interpStack.length) { interpStack[interpStack.length - 1]++; i++; }
      else if (c === '}' && interpStack.length) {
        if (interpStack[interpStack.length - 1] === 0) { interpStack.pop(); state = 'template'; }
        else interpStack[interpStack.length - 1]--;
        i++;
      } else i++;
    } else if (state === 'squote' || state === 'dquote') {
      const q = state === 'squote' ? "'" : '"';
      if (c === '\\') { masked[i] = '_'; if (i + 1 < n && src[i + 1] !== '\n') masked[i + 1] = '_'; i += 2; }
      else if (c === q) { state = 'code'; i++; }
      else if (c === '\n') { state = 'code'; i++; } // 비정상 종단 방어
      else { masked[i] = '_'; i++; }
    } else if (state === 'template') {
      if (c === '\\') { masked[i] = '_'; if (i + 1 < n && src[i + 1] !== '\n') masked[i + 1] = '_'; i += 2; }
      else if (c === '`') { state = 'code'; i++; }
      else if (c === '$' && d === '{') { interpStack.push(0); state = 'code'; i += 2; } // ${ 보존
      else if (c === '\n') { i++; }
      else { masked[i] = '_'; i++; }
    } else if (state === 'line') {
      if (c === '\n') { state = 'code'; i++; }
      else { masked[i] = noComments[i] = ' '; i++; }
    } else { // block
      if (c === '*' && d === '/') { masked[i] = noComments[i] = ' '; masked[i + 1] = noComments[i + 1] = ' '; state = 'code'; i += 2; }
      else if (c === '\n') { i++; }
      else { masked[i] = noComments[i] = ' '; i++; }
    }
  }
  return { masked: masked.join(''), noComments: noComments.join('') };
}

/* 마스킹된 코드에서 "순수 리터럴" 모양: '___' / "___" / 보간 없는 `___` (리터럴끼리 + 연결 허용) */
const LITERAL_CHAIN = /^\s*(?:'_*'|"_*"|`[_\s]*`)(?:\s*\+\s*(?:'_*'|"_*"|`[_\s]*`))*\s*(?:[;),\]}\n]|$)/;
const IAH_LITERAL_ARGS = /^\s*(?:'_*'|"_*")\s*,\s*(?:'_*'|"_*"|`[_\s]*`)(?:\s*\+\s*(?:'_*'|"_*"|`[_\s]*`))*\s*\)/;

/* 마스킹된 코드 대상 — 사용 자체 금지 + 에러 은폐 재정의 금지 */
const MASKED_RULES = [
  { re: /(?<![\w$.])eval\s*\(/g, rule: 'eval() 호출 금지 (SCORECARD B)' },
  { re: /(?<![\w$.])new\s+Function\b/g, rule: 'new Function 금지 (SCORECARD B)' },
  { re: /(?<![\w$.])Function\s*\(/g, rule: 'Function 생성자 호출 금지 (SCORECARD B)' },
  { re: /(?<![\w$.])DOMParser\b/g, rule: 'DOMParser 금지 (SCORECARD B)' },
  { re: /\.\s*createContextualFragment\s*\(/g, rule: 'createContextualFragment 금지 (SCORECARD B)' },
  { re: /document\s*\.\s*write(?:ln)?\s*\(/g, rule: 'document.write/writeln 금지 (SCORECARD B)' },
  { re: /(?<![\w$.])(?:(?:window|self|globalThis)\s*\.\s*)?onerror\s*=(?!=)/g, rule: 'window.onerror 재정의 금지 (에러 은폐 차단)' },
  { re: /(?<![\w$.])(?:(?:window|self|globalThis)\s*\.\s*)?onunhandledrejection\s*=(?!=)/g, rule: 'window.onunhandledrejection 재정의 금지 (에러 은폐 차단)' },
  { re: /(?<![\w$.])(?:(?:window|self|globalThis)\s*\.\s*)?console\s*(?:\.\s*[A-Za-z_$][\w$]*\s*)?=(?!=)/g, rule: 'console 재정의 금지 (에러 은폐 차단)' },
  { re: /defineProperty\s*\(\s*console\b/g, rule: 'console 재정의(defineProperty) 금지 (에러 은폐 차단)' },
];

/* 주석만 제거된(문자열 원문 유지) 코드 대상 — 문자열 인자를 봐야 하는 규칙 */
const NOCOMMENT_RULES = [
  { re: /defineProperty\s*\(\s*(?:window|self|globalThis)\s*,\s*(['"`])on(?:error|unhandledrejection)\1/g, rule: 'window.onerror/onunhandledrejection 재정의(defineProperty) 금지 (에러 은폐 차단)' },
];

function lineOfIndex(src, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < src.length; i++) if (src[i] === '\n') line++;
  return line;
}

function snippetAt(original, idx) {
  const start = original.lastIndexOf('\n', idx) + 1;
  let end = original.indexOf('\n', idx);
  if (end < 0) end = original.length;
  return original.slice(start, end).trim().slice(0, 160);
}

/** @returns {{line:number, rule:string, snippet:string}[]} 위반 목록 (없으면 빈 배열) */
function scanSource(original) {
  const pre = stripHtmlComments(original);
  const { masked, noComments } = tokenize(pre);
  const raw = [];
  const add = (idx, rule) => raw.push({ index: idx, line: lineOfIndex(original, idx), rule, snippet: snippetAt(original, idx) });

  for (const { re, rule } of MASKED_RULES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(masked)) !== null) add(m.index, rule);
  }

  for (const { re, rule } of NOCOMMENT_RULES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(noComments)) !== null) add(m.index, rule);
  }

  // innerHTML / outerHTML 대입 — 순수 리터럴 우변만 허용
  const assignRe = /\.\s*(innerHTML|outerHTML)\s*([+\-*/%&|^?]{0,2}=)(?!=)/g;
  let m;
  while ((m = assignRe.exec(masked)) !== null) {
    const rest = masked.slice(m.index + m[0].length);
    if (m[2] !== '=') add(m.index, m[1] + ' 복합 대입(연결) 금지 (SCORECARD B)');
    else if (!LITERAL_CHAIN.test(rest)) add(m.index, m[1] + ' 비리터럴 대입 금지 — 사용자 텍스트는 textContent/createElement만 (SCORECARD B)');
  }

  // insertAdjacentHTML — 두 인자 모두 리터럴만 허용
  const iahRe = /\.\s*insertAdjacentHTML\s*\(/g;
  while ((m = iahRe.exec(masked)) !== null) {
    const rest = masked.slice(m.index + m[0].length);
    if (!IAH_LITERAL_ARGS.test(rest)) add(m.index, 'insertAdjacentHTML 비리터럴 인자 금지 (SCORECARD B)');
  }

  // setAttribute("on...") — 문자열 원문 보존본에서 검사
  const setAttrRe = /\.\s*setAttribute\s*\(\s*(['"`])on[a-zA-Z]+\1/g;
  while ((m = setAttrRe.exec(noComments)) !== null) add(m.index, 'setAttribute("on...") 금지 (SCORECARD B)');

  raw.sort((a, b) => a.index - b.index);
  return raw.map(({ line, rule, snippet }) => ({ line, rule, snippet }));
}

function scanFile(filePath) {
  return scanSource(fs.readFileSync(filePath, 'utf8'));
}

module.exports = { scanFile, scanSource, tokenize, stripHtmlComments };
