import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { showToast } from "../../components/Toast";
import { fmtBytes } from "../../lib/format";

interface SysDisk {
  mount: string;
  total: number;
  available: number;
}
interface SysOverview {
  cpu_usage: number;
  cores: number[];
  mem_total: number;
  mem_used: number;
  disks: SysDisk[];
  os_name: string;
  uptime_secs: number;
  process_count: number;
}

function fmtUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d} 天 ${h} 小时`;
  if (h > 0) return `${h} 小时 ${m} 分`;
  return `${m} 分`;
}

export default function MonitorTool() {
  const [info, setInfo] = useState<SysOverview | null>(null);

  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const r = await invoke<SysOverview>("sys_overview");
        if (!stopped) setInfo(r);
      } catch (e) {
        if (!stopped) showToast(String(e), "error", 5000);
        stopped = true;
      }
    }
    poll();
    const timer = setInterval(poll, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  if (!info) {
    return (
      <div className="loading">
        <div className="spinner" />
      </div>
    );
  }

  const memPct = info.mem_total > 0 ? (info.mem_used / info.mem_total) * 100 : 0;
  const cpuPct = Math.min(100, info.cpu_usage);

  return (
    <div className="stack">
      <div className="mon-grid">
        <div className="mon-card">
          <div className="mon-label">CPU 使用率</div>
          <div className="mon-big">{cpuPct.toFixed(1)}<span className="mon-unit">%</span></div>
          <div className="mon-bar">
            <div style={{ width: `${cpuPct}%` }} />
          </div>
          <div className="mon-sub">{info.cores.length} 个逻辑核心</div>
          <div className="mon-cores">
            {info.cores.map((c, i) => (
              <div className="mon-core" key={i} title={`核心 ${i + 1}：${c.toFixed(0)}%`}>
                <div className="mon-core-bar">
                  <div style={{ height: `${Math.min(100, c)}%` }} />
                </div>
                <span>{Math.round(c)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="mon-card">
          <div className="mon-label">内存使用</div>
          <div className="mon-big">{memPct.toFixed(1)}<span className="mon-unit">%</span></div>
          <div className="mon-bar">
            <div style={{ width: `${memPct}%` }} />
          </div>
          <div className="mon-sub">
            {fmtBytes(info.mem_used)} / {fmtBytes(info.mem_total)} · {info.process_count} 个进程
          </div>
        </div>
      </div>

      <div className="field">
        <span className="field-label">磁盘空间</span>
        <div className="kv-list">
          {info.disks.map((d) => {
            const usedPct = d.total > 0 ? ((d.total - d.available) / d.total) * 100 : 0;
            return (
              <div className="kv-row" key={d.mount}>
                <span className="kv-k mon-mount">{d.mount}</span>
                <div className="mon-disk-bar">
                  <div
                    style={{ width: `${usedPct}%` }}
                    className={usedPct > 90 ? " hot" : ""}
                  />
                </div>
                <span className="kv-v">
                  剩余 {fmtBytes(d.available)} / {fmtBytes(d.total)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="kv-list">
        <div className="kv-row">
          <span className="kv-k">操作系统</span>
          <span className="kv-v">{info.os_name || "未知"}</span>
        </div>
        <div className="kv-row">
          <span className="kv-k">已运行</span>
          <span className="kv-v">{fmtUptime(info.uptime_secs)}</span>
        </div>
      </div>
      <div className="hint">每 2 秒自动刷新；磁盘使用超过 90% 时进度条变红</div>
    </div>
  );
}
