import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { showToast } from "../../components/Toast";
import { baseName } from "../../lib/format";
import { levelOf } from "../../lib/loglevel";

const MAX_LINES = 5000;

export default function LogTailTool() {
  const [path, setPath] = useState("");
  const [watching, setWatching] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [follow, setFollow] = useState(true);
  const viewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const un = listen<{ lines: string[]; reset: boolean }>("logtail://lines", (e) => {
      const payload = e.payload;
      setLines((prev) => {
        if (payload.reset) return payload.lines;
        const merged = [...prev, ...payload.lines];
        return merged.length > MAX_LINES ? merged.slice(merged.length - MAX_LINES) : merged;
      });
    });
    return () => {
      un.then((fn) => fn());
    };
  }, []);

  async function pick() {
    const sel = await open({
      multiple: false,
      filters: [
        { name: "日志文件", extensions: ["log", "txt", "out", "json"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    if (typeof sel === "string") setPath(sel);
  }

  async function start() {
    if (!path.trim()) {
      showToast("请先选择日志文件", "error", 3000);
      return;
    }
    setLines([]);
    try {
      await invoke("log_tail_start", { path: path.trim() });
      setWatching(true);
    } catch (e) {
      showToast(String(e), "error", 5000);
    }
  }

  async function stop() {
    await invoke("log_tail_stop").catch(() => {});
    setWatching(false);
  }

  // 过滤 + 关键词高亮
  const kw = filter.trim().toLowerCase();
  const shown = useMemo(() => {
    const list = kw ? lines.filter((l) => l.toLowerCase().includes(kw)) : lines;
    return list.slice(-MAX_LINES);
  }, [lines, kw]);

  // 跟随滚动到底部
  useEffect(() => {
    if (follow && viewRef.current) {
      viewRef.current.scrollTop = viewRef.current.scrollHeight;
    }
  }, [shown, follow]);

  function renderLine(line: string, i: number) {
    const lv = levelOf(line);
    const cls =
      lv === "err" ? " log-lv-err" : lv === "warn" ? " log-lv-warn" : lv === "dbg" ? " log-lv-dbg" : "";
    if (!kw) return <div key={i} className={cls}>{line === "" ? "\u00A0" : line}</div>;
    const lower = line.toLowerCase();
    const parts: ReactNode[] = [];
    let pos = 0;
    let idx = lower.indexOf(kw);
    let key = 0;
    while (idx >= 0) {
      if (idx > pos) parts.push(<span key={key++}>{line.slice(pos, idx)}</span>);
      parts.push(
        <mark key={key++} className="re-hit">
          {line.slice(idx, idx + kw.length)}
        </mark>,
      );
      pos = idx + kw.length;
      idx = lower.indexOf(kw, pos);
    }
    if (pos < line.length) parts.push(<span key={key++}>{line.slice(pos)}</span>);
    return <div key={i} className={cls}>{parts.length ? parts : "\u00A0"}</div>;
  }

  return (
    <div className="stack logtail-page">
      <div className="tool-actions">
        <input
          className="input input-mono http-hv"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="选择要监视的日志文件"
          spellCheck={false}
        />
        <button className="btn" onClick={pick}>
          浏览
        </button>
        {watching ? (
          <button className="btn" onClick={stop}>
            停止监视
          </button>
        ) : (
          <button className="btn btn-primary" onClick={start} disabled={!path.trim()}>
            开始监视
          </button>
        )}
        {watching && (
          <span className="jwt-chip valid">监视中 · {baseName(path)}</span>
        )}
        {!watching && lines.length > 0 && (
          <span className="jwt-chip pending">已停止 · 共接收 {lines.length} 行</span>
        )}
      </div>

      <div className="tool-actions">
        <input
          className="input"
          style={{ width: 240 }}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="关键字过滤（区分大小写不敏感）"
          spellCheck={false}
        />
        <button
          className={`opt-chip${follow ? " on" : ""}`}
          onClick={() => setFollow((v) => !v)}
        >
          {follow ? "自动滚动·开" : "自动滚动·关"}
        </button>
        <button className="btn" onClick={() => setLines([])}>
          清屏
        </button>
        {kw && <span className="hint">命中 {shown.length} 行</span>}
      </div>

      <div className="log-view" ref={viewRef}>
        {shown.length === 0 ? (
          <div className="log-empty">
            {watching ? "等待新内容写入…" : "选择日志文件并开始监视，将自动加载末尾内容并持续接收新增行"}
          </div>
        ) : (
          shown.map(renderLine)
        )}
      </div>
      <div className="hint">
        进入时加载文件末尾约 200KB 并持续接收新增行；文件被轮转（清空重建）时自动重新接收；最多保留最近 {MAX_LINES} 行
      </div>
    </div>
  );
}
