'use strict';
/**
 * frames/*.png → demo-drag.gif  (순수 Node, 외부 의존성·설치 0)
 *
 *  PNG 디코드(zlib 내장) → 2배 박스 축소 → median-cut 255색 → 프레임 차분 → LZW → GIF89a.
 *  ffmpeg·gifsicle·gif 라이브러리 없이 GIF 명세를 직접 써서 만든다.
 */
const fs = require('fs');
const path = require('path');
const { decodePNG, downscale } = require('./png');
const { encodeGIF } = require('./gif');

const OUT = path.resolve(__dirname, '..');
const FRAMES = path.join(OUT, 'frames');

function main() {
  const delay = Number(process.argv[2] || 100);
  const files = fs.readdirSync(FRAMES).filter((f) => /\.png$/i.test(f)).sort();
  if (!files.length) throw new Error('frames/ 에 PNG 가 없습니다. 먼저 node tools/capture.js frames 를 실행하세요.');

  const t0 = Date.now();
  const imgs = files.map((f) => downscale(decodePNG(fs.readFileSync(path.join(FRAMES, f))), 2));
  const { buffer, stats } = encodeGIF(imgs, { delayMs: delay, loop: 0, colors: 255, sample: 2 });
  const out = path.join(OUT, 'demo-drag.gif');
  fs.writeFileSync(out, buffer);

  const pct = ((stats.changedPixels / stats.totalPixels) * 100).toFixed(1);
  console.log(
    'demo-drag.gif  ' + imgs[0].width + '×' + imgs[0].height +
    ' · ' + stats.frames + '프레임 · ' + delay + 'ms · ' + (delay * stats.frames / 1000).toFixed(1) + '초 루프'
  );
  console.log('용량 ' + (buffer.length / 1024).toFixed(0) + ' KB · 차분 인코딩 픽셀 비율 ' + pct + '% · ' +
    ((Date.now() - t0) / 1000).toFixed(1) + '초 소요');
}

main();
