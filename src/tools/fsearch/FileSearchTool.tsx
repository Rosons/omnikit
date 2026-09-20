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

interface Snippet {
  snippet: string;
  binary: boolean;
  loading?: boolean;
}

/** 从完整路径取小写扩展名,无扩展名归为一类 */
function extOf(p: string): string {
  const base = p.split(/[\\/]/).pop() ?? p;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "无后缀";
}

export default function FileSearchTool() {
  const [status, setStatus] = useState<SearchStatus | null>(null);
  const [disks, setDisks] = useState<DiskInfo[]>([]);
  const [roots, setRoots] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [results, setResults] = useState<string[] | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [progress, setProgress] = useState<{ files: number; pct: number | null } | null>(null);
  const [extFilter, setExtFilter] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [preview, setPreview] = useState<Map<string, Snippet>>(new Map());
  const rootsTouched = useRef(false);
  const qTimer = useRef<number | undefined>(undefined);

  const fetchSeq = useRef(0);

  async function refreshStatus() {
    const seq = ++fetchSeq.current;
    try {
      const st = await invoke<SearchStatus>("search_status");
      if (seq !== fetchSeq.current) return; // 乱序响应,丢弃
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
    const un = listen<{
      files: number;
      phase?: string;
      estimate?: number;
    }>("idx://progress", (e) => {
      const { files, phase, estimate } = e.payload;
      if (phase === "done" || phase === "stopped") {
        setProgress(null);
      } else if (phase === "scanning") {
        // 有上次索引数作基准:files/estimate 估算百分比(封顶 95%,完成时直接跳 100);
        // 无基准:显示 null,进度条走流动动画
        const pct =
          estimate && estimate > 0
            ? Math.min(95, Math.round((files / estimate) * 100))
            : null;
        setProgress({ files, pct });
      }
      refreshStatus();
    });
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
      setExtFilter(new Set());
      return;
    }
    qTimer.current = window.setTimeout(async () => {
      try {
        const r = await invoke<{ stale: boolean; lines: string[] }>("search_query", {
          q: query,
          limit: 300,
        });
        // stale 表示期间有更新的输入,后端仍在算,此时不动旧结果避免闪烁
        if (!r.stale) {
          setResults(r.lines);
          setExtFilter(new Set());
        }
      } catch (e) {
        showToast(String(e), "error", 5000);
      }
    }, 350);
    return () => window.clearTimeout(qTimer.current);
  }, [query]);

  // 结果里的扩展名分布(取最多的 8 类做快捷筛选)
  const extCounts = useMemo(() => {
    if (!results || results.length === 0) return [];
    const m = new Map<string, number>();
    for (const p of results) {
      const ext = extOf(p);
      m.set(ext, (m.get(ext) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [results]);

  const shownResults = useMemo(() => {
    if (!results || extFilter.size === 0) return results;
    return results.filter((p) => extFilter.has(extOf(p)));
  }, [results, extFilter]);

  function toggleExt(ext: string) {
    setExtFilter((s) => {
      const n = new Set(s);
      if (n.has(ext)) n.delete(ext);
      else n.add(ext);
      return n;
    });
  }

  async function togglePreview(p: string) {
    if (expanded === p) {
      setExpanded(null);
      return;
    }
    setExpanded(p);
    if (!preview.has(p)) {
      setPreview((m) => new Map(m).set(p, { snippet: "", binary: false, loading: true }));
      try {
        const r = await invoke<{ snippet: string; binary: boolean }>("file_snippet", { path: p });
        setPreview((m) => new Map(m).set(p, { snippet: r.snippet, binary: r.binary }));
      } catch {
        setPreview((m) => new Map(m).set(p, { snippet: "", binary: false }));
      }
    }
  }

  function reveal(path: string) {
    invoke("sb_reveal", { path }).catch(() => {});
  }

  const scopeMismatch = useMemo(() => {
    if (!status || status.indexing || status.roots.length === 0) return false;
    if (roots.size !== status.roots.length) return true;
    return [...roots].some((r) => !status.roots.includes(r));
  }, [status, roots]);

  // 索引健康:24 小时以上未重建视为过期,提醒用户重建
  const indexStale =
    status && !status.indexing && status.files > 0 &&
    Date.now() / 1000 - status.last_time > 24 * 3600;

  const needConfig = !status || status.indexing || status.files === 0 || scopeMismatch;
  const configVisible = needConfig || configOpen;

  const statusText = useMemo(() => {
    if (!status) return "";
    const scope = status.roots.length > 0 ? ` · 范围 ${status.roots.join("、")}` : "";
    // 索引中用事件实时计数(status.files 在扫描完成前一直是 0)
    if (status.indexing)
      return `索引中 · ${(progress?.files ?? status.files).toLocaleString()} 个文件`;
    if (status.files > 0)
      return `${status.files.toLocaleString()} 个文件${scope} · 建于 ${fmtTime(status.last_time)}`;
    return "尚未建立索引";
  }, [status, progress]);

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
          {status?.indexing && progress && (
            <div className="idx-progress">
              <div className="idx-bar">
                <div
                  className={progress.pct === null ? " flowing" : ""}
                  style={{ width: progress.pct === null ? "40%" : `${progress.pct}%` }}
                />
              </div>
              <span className="hint idx-count">
                {progress.pct === null
                  ? `${progress.files.toLocaleString()} 个文件`
                  : `${progress.pct}% · ${progress.files.toLocaleString()} 个文件`}
              </span>
            </div>
          )}
        </div>
      )}

      {shownResults && shownResults.length === 0 && (
        <div className="port-empty">
          {extFilter.size > 0
            ? "筛选后没有匹配的文件"
            : `没有匹配的文件${status && status.files === 0 ? "（尚未建立索引）" : ""}`}
        </div>
      )}

      {extCounts.length > 1 && shownResults && (
        <div className="diff-opts">
          {extCounts.map(([ext, n]) => (
            <button
              key={ext}
              className={`opt-chip${extFilter.has(ext) ? " on" : ""}`}
              onClick={() => toggleExt(ext)}
            >
              .{ext} · {n}
            </button>
          ))}
          {extFilter.size > 0 && (
            <button className="btn-text" onClick={() => setExtFilter(new Set())}>
              清除筛选
            </button>
          )}
        </div>
      )}

      {shownResults && shownResults.length > 0 && (
        <div className="kv-list fs-list">
          {shownResults.map((p) => {
            const info = preview.get(p);
            return (
              <div className="fs-item" key={p}>
                <div className="kv-row">
                  <span className="kv-v kv-mono fs-path" title={p}>
                    {p}
                  </span>
                  <CopyButton text={p} label="复制" />
                  <button className="btn-text" onClick={() => reveal(p)}>
                    位置
                  </button>
                  <button className="btn-text" onClick={() => togglePreview(p)}>
                    {expanded === p ? "收起" : "预览"}
                  </button>
                </div>
                {expanded === p && (
                  <div className="fs-preview">
                    {info?.loading
                      ? "读取中…"
                      : info?.binary
                        ? "二进制文件，不支持预览"
                        : info?.snippet || "（空文件或无可显示文本）"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="fs-status">
        {status?.indexing ? (
          <span className="jwt-chip pending">索引中</span>
        ) : !status || status.files === 0 ? (
          <span className="jwt-chip expired">未建立索引</span>
        ) : indexStale ? (
          <span className="jwt-chip pending">索引已过期 · 建议重建</span>
        ) : (
          <span className="jwt-chip valid">索引正常</span>
        )}
        <span className="hint">{statusText}</span>
        {shownResults && (
          <span className="hint">
            {extFilter.size > 0
              ? `命中 ${results?.length ?? 0} 条 · 筛选显示 ${shownResults.length} 条`
              : shownResults.length >= 300
                ? "命中 300+ 条（仅显示前 300）"
                : `命中 ${shownResults.length} 条`}
          </span>
        )}
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
