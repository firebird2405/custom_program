'use strict';
/**
 * 스토어 스크린샷용 한국어 샘플 데이터 (연출용 — 실사용 데이터 미사용)
 *
 * 이 모듈은 앱을 전혀 수정하지 않는다. 임시 프로필의 localStorage 에
 * 앱이 스스로 만들었을 형태 그대로의 값을 넣어 둘 뿐이다.
 *  - postit-notes        : [{id,text,color,x,y,rot,z,updatedAt,w?,h?,date?}]
 *  - postit-decor-layout : {boards:{b1:{stickers:[{id,type:'emoji',emoji,x,y,size}]}}}
 *  - cal-events          : {"YYYY-MM-DD":[{id,time,text}]}
 *    연동 일정 id 는 'postit-<노트id>' · 본문은 '📌 ' + 노트 첫 줄 (postit.html syncNoteToCalendar 규약)
 */

const NOW = Date.parse('2026-08-21T09:00:00');

/** 오늘(스크린샷 기준일) 로부터 n일 뒤의 YYYY-MM-DD */
function dayKey(offset) {
  const d = new Date(NOW);
  d.setDate(d.getDate() + offset);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

const YELLOW = '#FFD966';
const PINK = '#FFA9C0';
const GREEN = '#A0DC8E';
const SKY = '#9FD4FF';
const WHITE = '#FFFFFF';

/* 보드 배치 — 1920×1080 뷰포트 기준. 상단 툴바(≈14~70px)를 피해 y ≥ 130. */
const NOTES = [
  {
    id: 'demo-groceries', text: '장보기 🛒\n- [x] 우유\n- [ ] 딸기잼\n- [ ] 계란 한 판',
    color: YELLOW, x: 150, y: 210, rot: -2.4, z: 11, w: 210, h: 210,
    date: dayKey(1)
  },
  {
    id: 'demo-birthday', text: '엄마 생신 🎂\n케이크 예약하기\n(2시까지!)',
    color: PINK, x: 430, y: 165, rot: 1.8, z: 12, w: 210, h: 210,
    date: dayKey(4)
  },
  {
    id: 'demo-trip', text: '제주 여행 ✈️\n- [x] 비행기표\n- [ ] 숙소 결제\n- [ ] 렌터카',
    color: SKY, x: 715, y: 235, rot: -1.1, z: 13, w: 210, h: 210,
    date: dayKey(8)
  },
  {
    id: 'demo-books', text: '읽는 중 📚\n『작은 습관』\n67쪽 —',
    color: WHITE, x: 1005, y: 175, rot: 2.6, z: 14, w: 180, h: 180
  },
  {
    id: 'demo-workout', text: '운동 🏃‍♀️\n월·수·금 저녁 8시',
    color: GREEN, x: 1245, y: 250, rot: -3.1, z: 15, w: 190, h: 160
  },
  {
    id: 'demo-coffee', text: '커피 ☕\n원두 떨어짐!\n주문하기',
    color: YELLOW, x: 1520, y: 180, rot: 1.4, z: 16, w: 170, h: 170
  },
  {
    id: 'demo-study', text: '스터디 노트 ✏️\n- [x] 1장 정리\n- [ ] 2장 요약\n- [ ] 문제 풀이',
    color: WHITE, x: 205, y: 640, rot: 1.9, z: 17, w: 220, h: 210
  },
  {
    id: 'demo-movie', text: '보고 싶은 영화 🎬\n· 리틀 포레스트\n· 하나와 앨리스',
    color: PINK, x: 505, y: 690, rot: -2.2, z: 18, w: 210, h: 200
  },
  {
    id: 'demo-plant', text: '화분 물 주기 🪴\n일요일마다',
    color: GREEN, x: 800, y: 745, rot: 2.8, z: 19, w: 180, h: 150
  },
  {
    id: 'demo-thanks', text: '오늘 고마웠던 것 💛\n창가에 든 햇빛\n따뜻한 라떼 한 잔',
    color: YELLOW, x: 1060, y: 665, rot: -1.6, z: 20, w: 230, h: 200
  },
  {
    id: 'demo-call', text: '전화하기 📞\n할머니 · 목요일',
    color: SKY, x: 1370, y: 735, rot: 2.1, z: 21, w: 180, h: 150,
    date: dayKey(6)
  },
  {
    id: 'demo-idea', text: '아이디어 💡\n주말 브런치 모임\n메뉴 정하기',
    color: WHITE, x: 1620, y: 620, rot: -2.7, z: 22, w: 195, h: 190
  }
];

/* 이모지 스티커 — 보드 여백에 흩뿌려 "다꾸" 느낌을 낸다 (노트 뒤 레이어) */
const STICKERS = [
  { id: 'demo-st1', type: 'emoji', emoji: '🌼', x: 88, y: 455, size: 62 },
  { id: 'demo-st2', type: 'emoji', emoji: '🍓', x: 700, y: 545, size: 54 },
  { id: 'demo-st3', type: 'emoji', emoji: '🐰', x: 1235, y: 500, size: 66 },
  { id: 'demo-st4', type: 'emoji', emoji: '☁️', x: 1700, y: 320, size: 70 },
  { id: 'demo-st5', type: 'emoji', emoji: '⭐', x: 350, y: 905, size: 52 },
  { id: 'demo-st6', type: 'emoji', emoji: '🌙', x: 1000, y: 945, size: 58 },
  { id: 'demo-st7', type: 'emoji', emoji: '🧸', x: 1560, y: 930, size: 64 }
];

/* 손으로 넣은 일반 일정 — 연동 일정(📌)과 나란히 보여 대비를 만든다 */
const MANUAL_EVENTS = {
  [dayKey(-18)]: [{ id: 'demo-ev-a', time: '11:00', text: '도서관 반납', cat: 'c2' }],
  [dayKey(-13)]: [{ id: 'demo-ev-b', time: '19:00', text: '동생 이사 도와주기' }],
  [dayKey(-8)]: [{ id: 'demo-ev-6', time: '', text: '광복절 나들이', cat: 'c2' }],
  [dayKey(-6)]: [{ id: 'demo-ev-c', time: '09:30', text: '치과 상담', cat: 'c1' }],
  [dayKey(-3)]: [{ id: 'demo-ev-5', time: '20:00', text: '요가 수업', cat: 'c3' }],
  [dayKey(-1)]: [{ id: 'demo-ev-d', time: '13:00', text: '점심 약속 · 지현' }],
  [dayKey(0)]: [
    { id: 'demo-ev-1', time: '10:00', text: '치과 정기검진', cat: 'c1' },
    { id: 'demo-ev-e', time: '18:30', text: '장 보러 가기' }
  ],
  [dayKey(2)]: [{ id: 'demo-ev-2', time: '19:30', text: '독서 모임', cat: 'c3' }],
  [dayKey(4)]: [{ id: 'demo-ev-3', time: '18:00', text: '가족 저녁 식사', cat: 'c1' }],
  [dayKey(6)]: [{ id: 'demo-ev-f', time: '21:00', text: '드라마 본방', cat: 'c3' }],
  [dayKey(7)]: [{ id: 'demo-ev-4', time: '14:00', text: '미용실 예약' }],
  [dayKey(8)]: [{ id: 'demo-ev-7', time: '07:20', text: '김포공항 출발', cat: 'c2' }],
  [dayKey(10)]: [{ id: 'demo-ev-g', time: '', text: '한 달 살림 결산' }]
};

/** 노트 첫 줄 (postit.html noteFirstLine 과 동일 규약) */
function firstLine(t) {
  const nl = t.indexOf('\n');
  return nl >= 0 ? t.slice(0, nl) : t;
}

/** 노트의 date 필드로부터 cal-events 연동 일정을 만들어 수동 일정과 합친다 */
function buildCalEvents() {
  const store = {};
  for (const k of Object.keys(MANUAL_EVENTS)) store[k] = MANUAL_EVENTS[k].slice();
  for (const n of NOTES) {
    if (!n.date) continue;
    if (!Array.isArray(store[n.date])) store[n.date] = [];
    store[n.date].push({ id: 'postit-' + n.id, time: '', text: '📌 ' + firstLine(n.text) });
  }
  return store;
}

function postitNotes() {
  return NOTES.map((n, i) => Object.assign({ updatedAt: NOW - (NOTES.length - i) * 60000 }, n));
}

function decorLayout() {
  return { boards: { b1: { stickers: STICKERS } } };
}

module.exports = {
  NOW,
  dayKey,
  NOTES,
  STICKERS,
  firstLine,
  postitNotes,
  decorLayout,
  buildCalEvents
};
