import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { showToast } from "../../components/Toast";

interface PortRow {
  proto: string;
  address: string;
  port: number;
  pid: number;
  process: string;
}

export default function PortTool() {
  const [rows, setRows] = useState<PortRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");

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

  const filtered = useMemo(() => {
    if (!rows) return null;
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        r.process.toLowerCase().includes(s) ||
        r.address.toLowerCase().includes(s) ||
        String(r.port) === s ||
        String(r.pid) === s,
    );
  }, [rows, q]);

  async function kill(r: PortRow) {
    const ok = await confirm(
      `确定结束进程「${r.process}」（PID ${r.pid}）？该进程会被立即强制关闭。`,
      { title: "结束进程", kind: "warning" },
    );
    if (!ok) return;
    try {
      await invoke("net_kill", { pid: r.pid });
      showToast(`已结束 ${r.process}`, "success");
    } catch (e) {
      showToast(String(e), "error", 5000);
    }
    refresh();
  }

  return (
    <div className="stack">
      <div className="tool-actions">
        <input
          className="input"
          style={{ width: 280 }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="输入端口号、PID 或进程名过滤"
          spellCheck={false}
        />
        <button className="btn" onClick={refresh} disabled={loading}>
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
            <span className="port-name" title={r.process}>
              {r.process}
            </span>
            <button
              className="btn-text port-kill"
              onClick={() => kill(r)}
              disabled={r.pid === 0}
              title={r.pid === 0 ? "系统进程，无法结束" : "结束该进程"}
            >
              结束
            </button>
          </div>
        ))}
      </div>
      <div className="hint">仅列出本机监听中的 TCP 端口与 UDP 绑定；结束系统关键进程可能导致异常，请谨慎操作</div>
    </div>
  );
}
