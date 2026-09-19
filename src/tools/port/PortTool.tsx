import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { showConfirm } from "../../components/ConfirmDialog";
import { showToast } from "../../components/Toast";
import { fmtBytes, fmtTime } from "../../lib/format";

interface PortRow {
  proto: string;
  address: string;
  port: number;
  pid: number;
  name: string;
  path: string | null;
  cmd: string | null;
  mem: number;
  start: number;
}

export default function PortTool() {
  const [tab, setTab] = useState<"listen" | "probe">("listen");
  return (
    <div className="stack port-page">
      <div className="seg seg-sm" role="tablist">
        <button
          className={`seg-btn${tab === "listen" ? " active" : ""}`}
          onClick={() => setTab("listen")}
        >
          端口监听
        </button>
        <button
          className={`seg-btn${tab === "probe" ? " active" : ""}`}
          onClick={() => setTab("probe")}
        >
          连通测试
        </button>
      </div>
      {tab === "listen" ? <ListenView /> : <ProbeView />}
    </div>
  );
}

interface TcpProbe {
  ok: boolean;
  elapsed_ms: number;
  error: string | null;
  addr: string;
}

function ProbeView() {
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("80");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<TcpProbe | null>(null);

  async function test() {
    const p = parseInt(port, 10);
    if (!host.trim() || !Number.isInteger(p) || p < 1 || p > 65535) {
      showToast("请输入有效的主机与端口（1-65535）", "error", 3000);
      return;
    }
    setBusy(true);
    setRes(null);
    try {
      setRes(await invoke<TcpProbe>("net_probe_tcp", { host: host.trim(), port: p }));
    } catch (e) {
      showToast(String(e), "error", 5000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="field">
        <span className="field-label">目标地址与端口（TCP 连接测试，超时 3 秒）</span>
        <div className="probe-row">
          <input
            className="input input-sm input-mono"
            style={{ flex: 1 }}
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="主机名或 IP"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === "Enter") test();
            }}
          />
          <span className="probe-colon">:</span>
          <input
            className="input input-sm input-mono"
            style={{ width: 100 }}
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="端口"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === "Enter") test();
            }}
          />
          <button className="btn btn-primary btn-sm" onClick={test} disabled={busy}>
            {busy ? "测试中…" : "测试"}
          </button>
        </div>
      </div>
      {res && (
        <div className="kv-list">
          <div className="kv-row">
            <span className="kv-k">结果</span>
            {res.ok ? (
              <span className="jwt-chip valid">可连接 · 耗时 {res.elapsed_ms} ms</span>
            ) : (
              <span className="jwt-chip expired">
                连接失败{res.error ? `：${res.error}` : ""}
              </span>
            )}
          </div>
          <div className="kv-row">
            <span className="kv-k">实际地址</span>
            <span className="kv-v kv-mono">{res.addr || "-"}</span>
          </div>
        </div>
      )}
      <div className="hint">用于快速验证某个服务的端口是否可达，例如数据库、消息队列、代理</div>
    </div>
  );
}

