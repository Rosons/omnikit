import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { format, type SqlLanguage } from "sql-formatter";
import Prism from "prismjs";
import "prismjs/components/prism-sql";
import { md5 } from "./md5";
import { fmtBytes, fmtDuration, fmtTime, baseName } from "../../lib/format";
import { showToast } from "../../components/Toast";
import CopyButton from "../../components/CopyButton";
import { UrlTool, TextBatchTool, RadixTool, FileB64Tool, ConfTool } from "./more";

const TABS = [
  { id: "json", name: "JSON" },
  { id: "time", name: "时间戳" },
  { id: "codec", name: "编解码" },
  { id: "uuid", name: "UUID" },
  { id: "hash", name: "哈希" },
  { id: "jwt", name: "JWT" },
  { id: "sql", name: "SQL" },
  { id: "url", name: "URL" },
  { id: "text", name: "批处理" },
  { id: "radix", name: "进制" },
  { id: "b64", name: "Base64" },
  { id: "conf", name: "配置" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function DevTools() {
  const [tab, setTab] = useState<TabId>("json");
  return (
    <div>
      <div className="seg" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`seg-btn${tab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.name}
          </button>
        ))}
      </div>
      {tab === "json" && <JsonTool />}
      {tab === "time" && <TimeTool />}
      {tab === "codec" && <CodecTool />}
      {tab === "uuid" && <UuidTool />}
      {tab === "hash" && <HashTool />}
      {tab === "jwt" && <JwtTool />}
      {tab === "sql" && <SqlTool />}
      {tab === "url" && <UrlTool />}
      {tab === "text" && <TextBatchTool />}
      {tab === "radix" && <RadixTool />}
      {tab === "b64" && <FileB64Tool />}
      {tab === "conf" && <ConfTool />}
    </div>
  );
}

/* ---------- JSON 格式化 ---------- */
function JsonTool() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");

  // 转义串还原:如 "{\"a\":1}" 解析并格式化为对象
  function strToObj() {
    try {
      const parsed: unknown = JSON.parse(input);
      if (typeof parsed === "string") {
        setOutput(JSON.stringify(JSON.parse(parsed), null, 2));
      } else {
        setOutput(JSON.stringify(parsed, null, 2));
        showToast("输入本身就是 JSON 对象，已按格式化输出", "info", 3000);
      }
    } catch {
      try {
        const unescaped = input.replace(/\\\\/g, "\\").replace(/\\"/g, '"');
        setOutput(JSON.stringify(JSON.parse(unescaped), null, 2));
      } catch {
        setOutput("");
        showToast("无法解析为 JSON 字符串，请检查转义格式", "error", 5000);
      }
    }
  }

  // 对象转转义字符串:输出带引号的 JSON 字符串字面量
  function objToStr() {
    try {
      const parsed = JSON.parse(input);
      setOutput(JSON.stringify(JSON.stringify(parsed)));
    } catch {
      setOutput("");
      showToast("输入不是合法 JSON，无法转为字符串", "error", 5000);
    }
  }

  function run(pretty: boolean) {
    try {
      const parsed = JSON.parse(input);
      setOutput(pretty ? JSON.stringify(parsed, null, 2) : JSON.stringify(parsed));
    } catch (e) {
      setOutput("");
      showToast(String(e), "error", 5000);
    }
  }

  return (
    <div className="stack">
      <div className="field">
        <span className="field-label">输入 JSON</span>
        <textarea
          className="textarea"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='粘贴 JSON，如 {"a":1}'
          spellCheck={false}
        />
      </div>
      <div className="tool-actions">
        <button className="btn" onClick={() => run(true)} disabled={!input.trim()}>
          格式化
        </button>
        <button className="btn" onClick={() => run(false)} disabled={!input.trim()}>
          压缩
        </button>
        <button className="btn" onClick={strToObj} disabled={!input.trim()}>
          字符串转对象
        </button>
        <button className="btn" onClick={objToStr} disabled={!input.trim()}>
          对象转字符串
        </button>
        <button
          className="btn"
          onClick={() => {
            setInput("");
            setOutput("");
          }}
        >
          清空
        </button>
        {output && <span className="hint hint-ok">JSON 合法</span>}
      </div>
      {output && (
        <div className="field">
          <span className="field-label">
            结果
            <CopyButton text={output} />
          </span>
          <textarea className="textarea" value={output} readOnly spellCheck={false} />
        </div>
      )}
    </div>
  );
}

/* ---------- 时间戳 ---------- */
function TimeTool() {
  const [now, setNow] = useState(() => Date.now());
  const [stamp, setStamp] = useState("");
  const [dt, setDt] = useState("");

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const parsed = useMemo(() => {
    const s = stamp.trim();
    if (!/^\d+$/.test(s)) return null;
    const n = Number(s);
    const ms = s.length <= 10 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [stamp]);

  const reversed = dt ? new Date(dt) : null;
  const validReversed = reversed && !Number.isNaN(reversed.getTime()) ? reversed : null;

  const p2 = (x: number) => String(x).padStart(2, "0");
  const fmtLocal = (d: Date) =>
    `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;

  return (
    <div className="stack">
      <div className="kv-row">
        <span>当前时间 / 毫秒时间戳</span>
        <span className="kv-value">
          {fmtLocal(new Date(now))} · {now}
        </span>
      </div>

      <div className="field">
        <span className="field-label">时间戳 → 日期（10 位秒 / 13 位毫秒，自动识别）</span>
        <input
          className="input input-mono"
          value={stamp}
          onChange={(e) => setStamp(e.target.value)}
          placeholder="如 1789065600"
          spellCheck={false}
        />
      </div>
      {stamp &&
        (parsed ? (
          <>
            <div className="kv-row">
              <span>本地时间</span>
              <span className="kv-value">{fmtLocal(parsed)}</span>
            </div>
            <div className="kv-row">
              <span>UTC</span>
              <span className="kv-value">{parsed.toUTCString()}</span>
            </div>
          </>
        ) : (
          <span className="hint hint-error">无法识别的时间戳，请输入纯数字</span>
        ))}

      <div className="field">
        <span className="field-label">日期 → 时间戳</span>
        <input
          className="input input-mono"
          type="datetime-local"
          value={dt}
          onChange={(e) => setDt(e.target.value)}
        />
      </div>
      {validReversed && (
        <div className="kv-row">
          <span>时间戳（毫秒 / 秒）</span>
          <span className="kv-value">
            {validReversed.getTime()} / {Math.floor(validReversed.getTime() / 1000)}
          </span>
        </div>
      )}
    </div>
  );
}

/* ---------- 编解码 ---------- */
function utf8ToB64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(bin);
}

function b64ToUtf8(s: string): string {
  const bin = atob(s.trim());
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function CodecTool() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");

  function run(op: "b64e" | "b64d" | "urle" | "urld") {
    try {
      if (op === "b64e") setOutput(utf8ToB64(input));
      else if (op === "b64d") setOutput(b64ToUtf8(input));
      else if (op === "urle") setOutput(encodeURIComponent(input));
      else setOutput(decodeURIComponent(input));
    } catch (e) {
      setOutput("");
      showToast(
        op === "b64d" || op === "urld"
          ? `解码失败：${String(e)}（请确认输入内容合法）`
          : String(e),
        "error",
        5000
      );
    }
  }

  return (
    <div className="stack">
      <div className="field">
        <span className="field-label">输入文本</span>
        <textarea
          className="textarea"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="支持中文"
          spellCheck={false}
        />
      </div>
      <div className="tool-actions">
        <button className="btn" onClick={() => run("b64e")} disabled={!input}>
          Base64 编码
        </button>
        <button className="btn" onClick={() => run("b64d")} disabled={!input}>
          Base64 解码
        </button>
        <button className="btn" onClick={() => run("urle")} disabled={!input}>
          URL 编码
        </button>
        <button className="btn" onClick={() => run("urld")} disabled={!input}>
          URL 解码
        </button>
        <button
          className="btn"
          onClick={() => {
            setInput("");
            setOutput("");
          }}
        >
          清空
        </button>
      </div>
      {output && (
        <div className="field">
          <span className="field-label">
            结果
            <CopyButton text={output} />
          </span>
          <textarea className="textarea" value={output} readOnly spellCheck={false} />
        </div>
      )}
    </div>
  );
}

/* ---------- UUID ---------- */
function UuidTool() {
  const [count, setCount] = useState(5);
  const [list, setList] = useState<string[]>([]);

  function generate() {
    const arr: string[] = [];
    for (let i = 0; i < count; i++) arr.push(crypto.randomUUID());
    setList(arr);
  }

  return (
    <div className="stack">
      <div className="tool-actions">
        {[1, 5, 10, 50].map((n) => (
          <button
            key={n}
            className={`btn ${count === n ? "btn-selected" : "btn-ghost"}`}
            onClick={() => setCount(n)}
          >
            {n} 个
          </button>
        ))}
        <button className="btn btn-primary" onClick={generate}>
          生成 UUID v4
        </button>
        {list.length > 0 && <CopyButton text={list.join("\n")} label="复制全部" />}
      </div>
      {list.length === 0 ? (
        <div className="placeholder-box">
          选择数量后点击「生成 UUID v4」，结果会显示在这里
        </div>
      ) : (
        <div className="field">
          <textarea
            className="textarea"
            value={list.join("\n")}
            readOnly
            spellCheck={false}
            rows={Math.min(Math.max(list.length + 1, 12), 28)}
          />
        </div>
      )}
    </div>
  );
}

/* ---------- 哈希 ---------- */
interface FileHashResult {
  file: string;
  size: number;
  md5: string;
  sha1: string;
  sha256: string;
  sha512: string;
}

function HashTool() {
  const [mode, setMode] = useState<"file" | "text">("file");
  return (
    <div>
      <div className="seg seg-sm" role="tablist">
        <button
          className={`seg-btn${mode === "file" ? " active" : ""}`}
          onClick={() => setMode("file")}
        >
          文件校验
        </button>
        <button
          className={`seg-btn${mode === "text" ? " active" : ""}`}
          onClick={() => setMode("text")}
        >
          文本哈希
        </button>
      </div>
      {/* 两个视图常驻挂载(仅隐藏),切 Tab 不打断后台计算 */}
      <div style={{ display: mode === "file" ? "" : "none" }}>
        <FileHashView active={mode === "file"} />
      </div>
      <div style={{ display: mode === "text" ? "" : "none" }}>
        <TextHashView />
      </div>
    </div>
  );
}

function FileHashView({ active }: { active: boolean }) {
  const [fileName, setFileName] = useState("");
  const [hashing, setHashing] = useState(false);
  const [hashPct, setHashPct] = useState(0);
  const [fileRes, setFileRes] = useState<FileHashResult | null>(null);
  const [fileDrag, setFileDrag] = useState(false);
  const [expected, setExpected] = useState("");

  // 期望值比对:忽略大小写与空白,命中任一算法即一致
  const compare = (() => {
    const e = expected.trim().toLowerCase().replace(/\s+/g, "");
    if (!fileRes || !e) return null;
    const pairs: [string, string][] = [
      ["MD5", fileRes.md5],
      ["SHA-1", fileRes.sha1],
      ["SHA-256", fileRes.sha256],
      ["SHA-512", fileRes.sha512],
    ];
    const hit = pairs.find(([, v]) => v.toLowerCase() === e);
    return hit ? `✓ 与 ${hit[0]} 一致` : "✗ 与期望值不一致";
  })();

  function clearFile() {
    setFileName("");
    setFileRes(null);
    setHashPct(0);
    setExpected("");
  }

  function selectFile(path: string) {
    setFileName(path);
    setFileRes(null);
    setHashPct(0);
  }

  async function pickFile() {
    if (hashing) return;
    const sel = await open({ multiple: false });
    if (typeof sel === "string") selectFile(sel);
  }

  async function startHash() {
    if (hashing || !fileName) return;
    setHashing(true);
    setHashPct(0);
    try {
      const r = await invoke<FileHashResult>("sb_hash_file", { path: fileName });
      setFileRes(r);
    } catch (e) {
      const msg = String(e);
      if (msg === "已取消") setHashPct(0);
      else showToast(msg, "error", 5000);
    } finally {
      setHashing(false);
    }
  }

  // 拖入文件仅选中,点「开始计算」才算;进度与取消复用全局任务槽
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "enter" || p.type === "over") {
          if (active) setFileDrag(true);
        } else if (p.type === "leave") {
          setFileDrag(false);
        } else if (p.type === "drop") {
          setFileDrag(false);
          if (active && p.paths.length && !hashing) selectFile(p.paths[0]);
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    const un = listen<{ done: number; total: number }>("hashfile://progress", (e) => {
      const { done, total } = e.payload;
      setHashPct(total > 0 ? Math.min(100, (done / total) * 100) : 0);
    });
    return () => {
      cancelled = true;
      unlisten?.();
      un.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cancelHash() {
    await invoke("sb_cancel").catch(() => {});
  }

  return (
    <div className="stack">
      <div className="field">
        <div
          className={`dropzone dropzone-sm${fileDrag ? " over" : ""}`}
          onClick={pickFile}
          role="button"
        >
          {fileName ? (
            <>
              <div className="dropzone-title" title={fileName}>
                {baseName(fileName)}
              </div>
              <div className="dropzone-sub">
                {hashing
                  ? `计算中 ${hashPct.toFixed(0)}%`
                  : fileRes
                    ? `完成 · ${fmtBytes(fileRes.size)}`
                    : "已选择，点击「开始计算」"}
              </div>
            </>
          ) : (
            <>
              <div className="dropzone-title">拖入文件到此处，或点击选择</div>
              <div className="dropzone-sub">完整读取计算，大小不限，数据不出本机</div>
            </>
          )}
          {hashing && (
            <div className="progress-track" style={{ width: "60%", marginTop: 10 }}>
              <div className="progress-fill" style={{ width: `${hashPct}%` }} />
            </div>
          )}
        </div>
      </div>

      <div className="field">
        <span className="field-label">期望哈希值（可选，粘贴官方校验值自动比对）</span>
        <input
          className="input input-mono"
          value={expected}
          onChange={(e) => setExpected(e.target.value)}
          placeholder="如 5d41402abc4b2a76b9719d911017c592"
          spellCheck={false}
        />
        {compare && (
          <span className={`jwt-chip ${compare.startsWith("✓") ? "valid" : "expired"}`}>
            {compare}
          </span>
        )}
      </div>

      <div className="tool-actions">
        {hashing ? (
          <button className="btn" onClick={cancelHash}>
            取消
          </button>
        ) : (
          <>
            <button className="btn btn-primary" onClick={startHash} disabled={!fileName}>
              开始计算
            </button>
            {fileName && (
              <button className="btn" onClick={clearFile}>
                清空
              </button>
            )}
          </>
        )}
      </div>

      {fileRes && (
        <>
          {[
            ["MD5", fileRes.md5],
            ["SHA-1", fileRes.sha1],
            ["SHA-256", fileRes.sha256],
            ["SHA-512", fileRes.sha512],
          ].map(([algo, value]) => (
            <div className="hash-row" key={algo}>
              <div className="hash-head">
                <span className="hash-algo">{algo}</span>
                <CopyButton text={value} />
              </div>
              <div className="hash-value">{value}</div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function TextHashView() {
  const [input, setInput] = useState("");
  const [hashes, setHashes] = useState<{ algo: string; value: string }[]>([]);

  async function compute() {
    try {
      const data = new TextEncoder().encode(input);
      const results: { algo: string; value: string }[] = [
        { algo: "MD5", value: md5(input) },
      ];
      for (const algo of ["SHA-1", "SHA-256", "SHA-512"] as const) {
        const buf = await crypto.subtle.digest(algo, data);
        const hexStr = [...new Uint8Array(buf)]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        results.push({ algo, value: hexStr });
      }
      setHashes(results);
    } catch (e) {
      setHashes([]);
      showToast(`SHA 计算不可用：${String(e)}`, "error", 5000);
    }
  }

  return (
    <div className="stack">
      <div className="field">
        <span className="field-label">输入文本（按 UTF-8 计算）</span>
        <textarea
          className="textarea"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
        />
      </div>
      <div className="tool-actions">
        <button className="btn btn-primary" onClick={compute} disabled={!input}>
          计算
        </button>
        {hashes.length > 0 && (
          <button
            className="btn"
            onClick={() => navigator.clipboard.writeText(hashes.map((h) => `${h.algo}  ${h.value}`).join("\n")).catch(() => {})}
          >
            复制全部
          </button>
        )}
        <button
          className="btn"
          onClick={() => {
            setInput("");
            setHashes([]);
          }}
        >
          清空
        </button>
      </div>
      {hashes.map((h) => (
        <div className="hash-row" key={h.algo}>
          <div className="hash-head">
            <span className="hash-algo">{h.algo}</span>
            <CopyButton text={h.value} />
          </div>
          <div className="hash-value">{h.value}</div>
        </div>
      ))}
    </div>
  );
}

/* ---------- JWT 解析 ---------- */
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

function JwtTool() {
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

/* ---------- SQL 格式化 ---------- */
const SQL_LANGS: { id: SqlLanguage; name: string }[] = [
  { id: "sql", name: "标准 SQL" },
  { id: "postgresql", name: "PostgreSQL" },
  { id: "mysql", name: "MySQL" },
  { id: "sqlite", name: "SQLite" },
];

function SqlTool() {
  const [input, setInput] = useState("");
  const [lang, setLang] = useState<SqlLanguage>("sql");
  const [output, setOutput] = useState("");
  // 高亮后的 HTML(仅用于展示;复制的仍是纯文本 output)
  const highlighted = useMemo(
    () => (output ? Prism.highlight(output, Prism.languages.sql, "sql") : ""), 
    [output]
  );

  function run() {
    if (!input.trim()) return;
    try {
      setOutput(
        format(input, { language: lang, keywordCase: "upper", tabWidth: 2, useTabs: false }),
      );
    } catch (e) {
      setOutput("");
      showToast(`SQL 解析失败：${String(e)}`, "error", 5000);
    }
  }

  return (
    <div className="stack">
      <div className="field">
        <span className="field-label">SQL 语句</span>
        <textarea
          className="textarea input-mono"
          style={{ height: 130 }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="粘贴 SQL，格式化后关键字大写、缩进对齐"
          spellCheck={false}
        />
      </div>
      <div className="tool-actions">
        <div className="diff-opts">
          {SQL_LANGS.map((l) => (
            <button
              key={l.id}
              className={`opt-chip${lang === l.id ? " on" : ""}`}
              onClick={() => setLang(l.id)}
            >
              {l.name}
            </button>
          ))}
        </div>
        <button className="btn btn-primary" onClick={run} disabled={!input.trim()}>
          格式化
        </button>
        <button
          className="btn"
          onClick={() => {
            setInput("");
            setOutput("");
          }}
        >
          清空
        </button>
      </div>
      {output && (
        <div className="field">
          <span className="field-label">
            结果
            <CopyButton text={output} />
          </span>
          <div className="sql-out">
            <pre dangerouslySetInnerHTML={{ __html: highlighted }} />
          </div>
        </div>
      )}
    </div>
  );
}