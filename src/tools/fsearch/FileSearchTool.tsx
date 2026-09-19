import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { showToast } from "../../components/Toast";
import CopyButton from "../../components/CopyButton";
import { fmtTime } from "../../lib/format";

interface SearchStatus {
  indexing: boolean;
  files: number;
  last_time: number;
}

interface DiskInfo {
  mount: string;
  total: number;
  available: number;
}

export default function FileSearchTool() {
  const [status, setStatus] = useState<SearchStatus | null>(null);
  const [disks, setDisks] = useState<DiskInfo[]>([]);
  const [roots, setRoots] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [results, setResults] = useState<string[] | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const qTimer = useRef<number | undefined>(undefined);

  async function refreshStatus() {
    try {
      setStatus(await invoke<SearchStatus>("search_status"));
    } catch {
      /* 忽略 */
    }
  }

  useEffect(() => {
    refreshStatus();
    // 磁盘列表
    invoke<{ disks: DiskInfo[] }>("sys_overview")
      .then((r) => {
        setDisks(r.disks);
        setRoots(new Set(r.disks.map((d) => d.mount)));
      })
      .catch(() => {});
    // 首次进入自动加载上次索引缓存
    invoke("search_cache_load").catch(() => {});
    const un = listen<{ files: number }>("idx://progress", () => refreshStatus());
    return () => {
      un.then((fn) => fn());
    };
  }, []);

  // 索引完成瞬间刷新一次
  useEffect(() => {
    if (status && !status.indexing && status.files > 0 && results === null && q) {
      // 保持现状即可
    }
  }, [status, results, q]);

  function toggleRoot(m: string) {
    setRoots((s) => {
      const n = new Set(s);
      if (n.has(m)) n.delete(m);
      else n.add(m);
      return n;
    });
  }

  async function startIndexing() {
    try {
      await invoke("search_start", {
        roots: [...roots],
      });
      refreshStatus();
    } catch (e) {
      showToast(String(e), "error", 5000);
    }
  }

  async function stopIndexing() {
    await invoke("search_stop").catch(() => {});
    refreshStatus();
  }

  // 搜索防抖
  const query = q.trim();
  useEffect(() => {
    window.clearTimeout(qTimer.current);
    if (!query) {
      setResults(null);
      return;
    }
    qTimer.current = window.setTimeout(async () => {
      try {
        setResults(await invoke<string[]>("search_query", { q: query, limit: 300 }));
      } catch (e) {
        showToast(String(e), "error", 5000);
      }
    }, 200);
    return () => window.clearTimeout(qTimer.current);
  }, [query]);

  function reveal(path: string) {
    invoke("sb_reveal", { path }).catch(() => {});
  }

  const readyText = useMemo(() => {
    if (!status) return "";
    if (status.indexing) return `索引中，已发现 ${status.files.toLocaleString()} 个文件`;
    if (status.files > 0)
      return `索引就绪 · ${status.files.toLocaleString()} 个文件 · 建于 ${fmtTime(status.last_time)}`;
    return "尚未建立索引";
  }, [status]);

  return (
    <div className="stack">
      <div className="field">
        <span className="field-label">
          全盘文件名索引
          <span className="hint">{readyText}</span>
        </span>
        <span className="hint">
          首次索引会遍历整个磁盘（可能需要几分钟），完成后压缩缓存到本机，下次启动自动加载；输入即搜，结果按需截取
        </span>
        <div className="tool-actions">
          <div className="diff-opts">
            {disks.map((d) => (
              <button
                key={d.mount}
                className={`opt-chip${roots.has(d.mount) ? " on" : ""}`}
                onClick={() => toggleRoot(d.mount)}
                disabled={status?.indexing}
              >
                {d.mount}
              </button>
            ))}
          </div>
          {status?.indexing ? (
            <button className="btn" onClick={stopIndexing}>
              取消索引
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={startIndexing}
              disabled={roots.size === 0}
            >
              开始索引
            </button>
          )}
        </div>
        <span className="hint">排除规则（内置 node_modules、回收站等常见项）在「设置」页修改</span>
      </div>

      <div className="field">
        <span className="field-label">
          文件名搜索
          {results && <span className="hint">命中 {results.length} 条（最多显示 300 条）</span>}
        </span>
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="输入文件名或路径的一部分，不区分大小写"
          spellCheck={false}
        />
      </div>

      {results && results.length === 0 && (
        <div className="port-empty">没有匹配的文件；索引未就绪时结果不完整</div>
      )}
      {results && results.length > 0 && (
        <div className="kv-list fs-list">
          {results.map((p) => (
            <div className="kv-row" key={p}>
              <span className="kv-v kv-mono fs-path" title={p}>
                {p}
              </span>
              <CopyButton text={p} label="复制" />
              <button className="btn-text" onClick={() => reveal(p)}>
                位置
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
