import { useEffect, useMemo, useState } from "react";
import CopyButton from "../../components/CopyButton";
import { fmtDuration, fmtTime } from "../../lib/format";

const SUBTABS = [
  { id: "jwt", name: "JWT 解析" },
  { id: "cron", name: "Cron 表达式" },
] as const;

type SubTab = (typeof SUBTABS)[number]["id"];

export default function ExprTool() {
  const [tab, setTab] = useState<SubTab>("jwt");
  return (
    <div>
      <div className="seg seg-sm" role="tablist">
        {SUBTABS.map((t) => (
          <button
            key={t.id}
            className={`seg-btn${tab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.name}
          </button>
        ))}
      </div>
      {tab === "jwt" ? <JwtView /> : <CronView />}
    </div>
  );
}

/* ---------- JWT ---------- */

function decodeB64Url(s: string): string | null {
  try {
    let b = s.replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    const bin = atob(b);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

type JwtResult =
  | { err: string }
  | { header: unknown; payload: unknown; signature: string };

function JwtView() {
  const [token, setToken] = useState("");

  const info = useMemo<JwtResult | null>(() => {
    const t = token.trim().replace(/^Bearer\s+/i, "");
    if (!t) return null;
    const parts = t.split(".");
    if (parts.length !== 3) return { err: "不是有效的 JWT：应为三段 base64url，以点分隔" };
    const h = decodeB64Url(parts[0]);
    const p = decodeB64Url(parts[1]);
    if (h === null || p === null) return { err: "base64url 解码失败，请检查内容" };
    try {
      return { header: JSON.parse(h), payload: JSON.parse(p), signature: parts[2] };
    } catch {
      return { err: "header 或 payload 不是合法 JSON" };
    }
  }, [token]);

  const header = info && !("err" in info) ? (info.header as Record<string, unknown>) : null;
  const payload = info && !("err" in info) ? (info.payload as Record<string, unknown>) : null;
  const nowSec = Date.now() / 1000;
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  const iat = payload ? num(payload.iat) : undefined;
  const nbf = payload ? num(payload.nbf) : undefined;
  const exp = payload ? num(payload.exp) : undefined;
  const expired = exp !== undefined && exp < nowSec;
  const pending = !expired && nbf !== undefined && nbf > nowSec;
  const pretty = (v: unknown) => JSON.stringify(v, null, 2);

  return (
    <div className="stack">
      <div className="field">
        <span className="field-label">JWT 令牌（支持 Bearer 前缀；仅解码内容，不校验签名）</span>
        <textarea
          className="textarea input-mono"
          style={{ height: 96 }}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="粘贴 eyJ 开头的令牌"
          spellCheck={false}
        />
      </div>

      {info && "err" in info && <span className="hint hint-error">{info.err}</span>}

      {header && payload && info && !("err" in info) && (
        <>
          <div className="tool-actions">
            <span className="jwt-chip pending">算法：{String(header.alg ?? "未知")}</span>
            {exp !== undefined &&
              (expired ? (
                <span className="jwt-chip expired">已过期 {fmtDuration((nowSec - exp) * 1000)}</span>
              ) : (
                <span className="jwt-chip valid">
                  有效 · 剩余 {fmtDuration((exp - nowSec) * 1000)}
                </span>
              ))}
            {pending && <span className="jwt-chip pending">尚未生效</span>}
          </div>

          <div className="field">
            <span className="field-label">
              Header
              <CopyButton text={pretty(header)} />
            </span>
            <textarea className="textarea" style={{ height: 96 }} value={pretty(header)} readOnly spellCheck={false} />
          </div>
          <div className="field">
            <span className="field-label">
              Payload
              <CopyButton text={pretty(payload)} />
            </span>
            <textarea className="textarea" style={{ height: 150 }} value={pretty(payload)} readOnly spellCheck={false} />
          </div>

          {(iat !== undefined || nbf !== undefined || exp !== undefined) && (
            <div className="kv-list">
              {iat !== undefined && (
                <div className="kv-row">
                  <span className="kv-k">签发时间</span>
                  <span className="kv-v">{fmtTime(iat)}</span>
                </div>
              )}
              {nbf !== undefined && (
                <div className="kv-row">
                  <span className="kv-k">生效时间</span>
                  <span className="kv-v">{fmtTime(nbf)}</span>
                </div>
              )}
              {exp !== undefined && (
                <div className="kv-row">
                  <span className="kv-k">过期时间</span>
                  <span className="kv-v">{fmtTime(exp)}</span>
                </div>
              )}
            </div>
          )}

          <div className="field">
            <span className="field-label">签名（base64url，保留原样）</span>
            <input className="input input-mono" value={info.signature || "（空，未签名）"} readOnly spellCheck={false} />
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- Cron ---------- */

const WD = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const WK = ["日", "一", "二", "三", "四", "五", "六"];

interface CronParsed {
  raw: string[];
  sets: Set<number>[];
  domStar: boolean;
  dowStar: boolean;
}

function parseField(f: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of f.split(",")) {
    if (!part) return null;
    const [range, step] = part.split("/");
    let stepN = 1;
    if (step !== undefined) {
      stepN = Number(step);
      if (!Number.isInteger(stepN) || stepN < 1) return null;
    }
    let lo: number;
    let hi: number;
    if (range === "*") {
      lo = min;
      hi = max;
    } else if (range.includes("-")) {
      const i = range.indexOf("-");
      lo = Number(range.slice(0, i));
      hi = Number(range.slice(i + 1));
    } else {
      lo = Number(range);
      hi = step !== undefined ? max : lo;
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
      return null;
    }
    for (let v = lo; v <= hi; v += stepN) out.add(v);
  }
  return out.size ? out : null;
}

function parseCron(expr: string): CronParsed | string {
  const fs = expr.trim().split(/\s+/);
  if (fs.length !== 5 || fs.some((f) => !f)) return "需要 5 个字段：分 时 日 月 周";
  const sets = [
    parseField(fs[0], 0, 59),
    parseField(fs[1], 0, 23),
    parseField(fs[2], 1, 31),
    parseField(fs[3], 1, 12),
    parseField(fs[4], 0, 7),
  ];
  const bad = sets.findIndex((s) => s === null);
  if (bad >= 0) return `第 ${bad + 1} 个字段「${fs[bad]}」格式有误，支持 * 、数字、a-b、a-b/n、a,b,c`;
  const dowRaw = sets[4]!;
  const dow = new Set([...dowRaw].map((v) => (v === 7 ? 0 : v)));
  return {
    raw: fs,
    sets: [sets[0]!, sets[1]!, sets[2]!, sets[3]!, dow],
    domStar: fs[2] === "*",
    dowStar: fs[4] === "*",
  };
}

function nextRuns(p: CronParsed, count = 5): Date[] {
  const [min, hour, dom, mon, dow] = p.sets;
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const out: Date[] = [];
  // 最多向后逐分钟扫一年
  for (let i = 0; i < 527040 && out.length < count; i++) {
    if (mon.has(d.getMonth() + 1)) {
      const dayOK = p.domStar
        ? dow.has(d.getDay())
        : p.dowStar
          ? dom.has(d.getDate())
          : dom.has(d.getDate()) || dow.has(d.getDay());
      if (dayOK && hour.has(d.getHours()) && min.has(d.getMinutes())) out.push(new Date(d));
    }
    d.setMinutes(d.getMinutes() + 1);
  }
  return out;
}

function listVals(vals: number[], fmt: (v: number) => string, cap = 6): string {
  const s = vals.map(fmt);
  return s.length <= cap ? s.join("、") : `${s.slice(0, cap).join("、")} 等 ${s.length} 个`;
}

function stepText(sorted: number[], min: number, unit: string): string | null {
  if (sorted.length < 2 || sorted[0] !== min) return null;
  const gap = sorted[1] - sorted[0];
  if (gap < 2) return null;
  for (let i = 2; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] !== gap) return null;
  }
  return `每 ${gap} ${unit}`;
}

function fmtDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} 周${WK[d.getDay()]}`;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function CronView() {
  const [cronTab, setCronTab] = useState<"parse" | "gen">("parse");
  const [expr, setExpr] = useState("0 9 * * 1-5");
  const parsed = useMemo(() => parseCron(expr), [expr]);
  const runs = useMemo(() => (typeof parsed === "string" ? [] : nextRuns(parsed)), [parsed]);

  // 生成器
  const [mode, setMode] = useState<"minute" | "hourly" | "daily" | "weekly" | "monthly">("daily");
  const [bN, setBN] = useState(5);
  const [bMin, setBMin] = useState(0);
  const [bHour, setBHour] = useState(9);
  const [bDom, setBDom] = useState(1);
  const [bWd, setBWd] = useState<Set<number>>(new Set([1, 2, 3, 4, 5]));

  useEffect(() => {
    const wd = [...bWd].sort((a, b) => a - b).join(",") || "*";
    const map: Record<typeof mode, string> = {
      minute: `*/${clamp(bN, 1, 59)} * * * *`,
      hourly: `${clamp(bMin, 0, 59)} * * * *`,
      daily: `${clamp(bMin, 0, 59)} ${clamp(bHour, 0, 23)} * * *`,
      weekly: `${clamp(bMin, 0, 59)} ${clamp(bHour, 0, 23)} * * ${wd}`,
      monthly: `${clamp(bMin, 0, 59)} ${clamp(bHour, 0, 23)} ${clamp(bDom, 1, 28)} * *`,
    };
    setExpr(map[mode]);
  }, [mode, bN, bMin, bHour, bDom, bWd]);

  const PRESETS: { k: typeof mode; label: string }[] = [
    { k: "minute", label: "每 N 分钟" },
    { k: "hourly", label: "每小时" },
    { k: "daily", label: "每天" },
    { k: "weekly", label: "每周" },
    { k: "monthly", label: "每月" },
  ];

  function toggleWd(v: number) {
    setBWd((s) => {
      const n = new Set(s);
      if (n.has(v)) n.delete(v);
      else n.add(v);
      return n;
    });
  }

  // 字段含义描述
  let descs: string[] = [];
  if (typeof parsed !== "string") {
    const sorted = parsed.sets.map((s) => [...s].sort((a, b) => a - b));
    const m = sorted[0];
    const h = sorted[1];
    const dom = sorted[2];
    const mon = sorted[3];
    const dow = sorted[4];
    descs = [
      m.length === 60 ? "每分钟" : (stepText(m, 0, "分钟") ?? `第 ${listVals(m, String)} 分钟`),
      h.length === 24 ? "每小时" : (stepText(h, 0, "小时") ?? listVals(h, (v) => `${v} 点`)),
      dom.length === 31 ? "每天" : `每月第 ${listVals(dom, String)} 天`,
      mon.length === 12 ? "每月" : `第 ${listVals(mon, String)} 月`,
      dow.length === 7 ? "不限星期" : `每${listVals(dow, (v) => WD[v])}`,
    ];
  }

  return (
    <div className="stack">
      <div className="seg seg-sm" role="tablist">
        <button
          className={`seg-btn${cronTab === "parse" ? " active" : ""}`}
          onClick={() => setCronTab("parse")}
        >
          解析
        </button>
        <button
          className={`seg-btn${cronTab === "gen" ? " active" : ""}`}
          onClick={() => setCronTab("gen")}
        >
          生成
        </button>
      </div>

      {cronTab === "parse" && (
        <>
          <div className="field">
            <span className="field-label">表达式（分 时 日 月 周，标准 crontab 格式）</span>
            <input
              className={`input input-mono${typeof parsed === "string" ? " input-error" : ""}`}
              value={expr}
              onChange={(e) => setExpr(e.target.value)}
              placeholder="如 */5 * * * *"
              spellCheck={false}
            />
            {typeof parsed === "string" && <span className="hint hint-error">{parsed}</span>}
          </div>

          {typeof parsed !== "string" && (
            <>
              <div className="field">
                <span className="field-label">字段含义</span>
                <div className="cron-table">
                  <div className="cron-h">字段</div>
                  <div className="cron-h">取值</div>
                  <div className="cron-h">含义</div>
                  {["分钟", "小时", "日", "月", "星期"].map((name, i) => (
                    <FragmentLine key={name} name={name} raw={parsed.raw[i]} desc={descs[i]} />
                  ))}
                </div>
              </div>
              <RunList runs={runs} />
            </>
          )}
        </>
      )}

      {cronTab === "gen" && (
        <>
          <div className="field">
            <span className="field-label">选择模式</span>
            <div className="diff-opts">
              {PRESETS.map((p) => (
                <button
                  key={p.k}
                  className={`opt-chip${mode === p.k ? " on" : ""}`}
                  onClick={() => setMode(p.k)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="tool-actions">
              {mode === "minute" && (
                <label className="kv-k">
                  间隔分钟
                  <input
                    className="input input-sm"
                    style={{ width: 70 }}
                    type="number"
                    min={1}
                    max={59}
                    value={bN}
                    onChange={(e) => setBN(Number(e.target.value))}
                  />
                </label>
              )}
              {mode !== "minute" && (
                <label className="kv-k">
                  时
                  <input
                    className="input input-sm"
                    style={{ width: 70 }}
                    type="number"
                    min={0}
                    max={23}
                    value={bHour}
                    onChange={(e) => setBHour(Number(e.target.value))}
                  />
                </label>
              )}
              {mode !== "minute" && (
                <label className="kv-k">
                  分
                  <input
                    className="input input-sm"
                    style={{ width: 70 }}
                    type="number"
                    min={0}
                    max={59}
                    value={bMin}
                    onChange={(e) => setBMin(Number(e.target.value))}
                  />
                </label>
              )}
              {mode === "monthly" && (
                <label className="kv-k">
                  日
                  <input
                    className="input input-sm"
                    style={{ width: 70 }}
                    type="number"
                    min={1}
                    max={28}
                    value={bDom}
                    onChange={(e) => setBDom(Number(e.target.value))}
                  />
                </label>
              )}
              {mode === "weekly" && (
                <div className="diff-opts">
                  {[1, 2, 3, 4, 5, 6, 0].map((v) => (
                    <button
                      key={v}
                      className={`opt-chip${bWd.has(v) ? " on" : ""}`}
                      onClick={() => toggleWd(v)}
                    >
                      {WD[v]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="field">
            <span className="field-label">
              生成的表达式
              <CopyButton text={expr} />
            </span>
            <input className="input input-mono" value={expr} readOnly spellCheck={false} />
          </div>
          <RunList runs={runs} />
        </>
      )}
    </div>
  );
}

function RunList({ runs }: { runs: Date[] }) {
  return (
    <div className="field">
      <span className="field-label">
        未来 {runs.length} 次执行
        {runs.length > 0 && <CopyButton text={runs.map(fmtDate).join("\n")} label="复制全部" />}
      </span>
      <div className="kv-list">
        {runs.map((d, i) => (
          <div className="kv-row" key={i}>
            <span className="kv-k">第 {i + 1} 次</span>
            <span className="kv-v">{fmtDate(d)}</span>
          </div>
        ))}
        {runs.length === 0 && (
          <div className="kv-row">
            <span className="hint">一年内没有匹配的时间，请检查表达式</span>
          </div>
        )}
      </div>
    </div>
  );
}

function FragmentLine({ name, raw, desc }: { name: string; raw: string; desc: string }) {
  return (
    <>
      <div className="cron-f">{name}</div>
      <div className="cron-v">{raw}</div>
      <div className="cron-d">{desc}</div>
    </>
  );
}
