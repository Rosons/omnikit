// 纯 Node 手绘 PNG:1024x1024,蓝色渐变圆角底 + 白色大扳手斜放 + 中央圆徽镂空 </>(无第三方依赖)
// 品牌意象:开发者的工具(扳手)+ 代码(</>);锁只属于"文件保险箱"单个工具
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
// 局部旋转:输入相对向量,返回旋转后的相对向量
function rotLocal(vx, vy, ang) {
  const s = Math.sin(ang);
  const c = Math.cos(ang);
  return [vx * c + vy * s, -vx * s + vy * c];
}

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

// ---------- 扳手(局部坐标:头在 -y 方向,柄沿 +y) ----------
// 柄刻意加粗:中段是一条斜向宽带,</> 直接镂空在带子上
const HEAD_CY = -360; // 头圆心
const HEAD_R = 210; // 头半径
const SLOT_W = 150; // 开口槽宽
const SLOT_LEN = 420; // 开口槽长(向 -y 伸出头外)
const SHAFT_CY = 128; // 柄中心
const SHAFT_HW = 212; // 柄半宽(宽带,完整容纳 </> 镂空)
const SHAFT_HL = 480; // 柄半长
const ANG = Math.PI / 4; // 整体旋转:头指向右上

function sdWrench(sx, sy) {
  const [lx, ly] = rotLocal(sx - 512, sy - 512, ANG);
  const head = sdCircle(lx, ly, 0, HEAD_CY, HEAD_R);
  const slot = sdRoundBox(lx, ly, 0, HEAD_CY - 80, SLOT_W / 2, SLOT_LEN / 2, SLOT_W / 2);
  const headC = Math.max(head, -slot);
  const shaft = sdRoundBox(lx, ly, 0, SHAFT_CY, SHAFT_HW, SHAFT_HL, SHAFT_HW);
  return Math.min(headC, shaft);
}

// ---------- 带子上的 </>(镂空;几何已验证全部落在柄带宽度内) ----------
function sdBar(sx, sy, cx, cy, ang, hl, hw) {
  const [rx, ry] = rotLocal(sx - cx, sy - cy, -ang);
  return sdRoundBox(rx, ry, 0, 0, hl, hw, hw);
}
const BRK_HL = 95; // 括号笔画半长
const BRK_HW = 24; // 笔画半宽
const BRK_ANG = (32 * Math.PI) / 180;
const SLASH_ANG = (50 * Math.PI) / 180;
// "<":顶点在左,两笔向右上/右下伸
function sdBracketLeft(sx, sy, vx) {
  const dx = BRK_HL * Math.cos(BRK_ANG);
  const dy = BRK_HL * Math.sin(BRK_ANG);
  return Math.min(
    sdBar(sx, sy, vx + dx, 512 - dy, -BRK_ANG, BRK_HL, BRK_HW),
    sdBar(sx, sy, vx + dx, 512 + dy, BRK_ANG, BRK_HL, BRK_HW),
  );
}
// ">":顶点在右,两笔向左上/左下伸
function sdBracketRight(sx, sy, vx) {
  const dx = BRK_HL * Math.cos(BRK_ANG);
  const dy = BRK_HL * Math.sin(BRK_ANG);
  return Math.min(
    sdBar(sx, sy, vx - dx, 512 - dy, BRK_ANG, BRK_HL, BRK_HW),
    sdBar(sx, sy, vx - dx, 512 + dy, -BRK_ANG, BRK_HL, BRK_HW),
  );
}

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

    // 大扳手斜放(头右上,柄左下)
    const wrenchD = sdWrench(sx, sy);
    col = blend(col, WHITE, cov(wrenchD) * cov(bgD));

    // </> 镂空在圆徽上
    const glyphD = Math.min(
      sdBracketLeft(sx, sy, 320),
      sdBracketRight(sx, sy, 704),
    );
    // 镂空只作用于扳手带子上(背景处本来就是同色)
    col = blend(col, bgAt(sy), cov(glyphD) * cov(wrenchD) * cov(bgD));

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
