import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import CopyButton from "../../components/CopyButton";
import { showToast } from "../../components/Toast";
import { fmtBytes } from "../../lib/format";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Method = (typeof METHODS)[number];

interface HttpResult {
  status: number;
  headers: [string, string][];
  body: string;
  time_ms: number;
  size: number;
}

interface HeaderRow {
  k: string;
  v: string;
}

export default function HttpTool() {
  const [method, setMethod] = useState<Method>("GET");
  const [url, setUrl] = useState("https://httpbin.org/get");
  const [rows, setRows] = useState<HeaderRow[]>([]);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [res, setRes] = useState<HttpResult | null>(null);

  async function send() {
    if (!url.trim()) {
      showToast("请输入请求地址", "error", 3000);
      return;
    }
    setSending(true);
    setRes(null);
    try {
      const r = await invoke<HttpResult>("http_request", {
        method,
        url: url.trim(),
        headers: rows.filter((x) => x.k.trim()).map((x) => [x.k.trim(), x.v.trim()]),
        body: method === "GET" ? null : body,
      });
      setRes(r);
    } catch (e) {
      showToast(String(e), "error", 5000);
    } finally {
      setSending(false);
    }
  }

  const prettyBody = useMemo(() => {
    if (!res) return "";
    try {
      return JSON.stringify(JSON.parse(res.body), null, 2);
    } catch {
      return res.body;
    }
  }, [res]);
  const isJson = res !== null && prettyBody !== res.body;

  const statusClass = !res
    ? ""
    : res.status < 300
      ? " c-ok"
      : res.status < 400
        ? " c-redir"
        : " c-err";

  return (
    <div className="stack">
      <div className="field">
        <div className="http-row">
          <div className="seg seg-sm http-method" role="tablist">
            {METHODS.map((m) => (
              <button
                key={m}
                className={`seg-btn${method === m ? " active" : ""}`}
                onClick={() => setMethod(m)}
              >
                {m}
              </button>
            ))}
          </div>
          <input
            className="input input-mono http-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
            }}
          />
          <button className="btn btn-primary btn-sm" onClick={send} disabled={sending}>
            {sending ? "发送中…" : "发送"}
          </button>
        </div>
      </div>

      <div className="field">
        <span className="field-label">
          请求头
          <button className="btn-text" onClick={() => setRows((s) => [...s, { k: "", v: "" }])}>
            添加
          </button>
        </span>
        {rows.map((r, i) => (
          <div className="http-header-row" key={i}>
            <input
              className="input input-sm"
              style={{ width: 180 }}
              placeholder="名称"
              value={r.k}
              onChange={(e) =>
                setRows((s) => s.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))
              }
              spellCheck={false}
            />
            <input
              className="input input-sm http-hv"
              placeholder="值"
              value={r.v}
              onChange={(e) =>
                setRows((s) => s.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))
              }
              spellCheck={false}
            />
            <button className="btn-text" onClick={() => setRows((s) => s.filter((_, j) => j !== i))}>
              移除
            </button>
          </div>
        ))}
      </div>

      <div className="field">
        <span className="field-label">请求体（GET 忽略；Content-Type 用请求头自行指定）</span>
        <textarea
          className="textarea input-mono"
          style={{ height: 96 }}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          spellCheck={false}
        />
      </div>

      {res && (
        <>
          <div className="tool-actions">
            <span className={`jwt-chip http-status${statusClass}`}>状态 {res.status}</span>
            <span className="hint">耗时 {res.time_ms} ms</span>
            <span className="hint">大小 {fmtBytes(res.size)}</span>
          </div>
          <div className="field">
            <span className="field-label">响应头</span>
            <div className="kv-list">
              {res.headers.map(([k, v]) => (
                <div className="kv-row" key={k}>
                  <span className="kv-k" style={{ minWidth: 140 }}>
                    {k}
                  </span>
                  <span className="kv-v kv-mono">{v}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="field-label">
              响应体
              {isJson && <span className="hint">已自动格式化 JSON</span>}
              <CopyButton text={res.body} />
            </span>
            <textarea
              className="textarea input-mono"
              style={{ height: 240 }}
              value={prettyBody}
              readOnly
              spellCheck={false}
            />
          </div>
        </>
      )}
    </div>
  );
}
