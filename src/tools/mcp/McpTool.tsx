import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { showToast } from "../../components/Toast";
import CopyButton from "../../components/CopyButton";
import Dropdown from "../../components/Dropdown";

const KINDS = [
  { id: "stdio", label: "本地命令" },
  { id: "http", label: "Streamable HTTP" },
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
    if (!Array.isArray(arr)) return [];
    // 旧版本保存过 SSE 服务器,入口已移除,加载时过滤掉
    return arr.filter((x) => x && x.kind !== "sse");
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

/** 把一行日志(→/← 开头 + JSON)格式化为「分隔行 + 缩进 JSON」;
 *  备注行([sse] 等)与非 JSON 内容原样保留 */
function fmtLogLine(line: string): string {
  const dir = line.startsWith("->") ? "发送" : line.startsWith("<-") ? "接收" : null;
  if (!dir) return line;
  const body = line.slice(2).trim();
  try {
    const v = JSON.parse(body) as Record<string, unknown>;
    let pretty = JSON.stringify(v, null, 2);
    if (pretty.length > 3000) pretty = `${pretty.slice(0, 3000)}\n…（超出部分已截断）`;
    const what =
      typeof v.method === "string"
        ? String(v.method)
        : v.error !== undefined
          ? "错误应答"
          : "结果";
    return `── ${dir} · ${what} ──\n${pretty}`;
  } catch {
    // 大帧尾部被截断等情况:原样展示
    return line;
  }
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
  const [servers, setServers] = useState<SavedServer[]>(() => loadServers());
  // 左栏页签与工具筛选(工具一多时靠筛选快速定位)
  const [tab, setTab] = useState<"tools" | "resources" | "prompts">("tools");
  const [toolQ, setToolQ] = useState("");
  // JSON-RPC 日志弹窗(低频场景:排协议问题时才看)
  const [logOpen, setLogOpen] = useState(false);

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
      // 文本内容为空时直接看原始 JSON,省一次手动切换
      setShowRaw(r.text.trim() === "");
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
  const filteredTools = tools?.filter((t) =>
    (t.name + (t.description ?? "")).toLowerCase().includes(toolQ.trim().toLowerCase()),
  );

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
        <details className="mcp-instructions">
          <summary>服务器使用说明（点击展开）</summary>
          <pre>{info.instructions}</pre>
        </details>
      )}

      {tools && (
        <div className="mcp-work">
          {/* 左侧:能力导航(整行可点,两行式条目) */}
          <aside className="mcp-side">
            <div className="diff-opts">
              <button
                className={`opt-chip${tab === "tools" ? " on" : ""}`}
                onClick={() => setTab("tools")}
              >
                工具 {tools.length}
              </button>
              {resources.length > 0 && (
                <button
                  className={`opt-chip${tab === "resources" ? " on" : ""}`}
                  onClick={() => setTab("resources")}
                >
                  资源 {resources.length}
                </button>
              )}
              {prompts.length > 0 && (
                <button
                  className={`opt-chip${tab === "prompts" ? " on" : ""}`}
                  onClick={() => setTab("prompts")}
                >
                  提示 {prompts.length}
                </button>
              )}
            </div>
            {tab === "tools" && tools.length > 8 && (
              <input
                className="input input-sm"
                value={toolQ}
                onChange={(e) => setToolQ(e.target.value)}
                placeholder="筛选工具名称或描述"
                spellCheck={false}
              />
            )}
            <div className="mcp-nav">
              {tab === "tools" &&
                (filteredTools?.length ? (
                  filteredTools.map((t) => (
                    <button
                      className={`mcp-item${sel?.name === t.name ? " sel" : ""}`}
                      key={t.name}
                      onClick={() => pickTool(t)}
                      title={t.description ?? ""}
                    >
                      <span className="mcp-item-name">{t.name}</span>
                      <span className="mcp-item-desc">{t.description || "（无描述）"}</span>
                    </button>
                  ))
                ) : (
                  <div className="mcp-nav-empty hint">
                    {tools.length === 0 ? "服务器没有暴露任何工具" : "没有匹配的工具"}
                  </div>
                ))}
              {tab === "resources" &&
                (resources.length ? (
                  resources.map((r) => (
                    <div className="mcp-item static" key={r.uri} title={r.uri}>
                      <span className="mcp-item-name">{r.name ?? r.uri}</span>
                      <span className="mcp-item-desc">
                        {r.mime_type ? `${r.mime_type} · ` : ""}
                        {r.uri}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="mcp-nav-empty hint">服务器没有暴露资源</div>
                ))}
              {tab === "prompts" &&
                (prompts.length ? (
                  prompts.map((p) => (
                    <div className="mcp-item static" key={p.name}>
                      <span className="mcp-item-name">{p.name}</span>
                      <span className="mcp-item-desc">{p.description || "（无描述）"}</span>
                    </div>
                  ))
                ) : (
                  <div className="mcp-nav-empty hint">服务器没有暴露提示模板</div>
                ))}
            </div>
          </aside>

          {/* 右侧:调用工作台(顶部工具条常驻,内容区滚动) */}
          <section className="mcp-bench">
            {sel ? (
              <>
                <header className="mcp-bench-head">
                  <div className="mcp-bench-title">
                    <span className="mcp-bench-name">{sel.name}</span>
                    {sel.description && <span className="mcp-bench-desc">{sel.description}</span>}
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={call} disabled={calling}>
                    {calling ? "调用中…" : "发送调用"}
                  </button>
                </header>
                <div className="mcp-bench-body">
                  <span className="mcp-sec-label">参数</span>
                  <textarea
                    className="textarea input-mono"
                    style={{ height: 150 }}
                    value={args}
                    onChange={(e) => setArgs(e.target.value)}
                    placeholder="工具参数 JSON"
                    spellCheck={false}
                  />
                  <details className="mcp-schema">
                    <summary>参数 Schema</summary>
                    <pre>{schemaText || "（无）"}</pre>
                  </details>
                  {result && (
                    <>
                      <div className="mcp-sec-row">
                        <span className="mcp-sec-label">结果</span>
                        <span className={`jwt-chip ${result.is_error ? "expired" : "valid"}`}>
                          {result.is_error ? "失败" : "成功"} · {result.elapsed_ms} ms
                        </span>
                        <span style={{ flex: 1 }} />
                        <button className="btn-text" onClick={() => setShowRaw((v) => !v)}>
                          {showRaw ? "查看文本" : "查看原始 JSON"}
                        </button>
                        <CopyButton
                          text={showRaw ? JSON.stringify(result.raw, null, 2) : result.text}
                          label="复制结果"
                        />
                      </div>
                      <div className="mcp-result">
                        <pre>
                          {showRaw
                            ? JSON.stringify(result.raw, null, 2)
                            : result.text || "（无文本内容）"}
                        </pre>
                      </div>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="mcp-bench-empty">
                <div className="empty-state">
                  <div className="empty-title">在左侧选一个工具</div>
                  <div className="hint">点中条目后，参数模板会填到这里，发送后结果显示在下方</div>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {info && (
        <div className="tool-actions">
          <button
            className="btn btn-sm"
            onClick={() => {
              refreshLog();
              setLogOpen(true);
            }}
          >
            JSON-RPC 日志
          </button>
          <span className="hint">排查协议问题时查看原始收发帧，低频功能</span>
        </div>
      )}

      {logOpen && (
        <div className="modal-mask open" onClick={() => setLogOpen(false)}>
          <div className="mcp-log-modal" onClick={(e) => e.stopPropagation()}>
            <div className="qr-modal-title">JSON-RPC 收发日志{log.length ? `（${log.length} 条）` : ""}</div>
            <pre className="mcp-log-pre">
              {log.length ? log.map(fmtLogLine).join("\n\n") : "暂无记录"}
            </pre>
            <div className="tool-actions">
              <CopyButton text={log.join("\n")} label="复制全部" />
              <button className="btn btn-sm" onClick={refreshLog}>
                刷新
              </button>
              <button className="btn btn-sm" onClick={() => setLogOpen(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="hint">
        本地命令传输支持带引号的启动命令，断开或退出应用时自动结束子进程；远程使用 Streamable HTTP（2025-06-18 规范），需要鉴权时添加请求头；连接成功的服务器会自动记住，下次一键填入
      </div>
    </div>
  );
}
