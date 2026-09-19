/* 数据工具箱扩展子页:URL 解析 / 文本批处理 / 进制换算 / 文件转 Base64 */
import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { showToast } from "../../components/Toast";
import CopyButton from "../../components/CopyButton";
import { fmtBytes, baseName } from "../../lib/format";
import { dump as yamlDump, load as yamlLoad } from "js-yaml";

/* ---------- URL 解析 ---------- */
export function UrlTool() {
  const [input, setInput] = useState("");
  const parsed = useMemo(() => {
    const t = input.trim();
    if (!t) return null;
    try {
      return { url: new URL(t), err: "" };
    } catch {
      return { url: null, err: "不是合法的 URL，请检查格式" };
    }
  }, [input]);
  const u = parsed?.url ?? null;
  const rows: [string, string][] = u
    ? [
        ["协议", u.protocol.replace(":", "")],
        ["主机", u.hostname],
        ["端口", u.port || "（默认）"],
        ["路径", u.pathname],
        ["查询", u.search ? u.search.slice(1) : "（无）"],
        ["锚点", u.hash ? u.hash.slice(1) : "（无）"],
      ]
    : [];
  const params = u ? Array.from(u.searchParams.entries()) : [];

  return (
    <div className="stack">
      <div className="field">
        <span className="field-label">URL</span>
        <span className="hint">把一条链接拆成协议、主机、端口、路径、查询参数等部分，参数值自动解码</span>
        <input
          className={`input input-mono${parsed?.err ? " input-error" : ""}`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="如 https://example.com:8443/api/user?id=1&tab=info#top"
          spellCheck={false}
        />
        {parsed?.err && <span className="hint hint-error">{parsed.err}</span>}
      </div>
      {u && (
        <>
          <div className="field">
            <span className="field-label">组成部分</span>
            <div className="kv-list">
              {rows.map(([k, v]) => (
                <div className="kv-row" key={k}>
                  <span className="kv-k" style={{ minWidth: 48 }}>
                    {k}
                  </span>
                  <span className="kv-v kv-mono">{v}</span>
                  <CopyButton text={v} />
                </div>
              ))}
            </div>
          </div>
          {params.length > 0 && (
            <div className="field">
              <span className="field-label">查询参数（{params.length} 个，已自动解码）</span>
              <div className="kv-list">
                {params.map(([k, v]) => (
                  <div className="kv-row" key={k}>
                    <span className="kv-k kv-mono" style={{ minWidth: 120 }}>
                      {k}
                    </span>
                    <span className="kv-v kv-mono">{v}</span>
                    <CopyButton text={v} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- 文本批处理 ---------- */
function fullToHalf(str: string): string {
  let out = "";
  for (const ch of str) {
    const code = ch.codePointAt(0)!;
    if (code === 0x3000) out += " ";
    else if (code >= 0xff01 && code <= 0xff5e) out += String.fromCharCode(code - 0xfee0);
    else out += ch;
  }
  return out;
}

const BATCH_OPS: { k: string; label: string }[] = [
  { k: "dedup", label: "去重" },
  { k: "sort", label: "排序" },
  { k: "reverse", label: "反转顺序" },
  { k: "noblank", label: "去空行" },
  { k: "trim", label: "去首尾空白" },
  { k: "upper", label: "转大写" },
  { k: "lower", label: "转小写" },
  { k: "halfwidth", label: "全角转半角" },
];

export function TextBatchTool() {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);

  function apply(kind: string) {
    setHistory((h) => [...h.slice(-19), input]);
    const ls = input.split("\n");
    if (ls.length && ls[ls.length - 1] === "") ls.pop();
    let out = ls;
    switch (kind) {
      case "dedup": {
        const seen = new Set<string>();
        out = ls.filter((l) => !seen.has(l) && seen.add(l));
        break;
      }
      case "sort":
        out = [...ls].sort((a, b) => a.localeCompare(b, "zh-CN"));
        break;
      case "reverse":
        out = [...ls].reverse();
        break;
      case "noblank":
        out = ls.filter((l) => l.trim() !== "");
        break;
      case "trim":
        out = ls.map((l) => l.trim());
        break;
      case "upper":
        out = ls.map((l) => l.toUpperCase());
        break;
      case "lower":
        out = ls.map((l) => l.toLowerCase());
        break;
      case "halfwidth":
        out = ls.map((l) => fullToHalf(l));
        break;
    }
    setInput(out.join("\n"));
  }

  function undo() {
    setHistory((h) => {
      if (!h.length) return h;
      setInput(h[h.length - 1]);
      return h.slice(0, -1);
    });
  }

  const lineCount = input ? input.split("\n").length : 0;

  return (
    <div className="stack">
      <div className="field">
        <span className="field-label">文本（每行一条，点操作按钮立即生效，可撤销）</span>
        <span className="hint">按行批量整理文本，适合清洗名单、日志、导入数据前的准备</span>
        <textarea
          className="textarea input-mono"
          style={{ height: 260 }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="粘贴文本后点上方操作按钮"
          spellCheck={false}
        />
      </div>
      <div className="tool-actions">
        <div className="diff-opts">
          {BATCH_OPS.map((o) => (
            <button key={o.k} className="opt-chip" onClick={() => apply(o.k)} disabled={!input}>
              {o.label}
            </button>
          ))}
        </div>
        <button className="btn" onClick={undo} disabled={!history.length}>
          撤销
        </button>
        <button
          className="btn"
          onClick={() => {
            setInput("");
            setHistory([]);
          }}
        >
          清空
        </button>
        {lineCount > 0 && <span className="hint">{lineCount} 行</span>}
      </div>
    </div>
  );
}

/* ---------- 进制换算 ---------- */
const RADIX_RE: Record<number, RegExp> = {
  2: /^[01]+$/,
  8: /^[0-7]+$/,
  10: /^\d+$/,
  16: /^[0-9a-fA-F]+$/,
};

export function RadixTool() {
  const [base, setBase] = useState<2 | 8 | 10 | 16>(10);
  const [input, setInput] = useState("");
  const t = input.trim();
  const valid = t.length > 0 && t.length <= 64 && RADIX_RE[base].test(t);
  let n: bigint | null = null;
  if (valid) {
    try {
      n = BigInt(base === 10 ? t : `${{ 2: "0b", 8: "0o", 16: "0x" }[base]}${t}`);
    } catch {
      n = null;
    }
  }
  const rows: [string, string][] =
    n !== null
      ? [
          ["二进制", n.toString(2)],
          ["八进制", n.toString(8)],
          ["十进制", n.toString(10)],
          ["十六进制", n.toString(16).toUpperCase()],
        ]
      : [];

  return (
    <div className="stack">
      <div className="field">
        <span className="field-label">输入（非负整数，选当前进制）</span>
        <span className="hint">二、八、十、十六进制之间互转，输入后自动出结果</span>
        <input
          className={`input input-mono${t && !valid ? " input-error" : ""}`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="如 255 或 FF"
          spellCheck={false}
        />
        <div className="diff-opts">
          {([2, 8, 10, 16] as const).map((b) => (
            <button
              key={b}
              className={`opt-chip${base === b ? " on" : ""}`}
              onClick={() => setBase(b)}
            >
              {b === 2 ? "二进制" : b === 8 ? "八进制" : b === 10 ? "十进制" : "十六进制"}
            </button>
          ))}
        </div>
        {t && !valid && <span className="hint hint-error">当前进制下有不合法的字符，或超过 64 位长度</span>}
      </div>
      {n !== null && (
        <div className="field">
          <span className="field-label">换算结果</span>
          <div className="kv-list">
            {rows.map(([k, v]) => (
              <div className="kv-row" key={k}>
                <span className="kv-k" style={{ minWidth: 64 }}>
                  {k}
                </span>
                <span className="kv-v kv-mono">{v}</span>
                <CopyButton text={v} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- 文件转 Base64 ---------- */
const MIME_MAP: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  pdf: "application/pdf",
  txt: "text/plain",
  json: "application/json",
  csv: "text/csv",
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  woff: "font/woff",
  woff2: "font/woff2",
};

export function FileB64Tool() {
  const [path, setPath] = useState("");
  const [res, setRes] = useState<{ base64: string; size: number } | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick() {
    const sel = await open({ multiple: false });
    if (typeof sel !== "string") return;
    setBusy(true);
    setRes(null);
    setPath(sel);
    try {
      setRes(await invoke<{ base64: string; size: number }>("read_file_base64", { path: sel }));
    } catch (e) {
      showToast(String(e), "error", 5000);
    } finally {
      setBusy(false);
    }
  }

  const ext = path.includes(".") ? path.split(".").pop()!.toLowerCase() : "";
  const mime = MIME_MAP[ext] ?? "application/octet-stream";
  const dataUri = res ? `data:${mime};base64,${res.base64}` : "";

  return (
    <div className="stack">
      <div className="tool-actions">
        <input
          className="input input-mono http-hv"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="选择要转换的文件（上限 16MB）"
          spellCheck={false}
        />
        <button className="btn" onClick={pick}>
          浏览
        </button>
      </div>
      {busy && <div className="hint">转换中…</div>}
        <span className="hint">把文件编码成 Base64 文本或 data URI，可直接内嵌到网页或接口参数里</span>
      {res && (
        <>
          <div className="tool-actions">
            <span className="hint">
              原始大小 {fmtBytes(res.size)} · Base64 约 {Math.round((res.size * 4) / 3)} 字符
            </span>
          </div>
          <div className="field">
            <span className="field-label">
              data URI（{mime}）
              <CopyButton text={dataUri} label="复制" />
            </span>
            <textarea
              className="textarea input-mono"
              style={{ height: 96 }}
              value={dataUri}
              readOnly
              spellCheck={false}
            />
          </div>
          <div className="field">
            <span className="field-label">
              纯 Base64
              <CopyButton text={res.base64} label="复制" />
            </span>
            <textarea
              className="textarea input-mono"
              style={{ height: 150 }}
              value={res.base64}
              readOnly
              spellCheck={false}
            />
          </div>
        </>
      )}
      <div className="hint">常见文本与图片类型会识别 MIME；嵌入式资源、接口调试传参时直接复制 data URI</div>
    </div>
  );
}

/* ---------- 配置转换:YAML / JSON / properties ---------- */
function parseProps(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (let raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    let idx = -1;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === "\\") { i++; continue; }
      if (c === "=" || c === ":") { idx = i; break; }
    }
    if (idx < 0) { out[line] = ""; continue; }
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

function unflatten(map: Record<string, string>): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(map)) {
    const parts = k.split(".");
    let cur = root as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (typeof cur[key] !== "object" || cur[key] === null) cur[key] = {};
      cur = cur[key] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]] = v;
  }
  return root;
}

function flatten(obj: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
      else out[key] = Array.isArray(v) ? JSON.stringify(v) : String(v ?? "");
    }
  }
  return out;
}

const CONF_MODES = [
  { k: "y2j", label: "YAML 转 JSON" },
  { k: "j2y", label: "JSON 转 YAML" },
  { k: "p2y", label: "properties 转 YAML" },
  { k: "y2p", label: "YAML 转 properties" },
] as const;
type ConfMode = (typeof CONF_MODES)[number]["k"];

export function ConfTool() {
  const [mode, setMode] = useState<ConfMode>("y2j");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [err, setErr] = useState("");

  function run() {
    setErr("");
    setOutput("");
    try {
      switch (mode) {
        case "y2j": {
          const obj = yamlLoad(input);
          setOutput(JSON.stringify(obj, null, 2));
          break;
        }
        case "j2y": {
          setOutput(yamlDump(JSON.parse(input), { lineWidth: -1, noRefs: true }));
          break;
        }
        case "p2y": {
          setOutput(yamlDump(unflatten(parseProps(input)), { lineWidth: -1, noRefs: true }));
          break;
        }
        case "y2p": {
          const obj = yamlLoad(input);
          if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
            throw new Error("顶层必须是键值对象");
          }
          const flat = flatten(obj);
          setOutput(Object.entries(flat).map(([k, v]) => `${k} = ${v}`).join("\n"));
          break;
        }
      }
    } catch (e) {
      setErr(String(e).replace(/^YAMLError:\s*/, ""));
    }
  }

  return (
    <div className="stack">
      <div className="field">
        <span className="field-label">配置转换</span>
        <span className="hint">YAML、JSON 与 Java properties 三种格式互转；properties 的点号键（如 a.b.c）会按层级拆解或合并</span>
        <div className="diff-opts">
          {CONF_MODES.map((m) => (
            <button key={m.k} className={`opt-chip${mode === m.k ? " on" : ""}`} onClick={() => setMode(m.k)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field-label">输入</span>
        <textarea className="textarea input-mono" style={{ height: 170 }} value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} />
      </div>
      <div className="tool-actions">
        <button className="btn btn-primary" onClick={run} disabled={!input.trim()}>转换</button>
        <button className="btn" onClick={() => { setInput(""); setOutput(""); setErr(""); }}>清空</button>
        {err && <span className="hint hint-error">{err}</span>}
      </div>
      {output && (
        <div className="field">
          <span className="field-label">
            输出
            <CopyButton text={output} />
          </span>
          <textarea className="textarea input-mono" style={{ height: 220 }} value={output} readOnly spellCheck={false} />
        </div>
      )}
    </div>
  );
}