function ListenView() {
  const [rows, setRows] = useState<PortRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [proto, setProto] = useState<"all" | "TCP" | "UDP">("all");
  const [detail, setDetail] = useState<PortRow | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const r = await invoke<PortRow[]>("net_list_ports");
      setRows(r);
    } catch (e) {
      showToast(String(e), "error", 5000);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc 关闭详情弹窗
  useEffect(() => {
    if (!detail) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setDetail(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const s = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (proto === "all" || r.proto === proto) &&
        (!s ||
          r.name.toLowerCase().includes(s) ||
          r.address.toLowerCase().includes(s) ||
          String(r.port) === s ||
          String(r.pid) === s),
    );
  }, [rows, q, proto]);

  async function kill(r: PortRow) {
    const ok = await showConfirm({
      title: "结束进程",
      message: `确定结束进程「${r.name}」（PID ${r.pid}）？该进程会被立即强制关闭。`,
      confirmLabel: "结束进程",
      danger: true,
    });
    if (!ok) return;
    try {
      await invoke("net_kill", { pid: r.pid });
      showToast(`已结束 ${r.name}`, "success");
    } catch (e) {
      showToast(String(e), "error", 5000);
    }
    refresh();
  }

  function reveal(path: string, e: MouseEvent) {
    e.stopPropagation();
    invoke("sb_reveal", { path }).catch(() => {});
  }

  return (
    <div className="stack listen-page">
      <div className="tool-actions">
        <input
          className="input input-sm"
          style={{ width: 240 }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="输入端口号、PID 或进程名过滤"
          spellCheck={false}
        />
        <div className="diff-opts">
          {(["all", "TCP", "UDP"] as const).map((p) => (
            <button
              key={p}
              className={`opt-chip${proto === p ? " on" : ""}`}
              onClick={() => setProto(p)}
            >
              {p === "all" ? "全部" : p}
            </button>
          ))}
        </div>
        <button className="btn btn-chip" onClick={refresh} disabled={loading}>
          {loading ? "查询中…" : "刷新"}
        </button>
        {rows && !loading && (
          <span className="hint">
            {filtered && filtered.length === rows.length
              ? `共 ${rows.length} 个监听端口`
              : `匹配 ${filtered ? filtered.length : 0} / ${rows.length} 个`}
          </span>
        )}
      </div>

      <div className="port-table">
        <div className="port-head">
          <span>协议</span>
          <span>本地地址</span>
          <span>PID</span>
          <span>进程</span>
          <span>操作</span>
        </div>
        <div className="port-list">
          {loading && !rows && (
            <div className="loading">
              <div className="spinner" />
            </div>
          )}
          {rows && filtered && filtered.length === 0 && (
            <div className="port-empty">没有匹配的端口</div>
          )}
          {filtered &&
            filtered.map((r, i) => (
              <div className="port-row" key={`${r.proto}-${r.address}-${r.pid}-${i}`}>
                <span className={`port-proto ${r.proto.toLowerCase()}`}>{r.proto}</span>
                <span className="port-addr" title={r.address}>
                  {r.address}:{r.port}
                </span>
                <span className="port-pid">{r.pid}</span>
                <span className="port-name" title={r.name}>
                  {r.name}
                </span>
                <span className="port-actions">
                  <button className="btn-text port-more" onClick={() => setDetail(r)}>
                    详情
                  </button>
                  <button
                    className="btn-text port-kill"
                    onClick={() => kill(r)}
                    disabled={r.pid === 0}
                    title={r.pid === 0 ? "系统进程，无法结束" : "结束该进程"}
                  >
                    结束
                  </button>
                </span>
              </div>
            ))}
        </div>
      </div>
      <div className="hint">点「详情」查看进程路径等信息；仅列出监听中的 TCP 端口与 UDP 绑定，结束系统关键进程请谨慎</div>

      <div className={`modal-mask${detail ? " open" : ""}`} onClick={() => setDetail(null)}>
        <div className="qr-modal port-modal" onClick={(e) => e.stopPropagation()}>
          <div className="qr-modal-title">进程详情</div>
          {detail && (
            <div className="kv-list" style={{ width: "100%" }}>
              <div className="kv-row">
                <span className="kv-k">进程</span>
                <span className="kv-v">
                  {detail.name}（PID {detail.pid}）
                </span>
              </div>
              <div className="kv-row">
                <span className="kv-k">路径</span>
                <span className="kv-v kv-mono">
                  {detail.path ?? "（不可获取，常见于系统进程）"}
                </span>
              </div>
              {detail.cmd && (
                <div className="kv-row">
                  <span className="kv-k">命令行</span>
                  <span className="kv-v kv-mono">{detail.cmd}</span>
                </div>
              )}
              <div className="kv-row">
                <span className="kv-k">启动时间</span>
                <span className="kv-v">{detail.start ? fmtTime(detail.start) : "未知"}</span>
              </div>
              <div className="kv-row">
                <span className="kv-k">内存占用</span>
                <span className="kv-v">{fmtBytes(detail.mem)}</span>
              </div>
            </div>
          )}
          <div className="tool-actions">
            {detail?.path && (
              <button className="btn btn-sm" onClick={(e) => reveal(detail.path!, e)}>
                打开所在文件夹
              </button>
            )}
            <button className="btn btn-sm" onClick={() => setDetail(null)}>
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
