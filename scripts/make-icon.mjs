import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/**
 * 아이콘 만들기. 외부 이미지 도구 없이 픽셀을 직접 계산해서 그린다.
 * (예약판을 단순화한 모양: 파란 판 위에 예약 블록 몇 개와 현재시각선)
 *
 *  build/icon.png              256  둥근 사각형   Windows 설치파일·창 아이콘
 *  public/favicon-32.png        32  둥근 사각형   브라우저 탭
 *  public/apple-touch-icon.png 180  꽉 찬 사각형  아이폰·아이패드 홈 화면
 *  public/icon-192.png         192  꽉 찬 사각형  안드로이드 홈 화면
 *  public/icon-512.png         512  꽉 찬 사각형  안드로이드 설치 화면
 *
 * 아이폰과 안드로이드는 아이콘 모서리를 각자 알아서 깎기 때문에,
 * 홈 화면용은 둥글리지 않고 꽉 찬 사각형으로 내보낸다. (모서리가 검게 나오는 것 방지)
 */

const TARGETS = [
  { file: path.join('build', 'icon.png'), size: 256, rounded: true },
  { file: path.join('public', 'favicon-32.png'), size: 32, rounded: true },
  { file: path.join('public', 'apple-touch-icon.png'), size: 180, rounded: false },
  { file: path.join('public', 'icon-192.png'), size: 192, rounded: false },
  { file: path.join('public', 'icon-512.png'), size: 512, rounded: false },
];

const SS = 4; // 4배로 그린 뒤 줄여서 계단 현상을 없앤다

/* ------------------------------- PNG 쓰기 ------------------------------- */

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* -------------------------------- 그리기 -------------------------------- */

const BG = [29, 78, 216];
const CARD = [255, 255, 255];
const BAR = [226, 232, 240];
const EDGE = [71, 105, 175];
const BLOCK = [147, 197, 253];
const BLOCK2 = [110, 231, 183];
const NOW = [225, 29, 72];

function draw(size, rounded) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = 255;
  };
  const rect = (x0, y0, x1, y1, color) => {
    for (let y = Math.round(y0); y < Math.round(y1); y += 1) {
      for (let x = Math.round(x0); x < Math.round(x1); x += 1) set(x, y, color);
    }
  };

  const radius = rounded ? size * 0.18 : 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (radius > 0) {
        const cx = x < radius ? radius : x > size - 1 - radius ? size - 1 - radius : x;
        const cy = y < radius ? radius : y > size - 1 - radius ? size - 1 - radius : y;
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > radius * radius) continue; // 모서리 바깥은 투명
      }
      set(x, y, BG);
    }
  }

  const pad = size * 0.133;
  rect(pad, pad, size - pad, size - pad, CARD); // 흰 판
  rect(pad, pad, size - pad, pad + size * 0.0625, BAR); // 시간축

  const innerLeft = pad + size * 0.023;
  const innerWidth = size - pad * 2 - size * 0.047;
  const rows = [
    { top: 0.101, from: 0.08, to: 0.42, color: BLOCK },
    { top: 0.25, from: 0.3, to: 0.86, color: BLOCK2 },
    { top: 0.398, from: 0.05, to: 0.3, color: BLOCK },
    { top: 0.547, from: 0.52, to: 0.95, color: BLOCK },
  ];
  const rowH = size * 0.101;
  const border = Math.max(1, Math.round(size * 0.008));

  for (const row of rows) {
    const x0 = innerLeft + innerWidth * row.from;
    const x1 = innerLeft + innerWidth * row.to;
    const y0 = pad + size * row.top;
    rect(x0, y0, x1, y0 + rowH, EDGE);
    rect(x0 + border, y0 + border, x1 - border, y0 + rowH - border, row.color);
  }

  const nowX = innerLeft + innerWidth * 0.62;
  const nowW = Math.max(1, Math.round(size * 0.012));
  rect(nowX, pad + size * 0.016, nowX + nowW, size - pad - size * 0.016, NOW);

  return px;
}

/** 4배 크기로 그린 그림을 평균 내서 줄인다 (계단 현상 제거) */
function downsample(big, bigSize, size) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const i = ((y * SS + sy) * bigSize + (x * SS + sx)) * 4;
          const alpha = big[i + 3];
          r += big[i] * alpha;
          g += big[i + 1] * alpha;
          b += big[i + 2] * alpha;
          a += alpha;
        }
      }
      const o = (y * size + x) * 4;
      const n = SS * SS;
      out[o] = a === 0 ? 0 : Math.round(r / a);
      out[o + 1] = a === 0 ? 0 : Math.round(g / a);
      out[o + 2] = a === 0 ? 0 : Math.round(b / a);
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

for (const target of TARGETS) {
  const bigSize = target.size * SS;
  const pixels = downsample(draw(bigSize, target.rounded), bigSize, target.size);
  fs.mkdirSync(path.dirname(target.file), { recursive: true });
  fs.writeFileSync(target.file, encodePng(target.size, target.size, pixels));
  console.log(`[make-icon] ${target.file} (${target.size}x${target.size})`);
}
