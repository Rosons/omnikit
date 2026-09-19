import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { showConfirm } from "../../components/ConfirmDialog";
import { showToast } from "../../components/Toast";
import { fmtBytes, fmtTime } from "../../lib/format";

interface ProcRow {
  pid: number;
  name: string;
  path: string | null;
  cpu: number;
  mem: number;
  start: number;
}

type SortKey = "mem" | "cpu" | "name";

const SORTS: { k: SortKey; label: string }[] = [
  { k: "mem", label: "按内存" },
  { k: "cpu", label: "按 CPU" },
  { k: "name", label: "按名称" },
];

export default function ProcTool() {
  const [rows, setRows] = useState<ProcRow[] | null>(null);
  const [auto, setAuto] = useState(true);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("mem");
  const timer = useRef<number | undefined>(undefined);

  async function refresh() {
    try {
      setRows(await invoke<ProcRow[]>("proc_list"));
    } catch (e) {
      showToast(String(e), "error", 5000);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!auto) return;
    timer.current = window.setInterval(refresh, 3000);
    return () => window.clearInterval(timer.current);
  }, [auto]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const s = q.trim().toLowerCase();
    let list = s
      ? rows.filter(
          (r) =>
            r.name.toLowerCase().includes(s) ||
            String(r.pid) === s ||
            (r.path ?? "").toLowerCase().includes(s),
        )
      : rows;
    list = [...list];
    if (sort === "mem") list.sort((a, b) => b.mem - a.mem);
    else if (sort === "cpu") list.sort((a, b) => b.cpu - a.cpu);
    else list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [rows, q, sort]);

  async function kill(r: ProcRow) {
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

  function reveal(path: string) {
    invoke("sb_reveal", { path }).catch(() => {});
  }

  const totalMem = filtered ? filtered.reduce((a, r) => a + r.mem, 0) : 0;

  return (
    <div className="stack">
      <div className="tool-actions">
        <input
          className="input"
          style={{ width: 240 }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="输入进程名、PID 或路径过滤"
          spellCheck={false}
        />
        <div className="diff-opts">
          {SORTS.map((s) => (
            <button
              key={s.k}
              className={`opt-chip${sort === s.k ? " on" : ""}`}
              onClick={() => setSort(s.k)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button className="btn" onClick={refresh}>
          刷新
        </button>
        <button
          className={`opt-chip${auto ? " on" : ""}`}
          onClick={() => setAuto((v) => !v)}
        >
          {auto ? "自动刷新·开" : "自动刷新·关"}
        </button>
        {filtered && (
          <span className="hint">
            共 {filtered.length} 个进程 · 合计内存 {fmtBytes(totalMem)}
          </span>
        )}
      </div>

      <div className="port-head proc-head">
        <span>进程</span>
        <span>路径</span>
        <span>PID</span>
        <span>CPU</span>
        <span>内存</span>
        <span>操作</span>
      </div>
      <div className="port-list proc-list">
        {!rows && (
          <div className="loading">
            <div className="spinner" />
          </div>
        )}
        {rows && filtered && filtered.length === 0 && (
          <div className="port-empty">没有匹配的进程</div>
        )}
        {filtered &&
          filtered.map((r) => (
            <div className="port-row proc-row" key={`${r.pid}-${r.name}`}>
              <span
                className="proc-name"
                title={`${r.name} · 启动于 ${r.start ? fmtTime(r.start) : "未知"}`}
              >
                {r.name}
              </span>
              <span className="proc-path" title={r.path ?? "路径不可获取"}>
                {r.path ?? "（不可获取）"}
              </span>
              <span className="port-pid">{r.pid}</span>
              <span className={`proc-cpu${r.cpu >= 10 ? " hot" : ""}`}>{r.cpu.toFixed(1)}%</span>
              <span className="proc-mem">{fmtBytes(r.mem)}</span>
              <span className="port-actions">
                {r.path && (
                  <button className="btn-text port-more" onClick={() => reveal(r.path!)}>
                    位置
                  </button>
                )}
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
      <div className="hint">每 3 秒自动刷新（可关）；启动时间可悬停进程名查看；结束进程不可恢复，请谨慎操作</div>
    </div>
  );
}
