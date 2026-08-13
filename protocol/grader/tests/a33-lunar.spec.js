'use strict';
/**
 * A33 — 음력 표기 (rev.5 설계서 §1 A33 / §2 A33, C4)
 * "각 날짜 셀의 [data-lunar] 음력 표기에서: 여섯 앵커(설날 2026-02-17·2027-02-07=음1/1,
 *  추석 2026-09-25·2027-09-15=음8/15, 석가탄신일 2026-05-24·2027-05-13=음4/8 — lib/holidays.js
 *  원장 기준)의 (월,일)이 전부 일치하고, 검사한 각 달의 모든 셀에서 음력 일이 전일 대비 +1 또는
 *  1로 리셋으로만 진행하며(앵커만 하드코딩 차단), 표기가 visible(font-size ≥ 9px)이다"
 *
 * ── rev.5 필수 DOM 계약 (설계서 §2 A33 — 그대로 기록) ──
 * [data-lunar] — 각 날짜 셀 내부. 표기 형식은 음M.D / M/D 등 자유이되 정규식
 * /(\d{1,2})\s*[.\/]\s*(\d{1,2})/ 로 (월,일)이 추출 가능해야 하고 윤달은 "윤" 접두 허용
 * (정규식 앞 텍스트 무시). 변환 테이블은 앱 내장(오프라인, A1 준수)·최소 2026–2027 커버.
 * 신규 훅은 폴백 셀렉터 없음: data-속성 부재 = 즉시 FAIL (fail-closed).
 *
 * 굿하트 차단 (설계서 §6): 여섯 앵커 날짜만 하드코딩 → 검사한 각 달의 본월 셀 전체를 날짜순으로
 * 순회하며 음력 일 진행(+1 또는 1 리셋)을 전수 검사.
 */
const { test, expect } = require('@playwright/test');
const { CALENDAR_PATH, withFreshApp, requireHook, assertNoDialogs, sleep } = require('../lib/helpers');
const HOLIDAYS = require('../lib/holidays');

const LUNAR_RE = /(\d{1,2})\s*[.\/]\s*(\d{1,2})/;

/* 앵커 6종 상수화 (설계서 §2 A33) — lib/holidays.js 원장과 교차 검증한다 */
const ANCHORS = [
  { date: '2026-02-17', name: '설날', m: 1, d: 1 },
  { date: '2027-02-07', name: '설날', m: 1, d: 1 },
  { date: '2026-09-25', name: '추석', m: 8, d: 15 },
  { date: '2027-09-15', name: '추석', m: 8, d: 15 }, // 설계서 §1 정정: 2027년 추석 = 2027-09-15 (원장 일치)
  { date: '2026-05-24', name: '석가탄신일', m: 4, d: 8 },
  { date: '2027-05-13', name: '석가탄신일', m: 4, d: 8 },
];

function readMonth(page) {
  return page.evaluate(() => {
    const m = document.getElementById('monthTitle').textContent.match(/(\d+)년\s*(\d+)월/);
    return m ? { y: Number(m[1]), m: Number(m[2]) } : null;
  });
}

async function gotoMonth(page, y, m, label) {
  for (let guard = 0; guard < 40; guard++) {
    const cur = await readMonth(page);
    if (!cur) throw new Error(`${label}: #monthTitle 에서 연·월을 읽을 수 없습니다`);
    const diff = y * 12 + m - (cur.y * 12 + cur.m);
    if (diff === 0) return;
    await page.click(diff > 0 ? '#nextBtn' : '#prevBtn');
  }
  throw new Error(`${label}: 월 이동으로 ${y}년 ${m}월에 도달하지 못했습니다`);
}

