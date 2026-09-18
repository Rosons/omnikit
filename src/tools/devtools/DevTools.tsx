import { useEffect, useMemo, useState } from "react";
import { md5 } from "./md5";

const TABS = [
  { id: "json", name: "JSON" },
  { id: "time", name: "时间戳" },
  { id: "codec", name: "编解码" },
  { id: "uuid", name: "UUID" },
  { id: "hash", name: "哈希" },
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
    </div>
  );
}

/* ---------- 复制按钮 ---------- */
function CopyButton({ text, label = "复制" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn-text"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* 忽略 */
        }
      }}
    >
      {done ? "已复制" : label}
    </button>
  );
}

/* ---------- JSON 格式化 ---------- */
function JsonTool() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");

  function run(pretty: boolean) {
    try {
      const parsed = JSON.parse(input);
      setOutput(pretty ? JSON.stringify(parsed, null, 2) : JSON.stringify(parsed));
      setError("");
    } catch (e) {
      setOutput("");
      setError(String(e));
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
          placeholder='粘贴 JSON,如 {"a":1}'
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
        <button
          className="btn"
          onClick={() => {
            setInput("");
            setOutput("");
            setError("");
          }}
        >
          清空
        </button>
        {error && <span className="hint hint-error">{error}</span>}
        {!error && output && <span className="hint hint-ok">JSON 合法</span>}
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
        <span className="field-label">时间戳 → 日期(10 位秒 / 13 位毫秒,自动识别)</span>
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
          <span className="hint hint-error">无法识别的时间戳,请输入纯数字</span>
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
          <span>时间戳(毫秒 / 秒)</span>
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
  const [error, setError] = useState("");

  function run(op: "b64e" | "b64d" | "urle" | "urld") {
    setError("");
    try {
      if (op === "b64e") setOutput(utf8ToB64(input));
      else if (op === "b64d") setOutput(b64ToUtf8(input));
      else if (op === "urle") setOutput(encodeURIComponent(input));
      else setOutput(decodeURIComponent(input));
    } catch (e) {
      setOutput("");
      setError(String(e));
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
            setError("");
          }}
        >
          清空
        </button>
      </div>
      {error && <span className="hint hint-error">{error}(Base64 解码请确认输入合法)</span>}
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
        <span className="field-label">生成数量</span>
        {[1, 5, 10, 50].map((n) => (
          <button
            key={n}
            className={`seg-btn${count === n ? " active" : ""}`}
            style={{ padding: "4px 14px" }}
            onClick={() => setCount(n)}
          >
            {n}
          </button>
        ))}
        <button className="btn btn-primary" onClick={generate}>
          生成 UUID v4
        </button>
        {list.length > 0 && <CopyButton text={list.join("\n")} label="复制全部" />}
      </div>
      {list.length > 0 && (
        <div className="field">
          <textarea
            className="textarea"
            value={list.join("\n")}
            readOnly
            spellCheck={false}
            style={{ minHeight: 180 }}
          />
        </div>
      )}
    </div>
  );
}

/* ---------- 哈希 ---------- */
function HashTool() {
  const [input, setInput] = useState("");
  const [hashes, setHashes] = useState<{ algo: string; value: string }[]>([]);
  const [error, setError] = useState("");

  async function compute() {
    setError("");
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
      setError(`SHA 计算不可用：${String(e)}`);
    }
  }

  return (
    <div className="stack">
      <div className="field">
        <span className="field-label">输入文本(按 UTF-8 计算)</span>
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
            setError("");
          }}
        >
          清空
        </button>
        {error && <span className="hint hint-error">{error}</span>}
      </div>
      {hashes.map((h) => (
        <div className="kv-row" key={h.algo}>
          <span style={{ flex: "none", fontWeight: 600 }}>{h.algo}</span>
          <span className="kv-value">{h.value}</span>
          <CopyButton text={h.value} />
        </div>
      ))}
    </div>
  );
}
