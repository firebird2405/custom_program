'use strict';
/**
 * 순수 Node GIF89a 인코더 (외부 의존성 0 — 설치·다운로드 없음)
 *
 * 왜 직접 만드나: 이 환경에 ffmpeg 도, gif 라이브러리도 없고 설치가 금지되어 있다.
 * GIF89a 는 명세가 짧아 (전역 팔레트 + LZW + 프레임 확장) 직접 쓰는 편이 확실하다.
 *
 * 구성
 *  1) 전역 팔레트: median-cut 255색 (index 255 = 투명 예약)
 *  2) 프레임 차분: 이전 프레임과 같은 픽셀은 투명 인덱스로 두고 disposal=1(그대로 두기)로
 *     겹쳐 그린다. 배경이 정지된 화면에서는 용량이 한 자릿수 퍼센트로 줄어든다.
 *  3) LZW: GIF 표준(Kevin Weiner 계열 lock-step) — 코드 크기 증가 시점을 디코더와 맞춘다.
 */

/* ────────────────────────── 1. median-cut 팔레트 ────────────────────────── */

function buildHistogram(frames, step) {
  const hist = new Map();
  for (const f of frames) {
    const d = f.data;
    for (let i = 0; i < d.length; i += 4 * step) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      let e = hist.get(key);
      if (e) { e.n++; e.r += r; e.g += g; e.b += b; }
      else hist.set(key, { n: 1, r: r, g: g, b: b });
    }
  }
  const out = [];
  for (const e of hist.values()) out.push({ n: e.n, r: e.r / e.n, g: e.g / e.n, b: e.b / e.n });
  return out;
}

function boxStats(entries) {
  let rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0, n = 0;
  for (const e of entries) {
    if (e.r < rmin) rmin = e.r; if (e.r > rmax) rmax = e.r;
    if (e.g < gmin) gmin = e.g; if (e.g > gmax) gmax = e.g;
    if (e.b < bmin) bmin = e.b; if (e.b > bmax) bmax = e.b;
    n += e.n;
  }
  /* 사람 눈 가중치 — 초록 범위를 더 중요하게 본다 */
  const dr = (rmax - rmin) * 0.30, dg = (gmax - gmin) * 0.59, db = (bmax - bmin) * 0.11;
  const span = Math.max(dr, dg, db);
  return { n, span, axis: span === dr ? 'r' : (span === dg ? 'g' : 'b') };
}

function medianCut(entries, want) {
  let boxes = [{ entries, stat: boxStats(entries) }];
  while (boxes.length < want) {
    /* 색 분포가 가장 넓고 픽셀이 많은 상자를 쪼갠다 */
    let bi = -1, best = -1;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.entries.length < 2) continue;
      const score = b.stat.span * Math.cbrt(b.stat.n);
      if (score > best) { best = score; bi = i; }
    }
    if (bi < 0) break;
    const box = boxes[bi];
    const axis = box.stat.axis;
    const sorted = box.entries.slice().sort((a, b) => a[axis] - b[axis]);
    const half = box.stat.n / 2;
    let acc = 0, cut = 1;
    for (let i = 0; i < sorted.length - 1; i++) {
      acc += sorted[i].n;
      if (acc >= half) { cut = i + 1; break; }
      cut = i + 2;
    }
    if (cut < 1) cut = 1;
    if (cut > sorted.length - 1) cut = sorted.length - 1;
    const a = sorted.slice(0, cut), b = sorted.slice(cut);
    boxes.splice(bi, 1, { entries: a, stat: boxStats(a) }, { entries: b, stat: boxStats(b) });
  }
  return boxes.map((box) => {
    let n = 0, r = 0, g = 0, b = 0;
    for (const e of box.entries) { n += e.n; r += e.r * e.n; g += e.g * e.n; b += e.b * e.n; }
    if (!n) return [0, 0, 0];
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  });
}

/* ─────────────────────────── 2. 색 → 인덱스 매핑 ─────────────────────────── */

function makeMapper(palette) {
  const cache = new Int16Array(1 << 18).fill(-1);   /* 6bit×3 */
  const P = palette;
  return function nearest(r, g, b) {
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    const hit = cache[key];
    if (hit >= 0) return hit;
    let bestI = 0, bestD = Infinity;
    for (let i = 0; i < P.length; i++) {
      const dr = r - P[i][0], dg = g - P[i][1], db = b - P[i][2];
      const d = dr * dr * 0.30 + dg * dg * 0.59 + db * db * 0.11;
      if (d < bestD) { bestD = d; bestI = i; }
    }
    cache[key] = bestI;
    return bestI;
  };
}

/* ─────────────────────────────── 3. LZW ─────────────────────────────── */

