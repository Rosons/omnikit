import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { showToast } from "../../components/Toast";
import { fmtTime } from "../../lib/format";

interface LanDevice {
  ip: string;
  hostname: string;
  ports: number[];
  guess: string;
}

/** 已知类型的展示色板:普通设备灰、电脑蓝、存储/打印绿 */
function guessClass(g: string): string {
  if (g.includes("Windows") || g.includes("Apple")) return " lan-guess-dev";
  if (g.includes("NAS") || g.includes("打印") || g.includes("服务器")) return " lan-guess-svc";
  return "";
}

export default function LanTool() {
  const [cidr, setCidr] = useState("");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const [devices, setDevices] = useState<LanDevice[]>([]);
  const [ended, setEnded] = useState<string>("");
  const scannedRef = useRef(false);

  useEffect(() => {
    // 首次进入取本机 IP,末段换 0 当默认网段
    invoke<string>("lan_local_ip")
      .then((ip) => {
        const i = ip.lastIndexOf(".");
        if (i > 0) setCidr(`${ip.slice(0, i + 1)}0/24`);
      })
      .catch(() => {});
    const unDev = listen<LanDevice>("lan://device", (e) => {
      setDevices((prev) => [...prev, e.payload]);
    });
    const unProg = listen<[number, number]>("lan://progress", (e) => {
      setProgress(e.payload);
    });
    const unDone = listen<number>("lan://done", (n) => {
      setScanning(false);
      setEnded(`扫描完成，共发现 ${n} 台设备（${fmtTime(Date.now())}）`);
    });
    return () => {
      unDev.then((fn) => fn());
      unProg.then((fn) => fn());
      unDone.then((fn) => fn());
    };
  }, []);

  async function start() {
    if (scanning) return;
    setDevices([]);
    setEnded("");
    setProgress([0, 0]);
    scannedRef.current = true;
    setScanning(true);
    try {
      await invoke("lan_probe_start", { cidr: cidr.trim() });
    } catch (e) {
      setScanning(false);
      showToast(String(e), "error", 5000);
    }
  }

  async function stop() {
    try {
      await invoke("lan_probe_stop");
    } catch (e) {
      showToast(String(e), "error");
    }
  }

  function copyIp(ip: string) {
    navigator.clipboard
      .writeText(ip)
      .then(() => showToast(`已复制 ${ip}`, "success", 2000))
      .catch(() => {});
  }

  const pct = progress[1] > 0 ? Math.round((progress[0] / progress[1]) * 100) : 0;

  return (
    <div className="stack">
      <div className="field lan-flex-none">
        <span className="field-label">扫描网段</span>
        <div className="lan-row">
          <input
            className="input input-mono"
            style={{ width: 200 }}
            value={cidr}
            onChange={(e) => setCidr(e.target.value)}
            placeholder="如 192.168.1.0/24"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !scanning) start();
            }}
          />
          {scanning ? (
            <button className="btn" onClick={stop}>
              停止
            </button>
          ) : (
            <button className="btn btn-primary" onClick={start} disabled={!cidr.trim()}>
              开始扫描
            </button>
          )}
          <span className="hint">
            全程只发 TCP 探测包到本机网段，不做任何登录或注入，结果不落盘
          </span>
        </div>
      </div>

      {scanning && (
        <div className="idx-progress lan-flex-none">
          <div className="idx-bar">
            <div style={{ width: `${pct}%` }} />
          </div>
          <span className="hint">
            {progress[0]} / {progress[1] || "…"} · 已发现 {devices.length} 台
          </span>
        </div>
      )}
      {ended && <span className="hint lan-flex-none">{ended}</span>}

      {devices.length > 0 && (
        <div className="kv-list">
          {devices.map((d) => (
            <div className="kv-row" key={d.ip}>
              <span className="kv-k kv-mono" style={{ minWidth: 130 }}>
                {d.ip}
              </span>
              <span className="clip-text" title={d.hostname}>
                {d.hostname || "—"}
              </span>
              <span className="lan-ports">
                {d.ports.map((p) => (
                  <span className="lan-port" key={p}>
                    {p}
                  </span>
                ))}
              </span>
              <span className={`lan-guess${guessClass(d.guess)}`}>{d.guess}</span>
              <button className="btn-text" onClick={() => copyIp(d.ip)}>
                复制 IP
              </button>
            </div>
          ))}
        </div>
      )}

      {devices.length === 0 && !scanning && scannedRef.current && (
        <div className="empty-state">
          <div className="empty-title">没有发现设备</div>
          <div className="hint">网段可能不对，确认本机 IP 所在网段后再试</div>
        </div>
      )}
    </div>
  );
}
