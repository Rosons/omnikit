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
  roots: string[];
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
  const [configOpen, setConfigOpen] = useState(false);
  const rootsTouched = useRef(false);
  const qTimer = useRef<number | undefined>(undefined);

  async function refreshStatus() {
    try {
      const st = await invoke<SearchStatus>("search_status");
      setStatus(st);
      // 首次加载:自动勾选上次索引的范围
      if (!rootsTouched.current && st.roots.length > 0 && !st.indexing) {
        setRoots(new Set(st.roots));
      }
    } catch {
      /* 忽略 */
    }
  }

  useEffect(() => {
    refreshStatus();
    invoke<{ disks: DiskInfo[] }>("sys_overview")
      .then((r) => setDisks(r.disks))
      .catch(() => {});
    invoke("search_cache_load").catch(() => {});
    const un = listen<{ files: number }>("idx://progress", () => refreshStatus());
    return () => {
      un.then((fn) => fn());
    };
  }, []);

  function toggleRoot(m: string) {
    rootsTouched.current = true;
    setRoots((s) => {
      const n = new Set(s);
      if (n.has(m)) n.delete(m);
      else n.add(m);
      return n;
    });
  }

  async function startIndexing() {
    rootsTouched.current = true;
    try {
      await invoke("search_start", { roots: [...roots] });
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
        const r = await invoke<{ stale: boolean; lines: string[] }>("search_query", {
          q: query,
          limit: 300,
        });
        // stale 表示期间有更新的输入,后端仍在算,此时不动旧结果避免闪烁
        if (!r.stale) setResults(r.lines);
      } catch (e) {
        showToast(String(e), "error", 5000);
      }
    }, 350);
    return () => window.clearTimeout(qTimer.current);
  }, [query]);

  function reveal(path: string) {
    invoke("sb_reveal", { path }).catch(() => {});
  }

  const scopeMismatch = useMemo(() => {
    if (!status || status.indexing || status.roots.length === 0) return false;
    if (roots.size !== status.roots.length) return true;
    return [...roots].some((r) => !status.roots.includes(r));
  }, [status, roots]);

  const needConfig = !status || status.indexing || status.files === 0 || scopeMismatch;
  const configVisible = needConfig || configOpen;

  const statusText = useMemo(() => {
    if (!status) return "";
    const scope = status.roots.length > 0 ? ` · 范围 ${status.roots.join("、")}` : "";
    if (status.indexing) return `索引中 · ${status.files.toLocaleString()} 个文件`;
    if (status.files > 0)
      return `${status.files.toLocaleString()} 个文件${scope} · 建于 ${fmtTime(status.last_time)}`;
    return "尚未建立索引";
  }, [status]);

  return (
    <div className="stack fsearch-page">
      <input
        className="input fs-input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜索全部文件，空格分隔多个关键字，支持 * ? 通配符"
        spellCheck={false}
      />

      {configVisible && (
        <div className="field fs-config">
          {scopeMismatch && !status?.indexing && (
            <span className="hint hint-error">勾选范围与已建索引不同，重建后新范围才生效</span>
          )}
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
              <button className="btn btn-sm" onClick={stopIndexing}>
                取消索引
              </button>
            ) : (
              <button
                className="btn btn-primary btn-sm"
                onClick={startIndexing}
                disabled={roots.size === 0}
              >
                开始索引
              </button>
            )}
            {!needConfig && (
              <button className="btn-text" onClick={() => setConfigOpen(false)}>
                收起
              </button>
            )}
          </div>
        </div>
      )}

      {results && results.length === 0 && (
        <div className="port-empty">
          没有匹配的文件{status && status.files === 0 ? "（尚未建立索引）" : ""}
        </div>
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

      <div className="fs-status">
        <span className="hint">{statusText}</span>
        <div style={{ flex: 1 }} />
        {status && status.files > 0 && !status.indexing && !configVisible && (
          <button className="btn-text" onClick={() => setConfigOpen(true)}>
            重建索引
          </button>
        )}
      </div>
    </div>
  );
}
