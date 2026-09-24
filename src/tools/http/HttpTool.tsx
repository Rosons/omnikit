import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import CopyButton from "../../components/CopyButton";
import { showConfirm } from "../../components/ConfirmDialog";
import { showToast } from "../../components/Toast";
import Switch from "../../components/Switch";
import { parseCurl } from "../../lib/curl";
import { fmtBytes } from "../../lib/format";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;
type Method = (typeof METHODS)[number];

const HIST_KEY = "omnikit.http.history";
const ENV_KEY = "omnikit.http.env";
const RECORD_KEY = "omnikit.http.record";
const TIMEOUT_KEY = "omnikit.http.timeout";
const HIST_MAX = 50;

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

interface HistEntry {
  t: number;
  method: string;
  url: string;
  status: number;
  ms: number;
  headers: HeaderRow[];
  body: string;
}

/** 发送前把 {{名称}} 替换为环境变量值,未定义的保持原样 */
function applyEnv(text: string, env: HeaderRow[]): string {
  if (env.length === 0 || !text.includes("{{")) return text;
  const map = new Map(env.filter((e) => e.k.trim()).map((e) => [e.k.trim(), e.v]));
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (raw, name) => map.get(name) ?? raw);
}

function fmtClock(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function statusClass(s: number): string {
  return s < 300 ? " c-ok" : s < 400 ? " c-redir" : " c-err";
}

export default function HttpTool() {
  const [method, setMethod] = useState<Method>("GET");
  const [url, setUrl] = useState("https://httpbin.org/get");
  const [rows, setRows] = useState<HeaderRow[]>([]);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [res, setRes] = useState<HttpResult | null>(null);

  // cURL 导入
  const [curlOpen, setCurlOpen] = useState(false);
  const [curlText, setCurlText] = useState("");
  const [curlErr, setCurlErr] = useState("");
  const [curlWarns, setCurlWarns] = useState<string[]>([]);
  // 环境变量与历史(均存 localStorage)
  const [envOpen, setEnvOpen] = useState(false);
  const [envRows, setEnvRows] = useState<HeaderRow[]>([]);
  const [histOpen, setHistOpen] = useState(false);
  const [hist, setHist] = useState<HistEntry[]>([]);
  // 请求历史记录开关(默认开;关掉后发送不落任何历史)
  const [record, setRecord] = useState(() => localStorage.getItem(RECORD_KEY) !== "off");
  // 超时秒数(1~300,默认 30)
  const [timeoutSecs, setTimeoutSecs] = useState(() => {
    const n = Number(localStorage.getItem(TIMEOUT_KEY));
    return Number.isFinite(n) && n >= 1 && n <= 300 ? Math.round(n) : 30;
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(ENV_KEY);
      if (raw) setEnvRows(JSON.parse(raw));
    } catch {
      /* 忽略坏数据 */
    }
    try {
      const raw = localStorage.getItem(HIST_KEY);
      if (raw) setHist(JSON.parse(raw));
    } catch {
      /* 忽略坏数据 */
    }
  }, []);

  function setRecordRun(v: boolean) {
    setRecord(v);
    localStorage.setItem(RECORD_KEY, v ? "on" : "off");
  }

  function saveEnv(rows: HeaderRow[]) {
    setEnvRows(rows);
    localStorage.setItem(ENV_KEY, JSON.stringify(rows));
  }

  function pushHistory(entry: HistEntry) {
    setHist((prev) => {
      const list = [entry, ...prev].slice(0, HIST_MAX);
      localStorage.setItem(HIST_KEY, JSON.stringify(list));
      return list;
    });
  }

  async function send() {
    if (!url.trim()) {
      showToast("请输入请求地址", "error", 3000);
      return;
    }
    setSending(true);
    setRes(null);
    const realHeaders = rows
      .filter((x) => x.k.trim())
      .map((x) => [x.k.trim(), applyEnv(x.v, envRows)] as [string, string]);
    try {
      const r = await invoke<HttpResult>("http_request", {
        method,
        url: applyEnv(url.trim(), envRows),
        headers: realHeaders,
        body: method === "GET" || method === "HEAD" ? null : applyEnv(body, envRows),
        timeoutSecs,
      });
      setRes(r);
      if (record) {
        pushHistory({
          t: Date.now(),
          method,
          url: url.trim(),
          status: r.status,
          ms: r.time_ms,
          headers: rows.filter((x) => x.k.trim()),
          body,
        });
      }
    } catch (e) {
      // 网络层失败(非 4xx/5xx)记入本地日志,便于事后排查
      invoke("log_append", {
        level: "warn",
        source: "http",
        message: `请求失败 ${method} ${url.trim()}：${String(e)}`.slice(0, 500),
      }).catch(() => {});
      showToast(String(e), "error", 5000);
    } finally {
      setSending(false);
    }
  }

  function doImportCurl() {
    setCurlErr("");
    setCurlWarns([]);
    try {
      const r = parseCurl(curlText);
      if (!METHODS.includes(r.method as Method)) {
        setCurlErr(`暂不支持 ${r.method} 方法`);
        return;
      }
      setMethod(r.method as Method);
      setUrl(r.url);
      setRows(r.headers);
      setBody(r.body);
      setCurlWarns(r.warnings);
      setCurlOpen(false);
      showToast(
        r.warnings.length > 0
          ? `已导入，注意 ${r.warnings.length} 条提醒`
          : "已导入 cURL 请求",
        r.warnings.length > 0 ? "info" : "success",
        4000,
      );
    } catch (e) {
      setCurlErr(e instanceof Error ? e.message : String(e));
    }
  }

  function restore(h: HistEntry) {
    setMethod((METHODS as readonly string[]).includes(h.method) ? (h.method as Method) : "GET");
    setUrl(h.url);
    setRows(h.headers);
    setBody(h.body);
    setRes(null);
    setHistOpen(false);
    showToast("已恢复该请求", "success", 2000);
  }

  async function clearHist() {
    const ok = await showConfirm({
      title: "清空请求历史",
      message: "确定清空全部请求历史吗？",
      confirmLabel: "清空",
      danger: true,
    });
    if (!ok) return;
    setHist([]);
    localStorage.removeItem(HIST_KEY);
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

  // 请求体按内容行数自适应高度:空时一行高,最多 200px
  const bodyLines = body ? body.split("\n").length : 1;
  const bodyHeight = Math.min(200, Math.max(46, 14 + bodyLines * 18));

  const envCount = envRows.filter((e) => e.k.trim()).length;

  return (
    <div className="stack http-page">
      <div className="field http-flex-none">
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
            className="input input-sm input-mono http-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://，支持 {{变量}}"
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

      <div className="tool-actions http-flex-none">
        <button
          className={`btn btn-sm${curlOpen ? " btn-selected" : ""}`}
          onClick={() => setCurlOpen((v) => !v)}
        >
          导入 cURL
        </button>
        <button
          className={`btn btn-sm${envOpen ? " btn-selected" : ""}`}
          onClick={() => setEnvOpen((v) => !v)}
        >
          环境变量{envCount > 0 ? ` · ${envCount}` : ""}
        </button>
        <button
          className={`btn btn-sm${histOpen ? " btn-selected" : ""}`}
          onClick={() => setHistOpen((v) => !v)}
        >
          历史{hist.length > 0 ? ` · ${hist.length}` : ""}
        </button>
        <span className="kv-k" style={{ marginLeft: 4 }}>
          记录历史
          <Switch on={record} onChange={setRecordRun} />
        </span>
        <span className="kv-k" style={{ marginLeft: 12 }}>
          超时
          <input
            className="input input-sm"
            style={{ width: 62, marginLeft: 6 }}
            type="number"
            min={1}
            max={300}
            value={timeoutSecs}
            title="请求超时秒数（1～300）"
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) setTimeoutSecs(Math.round(n));
            }}
            onBlur={() => {
              const v = Math.min(300, Math.max(1, timeoutSecs || 30));
              setTimeoutSecs(v);
              localStorage.setItem(TIMEOUT_KEY, String(v));
            }}
          />
          秒
        </span>
        {!record && <span className="hint">已暂停记录，发送过的请求不保留</span>}
      </div>

      {curlOpen && (
        <div className="field http-flex-none">
          <span className="field-label">
            粘贴 cURL 命令
            <button className="btn-text" onClick={doImportCurl} disabled={!curlText.trim()}>
              解析并填入
            </button>
          </span>
          <textarea
            className="textarea input-mono"
            style={{ height: 110 }}
            value={curlText}
            onChange={(e) => setCurlText(e.target.value)}
            placeholder={"curl -X POST https://api.example.com/users \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"name\":\"张三\"}'"}
            spellCheck={false}
          />
          {curlErr && <span className="hint hint-error">{curlErr}</span>}
          {curlWarns.length > 0 && (
            <span className="hint">
              {curlWarns.map((w, i) => (
                <div key={i}>· {w}</div>
              ))}
            </span>
          )}
        </div>
      )}

      {envOpen && (
        <div className="field http-flex-none">
          <span className="field-label">
            环境变量
            <button
              className="btn-text"
              onClick={() => saveEnv([...envRows, { k: "", v: "" }])}
            >
              添加
            </button>
            <span className="hint">地址、请求头与请求体中的 {"{{名称}}"} 在发送时替换为对应值，修改即保存</span>
          </span>
          {envRows.map((r, i) => (
            <div className="http-header-row" key={i}>
              <input
                className="input input-sm"
                style={{ width: 160 }}
                placeholder="名称"
                value={r.k}
                onChange={(e) =>
                  saveEnv(envRows.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))
                }
                spellCheck={false}
              />
              <input
                className="input input-sm http-hv"
                placeholder="值"
                value={r.v}
                onChange={(e) =>
                  saveEnv(envRows.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))
                }
                spellCheck={false}
              />
              <button
                className="btn-text"
                onClick={() => saveEnv(envRows.filter((_, j) => j !== i))}
              >
                移除
              </button>
            </div>
          ))}
          {envRows.length === 0 && <span className="hint">暂无变量，先添加一条</span>}
        </div>
      )}

      {histOpen && (
        <div className="field http-flex-none">
          <span className="field-label">
            请求历史（保留最近 {HIST_MAX} 条，重启不丢）
            {hist.length > 0 && (
              <button className="btn-text" onClick={clearHist}>
                清空
              </button>
            )}
          </span>
          {hist.length === 0 ? (
            <span className="hint">还没有记录，发送第一个请求后自动保存</span>
          ) : (
            <div className="kv-list http-hist-list">
              {hist.map((h, i) => (
                <div
                  className="kv-row http-hist-row"
                  key={`${h.t}-${i}`}
                  onClick={() => restore(h)}
                  title="点击恢复该请求"
                >
                  <span className="badge">{h.method}</span>
                  <span className="http-hist-url" title={h.url}>
                    {h.url}
                  </span>
                  <span className={`jwt-chip http-status${statusClass(h.status)}`}>
                    {h.status}
                  </span>
                  <span className="hint http-hist-meta">
                    {fmtClock(h.t)} · {h.ms} ms
                  </span>
                  <button
                    className="btn-text"
                    onClick={(e) => {
                      e.stopPropagation();
                      const next = hist.filter((_, j) => j !== i);
                      setHist(next);
                      localStorage.setItem(HIST_KEY, JSON.stringify(next));
                    }}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="field http-flex-none">
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

      {method !== "GET" && method !== "HEAD" && (
        <div className="field http-flex-none">
          <span className="field-label">请求体（Content-Type 用请求头自行指定）</span>
          <textarea
            className="textarea input-mono http-body-input"
            style={{ height: bodyHeight }}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="空请求体可不填，支持 {{变量}}"
            spellCheck={false}
          />
        </div>
      )}

      {res && (
        <>
          <div className="tool-actions http-flex-none">
            <span className={`jwt-chip http-status${statusClass(res.status)}`}>
              状态 {res.status}
            </span>
            <span className="hint">耗时 {res.time_ms} ms</span>
            <span className="hint">大小 {fmtBytes(res.size)}</span>
          </div>
          <div className="field http-flex-none">
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
          <div className="field http-flex http-body">
            <span className="field-label">
              响应体
              {isJson && <span className="hint">已自动格式化 JSON</span>}
              <CopyButton text={res.body} />
            </span>
            <textarea
              className="textarea http-body-out"
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
