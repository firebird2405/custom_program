'use strict';
/**
 * 촬영 주석용 마우스 커서 그림.
 *
 * 헤드리스 캡처에는 OS 커서가 찍히지 않는다. 드래그 장면에서 "지금 손으로 잡고 있다"는
 * 사실이 사라지므로, 촬영 시점의 실제 포인터 좌표에 커서를 덧그린다.
 * 모양은 앱이 드래그 중 실제로 지정하는 CSS `cursor: grabbing`(주먹) 과 같은 계열이다.
 *
 * 구현: 같은 도형 묶음을 두 번 그린다.
 *   1) 굵은 검은 테두리 + 검은 채움 → 합집합 실루엣 (내부 경계선이 생기지 않는다)
 *   2) 흰 채움 → 안쪽
 *   3) 손가락 경계선 몇 개만 얇게 → "손"으로 읽히게
 */

const CURSOR_SVG_RAW =
  "<svg xmlns='http://www.w3.org/2000/svg' width='100%' height='100%' viewBox='0 0 30 34'>" +
    "<defs><g id='fist'>" +
      "<rect x='5.2' y='15.5' width='19.6' height='15.5' rx='6.2'/>" +
      "<rect x='6.6' y='12.6' width='5.6' height='8' rx='2.8'/>" +
      "<rect x='11.6' y='11.2' width='5.8' height='9' rx='2.9'/>" +
      "<rect x='16.9' y='12.2' width='5.6' height='8.4' rx='2.8'/>" +
      "<rect x='21.4' y='14.4' width='5.2' height='7.4' rx='2.6'/>" +
      "<rect x='2.4' y='18.4' width='7.6' height='8.6' rx='3.8'/>" +
    "</g></defs>" +
    "<use href='#fist' fill='#141414' stroke='#141414' stroke-width='3.4' stroke-linejoin='round'/>" +
    "<use href='#fist' fill='#ffffff'/>" +
    "<g stroke='#141414' stroke-width='1.15' stroke-linecap='round' fill='none' opacity='0.9'>" +
      "<path d='M11.9 13.6 V19.4'/>" +
      "<path d='M17.2 13.0 V19.4'/>" +
      "<path d='M21.8 15.2 V20.4'/>" +
      "<path d='M10.1 20.2 q1.1 3.2 -0.2 6.2'/>" +
    "</g>" +
  "</svg>";

/** background-image 로 쓸 data URI */
const CURSOR_URI =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(CURSOR_SVG_RAW);

/** 그림 안에서 실제 포인터가 가리키는 지점 (viewBox 30×34 기준 → 34×38 렌더 기준 오프셋) */
const HOTSPOT = { x: 15, y: 20 };
const SIZE = { w: 42, h: 47 };

module.exports = { CURSOR_SVG_RAW, CURSOR_URI, HOTSPOT, SIZE };
