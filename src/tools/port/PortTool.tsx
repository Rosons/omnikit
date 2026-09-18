import { Fragment, useEffect, useMemo, useState, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
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
  const [rows, setRows] = useState<PortRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [proto, setProto] = useState<"all" | "TCP" | "UDP">("all");

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

  async function kill(r: PortRow, e: MouseEvent) {
    e.stopPropagation();
    const ok = await confirm(
      `确定结束进程「${r.name}」（PID ${r.pid}）？该进程会被立即强制关闭。`,
      { title: "结束进程", kind: "warning" },
    );
    if (!ok) return;
    try {
      await invoke("net_kill", { pid: r.pid });
      showToast(`已结束 ${r.name}`, "success");
    } catch (err) {
      showToast(String(err), "error", 5000);
    }
    refresh();
  }

  function reveal(path: string, e: MouseEvent) {
    e.stopPropagation();
    invoke("sb_reveal", { path }).catch(() => {});
  }

  return (
    <div className="stack">
      <div className="tool-actions">
        <input
          className="input"
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
          filtered.map((r, i) => {
            const key = `${r.proto}-${r.address}-${r.pid}-${i}`;
            const open = openKey === key;
            return (
              <Fragment key={key}>
                <div
                  className={`port-row${open ? " open" : ""}`}
                  onClick={() => setOpenKey(open ? null : key)}
                >
                  <span className={`port-proto ${r.proto.toLowerCase()}`}>{r.proto}</span>
                  <span className="port-addr" title={r.address}>
                    {r.address}:{r.port}
                  </span>
                  <span className="port-pid">{r.pid}</span>
                  <span className="port-name" title={r.name}>
                    {r.name}
                  </span>
                  <button
                    className="btn-text port-kill"
                    onClick={(e) => kill(r, e)}
                    disabled={r.pid === 0}
                    title={r.pid === 0 ? "系统进程，无法结束" : "结束该进程"}
                  >
                    结束
                  </button>
                </div>
                {open && (
                  <div className="port-detail">
                    <div className="kv-row">
                      <span className="kv-k">进程</span>
                      <span className="kv-v">
                        {r.name}（PID {r.pid}）
                      </span>
                    </div>
                    <div className="kv-row">
                      <span className="kv-k">路径</span>
                      <span className="kv-v kv-mono">
                        {r.path ?? "（不可获取，常见于系统进程）"}
                      </span>
                    </div>
                    {r.cmd && (
                      <div className="kv-row">
                        <span className="kv-k">命令行</span>
                        <span className="kv-v kv-mono">{r.cmd}</span>
                      </div>
                    )}
                    <div className="kv-row">
                      <span className="kv-k">启动时间</span>
                      <span className="kv-v">{r.start ? fmtTime(r.start) : "未知"}</span>
                    </div>
                    <div className="kv-row">
                      <span className="kv-k">内存占用</span>
                      <span className="kv-v">{fmtBytes(r.mem)}</span>
                    </div>
                    {r.path && (
                      <div className="kv-row">
                        <span className="kv-k">操作</span>
                        <button className="btn-text" onClick={(e) => reveal(r.path!, e)}>
                          打开所在文件夹
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </Fragment>
            );
          })}
      </div>
      <div className="hint">点击行查看进程详情；仅列出监听中的 TCP 端口与 UDP 绑定，结束系统关键进程请谨慎</div>
    </div>
  );
}
