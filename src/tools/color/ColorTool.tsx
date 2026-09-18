import { useMemo, useState } from "react";
import CopyButton from "../../components/CopyButton";

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))));
  };
  return { r: f(0), g: f(8), b: f(4) };
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

function parseColor(s: string): Rgb | null {
  const t = s.trim().toLowerCase();
  let m = t.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (m) {
    let hex = m[1];
    if (hex.length === 3) hex = [...hex].map((c) => c + c).join("");
    if (hex.length === 8) hex = hex.slice(0, 6);
    const n = parseInt(hex, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  m = t.match(/^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})/);
  if (m) {
    const r = Number(m[1]);
    const g = Number(m[2]);
    const b = Number(m[3]);
    return r <= 255 && g <= 255 && b <= 255 ? { r, g, b } : null;
  }
  m = t.match(/^hsla?\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*\)$/);
  if (m) return hslToRgb(Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100);
  return null;
}

export default function ColorTool() {
  const [input, setInput] = useState("#06A7FF");
  const rgb = useMemo(() => parseColor(input), [input]);
  const [h, s, l] = rgb ? rgbToHsl(rgb.r, rgb.g, rgb.b) : [0, 0, 0];
  const hex = rgb
    ? `#${[rgb.r, rgb.g, rgb.b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`
    : "";

  const rows: [string, string][] = rgb
    ? [
        ["HEX", hex],
        ["RGB", `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`],
        ["HSL", `hsl(${h}, ${s}%, ${l}%)`],
      ]
    : [];

  return (
    <div className="stack">
      <div className="field">
        <span className="field-label">颜色值（支持 HEX、rgb()、hsl()，自动识别）</span>
        <div className="color-row">
          <input
            className={`input input-mono${rgb ? "" : " input-error"}`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="如 #06A7FF 或 rgb(6,167,255)"
            spellCheck={false}
          />
          <input
            type="color"
            className="color-pick"
            value={hex || "#06a7ff"}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            title="打开系统取色器"
          />
        </div>
        {!rgb && input.trim() && (
          <span className="hint hint-error">无法识别的颜色格式，请检查</span>
        )}
      </div>

      {rgb && (
        <>
          <div className="color-swatch" style={{ background: hex }}>
            <span className="color-swatch-text">{hex}</span>
          </div>
          <div className="kv-list">
            {rows.map(([k, v]) => (
              <div className="kv-row" key={k}>
                <span className="kv-k" style={{ width: 44 }}>
                  {k}
                </span>
                <span className="kv-v kv-mono">{v}</span>
                <CopyButton text={v} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