test.describe('A33 음력 표기', () => {
  test('A33: 여섯 앵커(설날·추석·석가탄신일, 원장 대조) (월,일) 일치 + 검사 월 전 셀 연속성(+1/1 리셋) + visible(font-size ≥ 9px)', async () => {
    // 앵커 상수를 채점기 공휴일 원장(lib/holidays.js)과 교차 검증 — 원장 이탈 시 즉시 FAIL
    for (const a of ANCHORS) {
      expect(
        HOLIDAYS.some((h) => h.date === a.date && h.name === a.name),
        `A33: 앵커 ${a.date} (${a.name}) 이 채점기 공휴일 원장(lib/holidays.js)에 없습니다 — 앵커·원장 불일치`
      ).toBe(true);
    }

    // 검사 월: 앵커가 속한 모든 달 (날짜순)
    const months = Array.from(new Set(ANCHORS.map((a) => a.date.slice(0, 7)))).sort();

    await withFreshApp(CALENDAR_PATH, async ({ page, state }) => {
      await requireHook(page, '[data-lunar]', 'A33');
      const problems = [];

      for (const mk of months) {
        const y = Number(mk.slice(0, 4));
        const mo = Number(mk.slice(5, 7));
        await gotoMonth(page, y, mo, 'A33');

        // 월 전환 페이드(C7 장식 애니메이션, opacity 0→1)가 끝난 뒤 샘플링 —
        // 유효 opacity 판정은 정착 상태 기준 (최대 1.5초 대기 후 진행, 실제 단언은 아래 per-셀 검사)
        const animDeadline = Date.now() + 1500;
        while (Date.now() < animDeadline) {
          const running = await page.evaluate(
            () =>
              typeof document.getAnimations === 'function' &&
              document.getAnimations().some((a) => a.playState === 'running')
          );
          if (!running) break;
          await sleep(60);
        }

        // 본월 셀 전체 (다른 달 셀 제외, DOM 순서 = 날짜순)의 [data-lunar] 채집
        const cells = await page.evaluate(() => {
          const effOpacity = (el) => {
            let o = 1;
            for (let c = el; c && c.nodeType === 1; c = c.parentElement) o *= parseFloat(getComputedStyle(c).opacity) || 0;
            return o;
          };
          return Array.from(document.querySelectorAll('#grid .cell:not(.other)')).map((cell) => {
            const numEl = cell.querySelector('.num');
            const lun = cell.querySelector('[data-lunar]');
            const day = numEl ? Number(numEl.textContent.trim()) : -1;
            if (!lun) return { day, missing: true };
            const s = getComputedStyle(lun);
            const r = lun.getBoundingClientRect();
            return {
              day,
              text: (lun.textContent || '').trim(),
              fontSize: parseFloat(s.fontSize) || 0,
              visible:
                r.width > 0 &&
                r.height > 0 &&
                s.display !== 'none' &&
                s.visibility !== 'hidden' &&
                effOpacity(lun) > 0.05,
            };
          });
        });

        if (cells.length < 28) {
          problems.push(`${mk}: 본월 날짜 셀이 ${cells.length}개 (28개 이상이어야 함)`);
          continue;
        }

        let prevDay = null;
        const lunarByDay = {};
        for (const c of cells) {
          if (c.missing) {
            problems.push(`${mk}-${String(c.day).padStart(2, '0')}: [data-lunar] 부재 (fail-closed: 전 셀 필수)`);
            prevDay = null;
            continue;
          }
          const m2 = LUNAR_RE.exec(c.text);
          if (!m2) {
            problems.push(
              `${mk}-${String(c.day).padStart(2, '0')}: [data-lunar] 텍스트 "${c.text}" 에서 (월,일)을 추출할 수 없습니다`
            );
            prevDay = null;
            continue;
          }
          const lm = Number(m2[1]);
          const ld = Number(m2[2]);
          lunarByDay[c.day] = { m: lm, d: ld };
          if (!c.visible) problems.push(`${mk}-${String(c.day).padStart(2, '0')}: [data-lunar] 이 visible 상태가 아닙니다`);
          if (!(c.fontSize >= 9)) {
            problems.push(
              `${mk}-${String(c.day).padStart(2, '0')}: [data-lunar] font-size ${c.fontSize}px (9px 이상이어야 함)`
            );
          }
          // 연속성: 전일 대비 +1 또는 1 리셋만 허용 (앵커만 하드코딩하는 우회 차단)
          if (prevDay !== null && !(ld === prevDay + 1 || ld === 1)) {
            problems.push(
              `${mk}-${String(c.day).padStart(2, '0')}: 음력 일 진행 위반 — 전일 음력 ${prevDay}일 다음이 ${ld}일 (+1 또는 1 리셋만 허용)`
            );
          }
          prevDay = ld;
        }

        // 이 달의 앵커 (월,일) 대조
        for (const a of ANCHORS.filter((x) => x.date.slice(0, 7) === mk)) {
          const day = Number(a.date.slice(8, 10));
          const got = lunarByDay[day];
          if (!got) {
            problems.push(`${a.date} (${a.name}): 셀의 [data-lunar] 값을 읽지 못했습니다`);
          } else if (got.m !== a.m || got.d !== a.d) {
            problems.push(
              `${a.date} (${a.name}): 음력 표기 (${got.m},${got.d}) — 기대값 (${a.m},${a.d}) 과 불일치 (lib/holidays.js 원장 기준)`
            );
          }
        }
      }

      expect(
        problems,
        `A33 음력 표기 불합격 ${problems.length}건:\n` + problems.map((p) => '  - ' + p).join('\n')
      ).toEqual([]);
      assertNoDialogs(state, 'A33');
    });
  });
});
