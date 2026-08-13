'use strict';
/**
 * A7 — 공휴일 전수 검사 (SCORECARD A7)
 * 채점기에 내장된 2026–27 대한민국 공휴일 전체 목록(lib/holidays.js, 대체공휴일 포함)을
 * 월 이동 버튼으로 전수 검사한다:
 *  - 각 날짜 셀에 공휴일 이름이 visible (font-size ≥ 10px)
 *  - computed color 가 적색 우세 (r ≥ 150 이고 r ≥ 1.5 × max(g, b))
 * 전 테스트 공통: dialog 0건.
 */
const { test, expect } = require('@playwright/test');
const { CALENDAR_PATH, withFreshApp } = require('../lib/helpers');
const HOLIDAYS = require('../lib/holidays');

test.describe('A7 공휴일 표기', () => {
  test('A7: 2026–27 공휴일 전수 — 이름 visible(font-size≥10px) + 적색 우세(r≥150, r≥1.5×max(g,b))', async () => {
    const byMonth = new Map();
    for (const h of HOLIDAYS) {
      const mk = h.date.slice(0, 7); // YYYY-MM
      if (!byMonth.has(mk)) byMonth.set(mk, []);
      byMonth.get(mk).push(h);
    }

    await withFreshApp(CALENDAR_PATH, async ({ page, state }) => {
      const readMonth = () =>
        page.evaluate(() => {
          const m = document.getElementById('monthTitle').textContent.match(/(\d+)년\s*(\d+)월/);
          return m ? { y: Number(m[1]), m: Number(m[2]) } : null;
        });

      // 이전 달 버튼으로 2026년 1월까지 이동 (이후 다음 달 버튼으로 2027년 12월까지 전진)
      for (let guard = 0; guard < 60; guard++) {
        const cur = await readMonth();
        expect(cur, '#monthTitle 에서 연·월을 읽을 수 없습니다').not.toBeNull();
        if (cur.y * 100 + cur.m <= 202601) break;
        await page.click('#prevBtn');
      }
      const start = await readMonth();
      expect(
        start.y * 100 + start.m,
        `이전 달 이동으로 2026년 1월에 도달하지 못했습니다 (현재 ${start.y}년 ${start.m}월)`
      ).toBe(202601);

      const problems = [];
      for (let y = 2026; y <= 2027; y++) {
        for (let mo = 1; mo <= 12; mo++) {
          const cur = await readMonth();
          expect(
            cur.y * 100 + cur.m,
            `월 이동 오류: ${y}년 ${mo}월이어야 하는데 ${cur.y}년 ${cur.m}월이 표시 중입니다`
          ).toBe(y * 100 + mo);

          const expected = byMonth.get(`${y}-${String(mo).padStart(2, '0')}`) || [];
          if (expected.length) {
            const results = await page.evaluate((hols) => {
              return hols
                .map((h) => {
                  const day = Number(h.date.slice(8, 10));
                  const cells = Array.from(document.querySelectorAll('#grid .cell')).filter(
                    (c) => !c.classList.contains('other')
                  );
                  const cell = cells.find((c) => {
                    const n = c.querySelector('.num');
                    return n && n.textContent.trim() === String(day);
                  });
                  if (!cell) return { date: h.date, name: h.name, problem: '해당 날짜 셀을 찾을 수 없음' };

                  // 셀 안에서 공휴일 이름과 정확히 일치하는 가장 안쪽 요소를 찾는다 (클래스명에 비의존)
                  const nodes = Array.from(cell.querySelectorAll('*')).filter(
                    (el) => el.textContent.trim() === h.name
                  );
                  const el = nodes.length ? nodes[nodes.length - 1] : null;
                  if (!el) return { date: h.date, name: h.name, problem: '셀 안에 공휴일 이름 표기가 없음' };

                  const s = getComputedStyle(el);
                  const r = el.getBoundingClientRect();
                  if (!(r.width > 0 && r.height > 0) || s.display === 'none' || s.visibility === 'hidden') {
                    return { date: h.date, name: h.name, problem: '이름이 visible 상태가 아님' };
                  }
                  const fontSize = parseFloat(s.fontSize);
                  if (!(fontSize >= 10)) {
                    return { date: h.date, name: h.name, problem: `font-size ${fontSize}px (10px 이상이어야 함)` };
                  }
                  const cm = s.color.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
                  if (!cm) return { date: h.date, name: h.name, problem: `글자색 해석 불가: ${s.color}` };
                  const cr = Number(cm[1]);
                  const cg = Number(cm[2]);
                  const cb = Number(cm[3]);
                  if (!(cr >= 150 && cr >= 1.5 * Math.max(cg, cb))) {
                    return {
                      date: h.date,
                      name: h.name,
                      problem: `적색 우세 아님: rgb(${cr},${cg},${cb}) (r≥150 이고 r≥1.5×max(g,b) 필요)`,
                    };
                  }
                  return null;
                })
                .filter(Boolean);
            }, expected);
            problems.push(...results);
          }

          if (!(y === 2027 && mo === 12)) await page.click('#nextBtn');
        }
      }

      expect(
        problems,
        `공휴일 표기 불합격 ${problems.length}건:\n` +
          problems.map((p) => `  - ${p.date} ${p.name}: ${p.problem}`).join('\n')
      ).toEqual([]);
      expect(
        state.dialogs,
        `dialog ${state.dialogs.length}건 발생 (A9 외 0건이어야 함): ${state.dialogs
          .map((d) => d.type + ':' + d.message)
          .join(' | ')}`
      ).toHaveLength(0);
    });
  });
});