function lzwEncode(minCodeSize, indices) {
  const bytes = [];
  let cur = 0, curBits = 0;
  const clearCode = 1 << minCodeSize;
  const eoi = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let maxcode = (1 << codeSize) - 1;
  let next = clearCode + 2;
  let clearFlag = false;
  const dict = new Map();

  function emitBits(code) {
    cur |= code << curBits;
    curBits += codeSize;
    while (curBits >= 8) {
      bytes.push(cur & 0xff);
      cur >>>= 8;
      curBits -= 8;
    }
    /* 디코더와 lock-step 으로 코드 폭을 늘린다 */
    if (next > maxcode || clearFlag) {
      if (clearFlag) {
        codeSize = minCodeSize + 1;
        maxcode = (1 << codeSize) - 1;
        clearFlag = false;
      } else {
        codeSize++;
        maxcode = codeSize === 12 ? 4096 : (1 << codeSize) - 1;
      }
    }
  }

  emitBits(clearCode);
  let ent = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const c = indices[i];
    const key = (ent << 8) | c;
    const found = dict.get(key);
    if (found !== undefined) { ent = found; continue; }
    emitBits(ent);
    ent = c;
    if (next < 4096) {
      dict.set(key, next++);
    } else {
      dict.clear();
      next = clearCode + 2;
      clearFlag = true;
      emitBits(clearCode);
    }
  }
  emitBits(ent);
  emitBits(eoi);
  if (curBits > 0) bytes.push(cur & 0xff);

  /* 255바이트 서브블록으로 쪼갠다 */
  const out = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0);
  return Buffer.from(out);
}

/* ───────────────────────────── 4. GIF 조립 ───────────────────────────── */

/**
 * @param {{width:number,height:number,data:Uint8Array}[]} frames  RGBA 프레임 (모두 같은 크기)
 * @param {{delayMs?:number, loop?:number, colors?:number, sample?:number}} opts
 * @returns {{buffer:Buffer, palette:number[][], stats:object}}
 */
function encodeGIF(frames, opts) {
  const o = Object.assign({ delayMs: 100, loop: 0, colors: 255, sample: 3 }, opts || {});
  const W = frames[0].width, H = frames[0].height;
  const TRANSP = 255;

  const hist = buildHistogram(frames, o.sample);
  let palette = medianCut(hist, Math.min(o.colors, 255));
  while (palette.length < 255) palette.push([0, 0, 0]);
  const mapper = makeMapper(palette);

  /* 프레임별 인덱스 맵 */
  const idxFrames = frames.map((f) => {
    const idx = new Uint8Array(W * H);
    const d = f.data;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) idx[p] = mapper(d[i], d[i + 1], d[i + 2]);
    return idx;
  });

  const parts = [];
  const head = Buffer.alloc(13);
  head.write('GIF89a', 0, 'ascii');
  head.writeUInt16LE(W, 6);
  head.writeUInt16LE(H, 8);
  head[10] = 0xf7;   /* GCT 있음 · 색 해상도 8 · 256 엔트리 */
  head[11] = 0;
  head[12] = 0;
  parts.push(head);

  const gct = Buffer.alloc(256 * 3);
  for (let i = 0; i < 255; i++) {
    gct[i * 3] = palette[i][0];
    gct[i * 3 + 1] = palette[i][1];
    gct[i * 3 + 2] = palette[i][2];
  }
  /* index 255 = 투명 예약 (실제 색은 쓰이지 않음) */
  parts.push(gct);

  const nsExt = Buffer.from([
    0x21, 0xff, 0x0b, 0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30,
    0x03, 0x01, o.loop & 0xff, (o.loop >> 8) & 0xff, 0x00
  ]);
  parts.push(nsExt);

  const delayCs = Math.max(2, Math.round(o.delayMs / 10));
  const canvas = new Uint8Array(W * H).fill(0xff);
  let firstFrame = true;
  const stats = { frames: 0, changedPixels: 0, totalPixels: 0 };

  for (const idx of idxFrames) {
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    if (firstFrame) { x0 = 0; y0 = 0; x1 = W - 1; y1 = H - 1; }
    else {
      for (let y = 0; y < H; y++) {
        const row = y * W;
        for (let x = 0; x < W; x++) {
          if (idx[row + x] !== canvas[row + x]) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < 0) { x0 = 0; y0 = 0; x1 = 0; y1 = 0; }   /* 변화 없음 → 1×1 투명 프레임 */
    }
    const fw = x1 - x0 + 1, fh = y1 - y0 + 1;
    const sub = new Uint8Array(fw * fh);
    let changed = 0;
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        const s = (y + y0) * W + (x + x0);
        const v = idx[s];
        if (!firstFrame && v === canvas[s]) sub[y * fw + x] = TRANSP;
        else { sub[y * fw + x] = v; changed++; }
      }
    }
    canvas.set(idx);
    stats.frames++;
    stats.changedPixels += changed;
    stats.totalPixels += W * H;

    const gce = Buffer.from([
      0x21, 0xf9, 0x04,
      firstFrame ? 0x04 : 0x05,          /* disposal=1(그대로 두기) + 투명 플래그 */
      delayCs & 0xff, (delayCs >> 8) & 0xff,
      TRANSP, 0x00
    ]);
    parts.push(gce);

    const desc = Buffer.alloc(10);
    desc[0] = 0x2c;
    desc.writeUInt16LE(x0, 1);
    desc.writeUInt16LE(y0, 3);
    desc.writeUInt16LE(fw, 5);
    desc.writeUInt16LE(fh, 7);
    desc[9] = 0x00;
    parts.push(desc);
    parts.push(Buffer.from([8]));
    parts.push(lzwEncode(8, sub));
    firstFrame = false;
  }

  parts.push(Buffer.from([0x3b]));
  return { buffer: Buffer.concat(parts), palette, stats };
}

module.exports = { encodeGIF };
