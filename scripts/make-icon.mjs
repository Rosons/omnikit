// 纯 Node 手绘 PNG:1024x1024,蓝色渐变圆角底 + 白色工具箱(无第三方依赖)
// 品牌图形是"工具箱"(应用整体形象);锁只属于"文件保险箱"单个工具
// 产物:assets/icon.png,随后用 `npx tauri icon assets/icon.png -o src-tauri/icons` 生成全尺寸
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SIZE = 1024;

// ---------- PNG 编码 ----------
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(rgba, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 4);
    raw[row] = 0; // filter: none
    rgba.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- SDF 绘图 ----------
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
// 有符号距离 → 1px 抗锯齿覆盖度
const cov = (d) => clamp01(0.5 - d);

function sdRoundBox(px, py, cx, cy, bx, by, r) {
  const qx = Math.abs(px - cx) - (bx - r);
  const qy = Math.abs(py - cy) - (by - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}
const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;
const sdRing = (px, py, cx, cy, radius, half) =>
  Math.abs(Math.hypot(px - cx, py - cy) - radius) - half;

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const blend = (dst, src, a) => [
  dst[0] + (src[0] - dst[0]) * a,
  dst[1] + (src[1] - dst[1]) * a,
  dst[2] + (src[2] - dst[2]) * a,
];

// 配色:UI 主色 #06A7FF 的同族渐变
const BG_TOP = [0x3f, 0xbc, 0xff];
const BG_BOT = [0x06, 0x9e, 0xf2];
const WHITE = [0xff, 0xff, 0xff];

// 挖空处用对应高度的背景渐变色,读起来是"镂空"
const bgAt = (sy) => mix(BG_TOP, BG_BOT, sy / SIZE);

const px = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    // 采样点取像素中心
    const sx = x + 0.5;
    const sy = y + 0.5;

    // 背景:圆角矩形 + 垂直渐变 + 左上角一点白,提"清爽"
    const bgD = sdRoundBox(sx, sy, 512, 512, 512, 512, 228);
    let col = bgAt(sy);
    const light = Math.exp(-((sx - 330) ** 2 + (sy - 270) ** 2) / (2 * 430 * 430));
    col = mix(col, WHITE, light * 0.12);

    // 工具箱提手(先画,下半被箱体盖住)
    const handleD = sdRing(sx, sy, 512, 404, 138, 33);
    col = blend(col, WHITE, cov(handleD) * cov(bgD));

    // 箱体
    const bodyD = sdRoundBox(sx, sy, 512, 610, 302, 212, 58);
    col = blend(col, WHITE, cov(bodyD) * cov(bgD));

    // 箱体中缝(镂空横线)
    const seamD = sdRoundBox(sx, sy, 512, 536, 304, 11, 11);
    col = blend(col, bgAt(sy), cov(seamD) * cov(bgD));

    // 中央搭扣
    const claspD = sdRoundBox(sx, sy, 512, 536, 52, 38, 16);
    col = blend(col, WHITE, cov(claspD) * cov(bgD));

    const i = (y * SIZE + x) * 4;
    px[i] = Math.round(clamp01(col[0] / 255) * 255);
    px[i + 1] = Math.round(clamp01(col[1] / 255) * 255);
    px[i + 2] = Math.round(clamp01(col[2] / 255) * 255);
    // 圆角外透明
    px[i + 3] = Math.round(cov(bgD) * 255);
  }
}

mkdirSync(resolve(root, "assets"), { recursive: true });
const out = resolve(root, "assets/icon.png");
writeFileSync(out, encodePNG(px, SIZE, SIZE));
console.log(`已生成 ${out} (${SIZE}x${SIZE})`);
