'use strict';
/**
 * 최소 PNG 디코더 (순수 Node — 외부 의존성 0)
 * Playwright 스크린샷(8비트, 비인터레이스, colorType 0/2/4/6)만 다룬다.
 * zlib 은 Node 내장이므로 설치가 필요 없다.
 */
const zlib = require('zlib');

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** @returns {{width:number,height:number,data:Uint8Array}} data = RGBA 8bit */
function decodePNG(buf) {
  if (!buf.slice(0, 8).equals(SIG)) throw new Error('PNG 서명이 아닙니다.');
  let off = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  let palette = null;
  let trns = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    off += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      trns = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (bitDepth !== 8) throw new Error('지원하지 않는 PNG 비트깊이: ' + bitDepth);
  if (interlace !== 0) throw new Error('인터레이스 PNG 는 지원하지 않습니다.');

  const CH = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!CH) throw new Error('지원하지 않는 PNG colorType: ' + colorType);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * CH;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  let p = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    raw.copy(cur, 0, p, p + stride);
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= CH ? cur[i - CH] : 0;
      const b = prev[i];
      const c = i >= CH ? prev[i - CH] : 0;
      let v = cur[i];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) v = (v + paeth(a, b, c)) & 0xff;
      cur[i] = v;
    }
    const o = y * width * 4;
    for (let x = 0; x < width; x++) {
      const s = x * CH;
      const d = o + x * 4;
      if (colorType === 6) {
        out[d] = cur[s]; out[d + 1] = cur[s + 1]; out[d + 2] = cur[s + 2]; out[d + 3] = cur[s + 3];
      } else if (colorType === 2) {
        out[d] = cur[s]; out[d + 1] = cur[s + 1]; out[d + 2] = cur[s + 2]; out[d + 3] = 255;
      } else if (colorType === 0) {
        out[d] = out[d + 1] = out[d + 2] = cur[s]; out[d + 3] = 255;
      } else if (colorType === 4) {
        out[d] = out[d + 1] = out[d + 2] = cur[s]; out[d + 3] = cur[s + 1];
      } else if (colorType === 3) {
        const idx = cur[s] * 3;
        out[d] = palette[idx]; out[d + 1] = palette[idx + 1]; out[d + 2] = palette[idx + 2];
        out[d + 3] = trns && cur[s] < trns.length ? trns[cur[s]] : 255;
      }
    }
    prev.set(cur);
  }
  return { width, height, data: out };
}

/** 정수배 박스 평균 축소 (2 → 절반). RGBA 유지. */
function downscale(img, factor) {
  const f = Math.max(1, Math.round(factor));
  if (f === 1) return img;
  const w = Math.floor(img.width / f);
  const h = Math.floor(img.height / f);
  const out = new Uint8Array(w * h * 4);
  const n = f * f;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < f; dy++) {
        const row = (y * f + dy) * img.width * 4;
        for (let dx = 0; dx < f; dx++) {
          const s = row + (x * f + dx) * 4;
          r += img.data[s]; g += img.data[s + 1]; b += img.data[s + 2]; a += img.data[s + 3];
        }
      }
      const d = (y * w + x) * 4;
      out[d] = Math.round(r / n);
      out[d + 1] = Math.round(g / n);
      out[d + 2] = Math.round(b / n);
      out[d + 3] = Math.round(a / n);
    }
  }
  return { width: w, height: h, data: out };
}

module.exports = { decodePNG, downscale };
