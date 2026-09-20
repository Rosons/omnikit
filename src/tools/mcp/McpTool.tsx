import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { showToast } from "../../components/Toast";
import CopyButton from "../../components/CopyButton";
import Dropdown from "../../components/Dropdown";

const KINDS = [
  { id: "stdio", label: "本地命令" },
  { id: "http", label: "Streamable HTTP" },
  { id: "sse", label: "HTTP+SSE 旧版" },
] as const;
type Kind = (typeof KINDS)[number]["id"];

const SERVERS_KEY = "omnikit.mcp.servers";

interface SavedServer {
  kind: Kind;
  target: string;
  headers: HeaderRow[];
}

function loadServers(): SavedServer[] {
  try {
    const arr = JSON.parse(localStorage.getItem(SERVERS_KEY) ?? "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** 连接成功后自动记住服务器(同传输+同地址去重,最多 20 条) */
function saveServer(s: SavedServer): SavedServer[] {
  const list = [s, ...loadServers().filter((x) => !(x.kind === s.kind && x.target === s.target))].slice(0, 20);
  localStorage.setItem(SERVERS_KEY, JSON.stringify(list));
  return list;
}

interface McpInfo {
  protocol_version: string;
  server_name: string;
  server_version: string;
  capabilities: string[];
  instructions: string | null;
}
interface McpTool {
  name: string;
  description: string | null;
  schema: unknown;
}
interface McpResource {
  uri: string;
  name: string | null;
  description: string | null;
  mime_type: string | null;
}
interface McpPrompt {
  name: string;
  description: string | null;
}
interface McpCallResult {
  is_error: boolean;
  text: string;
  raw: unknown;
  elapsed_ms: number;
}
interface HeaderRow {
  k: string;
  v: string;
}

/** 按 JSON Schema 生成参数模板:仅填必填项(无必填时填全部) */
function templateFromSchema(schema: unknown): string {
  const gen = (x: Record<string, unknown>): unknown => {
    if (!x || typeof x !== "object") return null;
    if (Array.isArray(x.enum) && x.enum.length) return x.enum[0];
    if (x.default !== undefined) return x.default;
    const props = (x.properties ?? {}) as Record<string, unknown>;
    switch (x.type) {
      case "object": {
        const o: Record<string, unknown> = {};
        const req = Array.isArray(x.required) && x.required.length
          ? (x.required as string[])
          : Object.keys(props);
        for (const k of req) {
          const ps = props[k] as Record<string, unknown> | undefined;
          if (ps) o[k] = gen(ps);
        }
        return o;
      }
      case "array":
        return [gen((x.items ?? {}) as Record<string, unknown>)];
      case "string":
        return "";
      case "number":
      case "integer":
        return 0;
      case "boolean":
        return false;
      case "null":
        return null;
      default:
        return Object.keys(props).length
          ? gen({ type: "object", properties: props })
          : null;
    }
  };
  return JSON.stringify(gen((schema ?? {}) as Record<string, unknown>) ?? {}, null, 2);
}

export default function McpTool() {
  const [kind, setKind] = useState<Kind>("stdio");
  const [target, setTarget] = useState("");
  const [headers, setHeaders] = useState<HeaderRow[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [info, setInfo] = useState<McpInfo | null>(null);
  const [tools, setTools] = useState<McpTool[] | null>(null);
  const [resources, setResources] = useState<McpResource[]>([]);
  const [prompts, setPrompts] = useState<McpPrompt[]>([]);
  const [sel, setSel] = useState<McpTool | null>(null);
  const [args, setArgs] = useState("{}");
  const [calling, setCalling] = useState(false);
  const [result, setResult] = useState<McpCallResult | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [servers, setServers] = useState<SavedServer[]>(loadServers);

  useEffect(() => {
    // 首次进入自动填上次用过的服务器
    const s = loadServers()[0];
    if (s && !target) {
      setKind(s.kind);
      setTarget(s.target);
      setHeaders(s.headers ?? []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshLog() {
    try {
      setLog(await invoke<string[]>("mcp_log"));
    } catch {
      /* 未连接时忽略 */
    }
  }

  async function connect() {
    if (!target.trim()) {
      showToast(kind === "stdio" ? "请输入启动命令" : "请输入服务器地址", "error", 3000);
      return;
    }
    setConnecting(true);
    setInfo(null);
    setTools(null);
    setResources([]);
    setPrompts([]);
    setSel(null);
    setResult(null);
    try {
      const nfo = await invoke<McpInfo>("mcp_connect", {
        kind,
        target: target.trim(),
        headers: headers
          .filter((h) => h.k.trim())
          .map((h) => [h.k.trim(), h.v.trim()] as [string, string]),
      });
      setServers(saveServer({ kind, target: target.trim(), headers }));
      setInfo(nfo);
      if (nfo.capabilities.includes("工具")) {
        setTools(await invoke<McpTool[]>("mcp_list_tools"));
      }
      if (nfo.capabilities.includes("资源")) {
        setResources(await invoke<McpResource[]>("mcp_list_resources"));
      }
      if (nfo.capabilities.includes("提示")) {
        setPrompts(await invoke<McpPrompt[]>("mcp_list_prompts"));
      }
      refreshLog();
      showToast(`已连接 ${nfo.server_name}`, "success");
    } catch (e) {
      // 连接失败落本地日志,带传输方式与目标,便于事后排查
      invoke("log_append", {
        level: "error",
        source: "mcp",
        message: `连接失败 ${kind} ${target.trim()}：${String(e)}`.slice(0, 600),
      }).catch(() => {});
      showToast(String(e), "error", 6000);
      refreshLog();
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    await invoke("mcp_disconnect").catch(() => {});
    setInfo(null);
    setTools(null);
    setResources([]);
    setPrompts([]);
    setSel(null);
    setResult(null);
    setLog([]);
  }

  function pickTool(t: McpTool) {
    setSel(t);
    setResult(null);
    setShowRaw(false);
    setArgs(templateFromSchema(t.schema));
  }

  async function call() {
    if (!sel || calling) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(args || "{}");
    } catch {
      showToast("参数不是合法 JSON，请检查", "error", 3000);
      return;
    }
    setCalling(true);
    try {
      const r = await invoke<McpCallResult>("mcp_call_tool", {
        name: sel.name,
        argsJson: JSON.stringify(parsed),
      });
      setResult(r);
      refreshLog();
    } catch (e) {
      invoke("log_append", {
        level: "warn",
        source: "mcp",
        message: `工具调用失败 ${sel.name}：${String(e)}`.slice(0, 500),
      }).catch(() => {});
      showToast(String(e), "error", 6000);
      refreshLog();
    } finally {
      setCalling(false);
    }
  }

  const schemaText = sel ? JSON.stringify(sel.schema, null, 2) : "";

  return (
    <div className="stack">
      <div className="field">
        <span className="field-label">连接方式</span>
        <div className="tool-actions">
          <div className="diff-opts">
            {KINDS.map((k) => (
              <button
                key={k.id}
                className={`opt-chip${kind === k.id ? " on" : ""}`}
                onClick={() => setKind(k.id)}
              >
                {k.label}
              </button>
            ))}
          </div>
          <input
            className="input input-mono http-hv"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={
              kind === "stdio"
                ? "如 npx -y @modelcontextprotocol/server-everything"
                : kind === "sse"
                  ? "如 https://example.com/sse"
                  : "如 https://example.com/mcp"
            }
            spellCheck={false}
          />
          {info ? (
            <button className="btn" onClick={disconnect}>
              断开
            </button>
          ) : (
            <button className="btn btn-primary" onClick={connect} disabled={connecting}>
              {connecting ? "连接中…" : "连接"}
            </button>
          )}
        </div>
        {servers.length > 0 && !info && (
          <div className="tool-actions" style={{ marginTop: 6 }}>
            <Dropdown
              width={320}
              value=""
              onChange={(v) => {
                const s = servers.find((x) => `${x.kind}|${x.target}` === v);
                if (s) {
                  setKind(s.kind);
                  setTarget(s.target);
                  setHeaders(s.headers ?? []);
                  showToast("已填入该服务器配置，点「连接」连上", "info", 3000);
                }
              }}
              options={[
                { value: "", label: `已保存的服务器（${servers.length}）` },
                ...servers.map((s) => ({
                  value: `${s.kind}|${s.target}`,
                  label: `[${KINDS.find((k) => k.id === s.kind)?.label}] ${s.target}`,
                })),
              ]}
            />
            <button
              className="btn-text"
              onClick={() => {
                localStorage.removeItem(SERVERS_KEY);
                setServers([]);
                showToast("已清空保存的服务器记录", "success", 3000);
              }}
            >
              清空记录
            </button>
          </div>
        )}
        {kind !== "stdio" && !info && (
          <div className="field" style={{ marginTop: 6 }}>
            <span className="field-label">
              自定义请求头
              <button
                className="btn-text"
                onClick={() => setHeaders((s) => [...s, { k: "", v: "" }])}
              >
                添加
              </button>
            </span>
            {headers.map((r, i) => (
              <div className="http-header-row" key={i}>
                <input
                  className="input input-sm"
                  style={{ width: 180 }}
                  placeholder="名称"
                  value={r.k}
                  onChange={(e) =>
                    setHeaders((s) => s.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))
                  }
                  spellCheck={false}
                />
                <input
                  className="input input-sm http-hv"
                  placeholder="值"
                  value={r.v}
                  onChange={(e) =>
                    setHeaders((s) => s.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))
                  }
                  spellCheck={false}
                />
                <button
                  className="btn-text"
                  onClick={() => setHeaders((s) => s.filter((_, j) => j !== i))}
                >
                  移除
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {info && (
        <div className="tool-actions">
          <span className="jwt-chip valid">
            {info.server_name}
            {info.server_version ? ` ${info.server_version}` : ""}
          </span>
          <span className="hint">协议 {info.protocol_version}</span>
          {info.capabilities.map((c) => (
            <span key={c} className="opt-chip on" style={{ cursor: "default" }}>
              {c}
            </span>
          ))}
        </div>
      )}

      {info?.instructions && (
        <div className="notice notice-info">
          <span className="notice-text">{info.instructions}</span>
        </div>
      )}

      {tools && (
        <div className="field">
          <span className="field-label">工具（{tools.length}）</span>
          <div className="kv-list">
            {tools.length === 0 && (
              <div className="kv-row">
                <span className="hint">服务器没有暴露任何工具</span>
              </div>
            )}
            {tools.map((t) => (
              <div className={`kv-row${sel?.name === t.name ? " mcp-sel" : ""}`} key={t.name}>
                <span className="kv-k" style={{ minWidth: 120 }}>
                  {t.name}
                </span>
                <span className="mcp-desc" title={t.description ?? ""}>
                  {t.description ?? ""}
                </span>
                <button className="btn-text" onClick={() => pickTool(t)}>
                  调用
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {sel && (
        <div className="field">
          <span className="field-label">
            调用「{sel.name}」
            <details className="mcp-inline">
              <summary>
                参数 Schema
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                  <path
                    d="M2 3.5L5 6.5L8 3.5"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </summary>
              <pre>{schemaText || "（无）"}</pre>
            </details>
          </span>
          <textarea
            className="textarea input-mono"
            style={{ height: 140 }}
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            placeholder="工具参数 JSON"
            spellCheck={false}
          />
          <div className="tool-actions">
            <button className="btn btn-primary" onClick={call} disabled={calling}>
              {calling ? "调用中…" : "发送调用"}
            </button>
            <button className="btn" onClick={() => setSel(null)}>
              关闭
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="field">
          <span className="field-label">
            调用结果
            <span className={`jwt-chip ${result.is_error ? "expired" : "valid"}`}>
              {result.is_error ? "失败" : "成功"} · {result.elapsed_ms} ms
            </span>
            <button className="btn-text" onClick={() => setShowRaw((v) => !v)}>
              {showRaw ? "查看文本" : "查看原始 JSON"}
            </button>
            <CopyButton
              text={showRaw ? JSON.stringify(result.raw, null, 2) : result.text}
              label="复制结果"
            />
          </span>
          <div className="sql-out">
            <pre>
              {showRaw
                ? JSON.stringify(result.raw, null, 2)
                : result.text || "（无文本内容）"}
            </pre>
          </div>
        </div>
      )}

      {info && resources.length > 0 && (
        <div className="field">
          <span className="field-label">资源（{resources.length}）</span>
          <div className="kv-list">
            {resources.map((r) => (
              <div className="kv-row" key={r.uri}>
                <span className="kv-k" style={{ minWidth: 140 }}>
                  {r.name ?? r.uri}
                </span>
                <span className="mcp-desc" title={r.description ?? ""}>
                  {r.mime_type ? `${r.mime_type} · ` : ""}
                  {r.uri}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {info && prompts.length > 0 && (
        <div className="field">
          <span className="field-label">提示模板（{prompts.length}）</span>
          <div className="kv-list">
            {prompts.map((p) => (
              <div className="kv-row" key={p.name}>
                <span className="kv-k" style={{ minWidth: 140 }}>
                  {p.name}
                </span>
                <span className="mcp-desc" title={p.description ?? ""}>
                  {p.description ?? ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {info && (
        <details className="mcp-log">
          <summary onClick={refreshLog}>JSON-RPC 收发日志（点击展开并刷新）</summary>
          <pre>{log.length ? log.join("\n") : "暂无记录"}</pre>
        </details>
      )}

      <div className="hint">
        本地命令传输支持带引号的启动命令，断开或退出应用时自动结束子进程；远程推荐 Streamable HTTP（2025-06-18 规范），公司内网老网关或只支持 GET /sse 的服务用「HTTP+SSE 旧版」，需要鉴权时添加请求头；连接成功的服务器会自动记住，下次一键填入
      </div>
    </div>
  );
}
