import { Fragment, useEffect, useState, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { showConfirm } from "../../components/ConfirmDialog";
import { showToast } from "../../components/Toast";
import { fmtBytes } from "../../lib/format";

const SUBTABS = [
  { id: "dupe", name: "重复文件" },
  { id: "size", name: "大小分析" },
] as const;

type SubTab = (typeof SUBTABS)[number]["id"];

interface DiskFile {
  path: string;
  size: number;
}
interface DupeGroup {
  files: DiskFile[];
  wasted: number;
}
interface DirItem {
  name: string;
  path: string;
  is_dir: boolean;
  bytes: number;
  files: number;
}
interface DirReport {
  total_bytes: number;
  total_files: number;
  items: DirItem[];
  largest: DiskFile[];
}

export default function DiskTool() {
  const [tab, setTab] = useState<SubTab>("dupe");
  return (
    <div>
      <div className="seg seg-sm" role="tablist">
        {SUBTABS.map((t) => (
          <button
            key={t.id}
            className={`seg-btn${tab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.name}
          </button>
        ))}
      </div>
      {tab === "dupe" ? <DupeView /> : <SizeView />}
    </div>
  );
}

function reveal(path: string, e: MouseEvent) {
  e.stopPropagation();
  invoke("sb_reveal", { path }).catch(() => {});
}

/* ---------- 重复文件查找 ---------- */

function DupeView() {
  const [dir, setDir] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [groups, setGroups] = useState<DupeGroup[] | null>(null);

  useEffect(() => {
    const un = listen<{ phase: string; done: number; total: number }>("dup://progress", (e) => {
      const { phase: ph, done, total } = e.payload;
      setPhase(
        ph === "scan"
          ? `扫描中，已发现 ${done} 个文件`
          : ph === "part"
            ? `抽样比对 ${done}/${total}`
            : ph === "hash"
              ? `完整校验 ${done}/${total}`
              : "",
      );
    });
    return () => {
      un.then((fn) => fn());
    };
  }, []);

  async function pick() {
    const sel = await open({ multiple: false, directory: true });
    if (typeof sel === "string") setDir(sel);
  }

  async function start() {
    if (!dir.trim()) {
      showToast("请先选择要查找的文件夹", "error", 3000);
      return;
    }
    setBusy(true);
    setGroups(null);
    try {
      const r = await invoke<DupeGroup[]>("disk_find_dupes", { root: dir.trim() });
      setGroups(r);
    } catch (e) {
      const msg = String(e);
      if (msg !== "已取消") showToast(msg, "error", 5000);
    } finally {
      setBusy(false);
      setPhase("");
    }
  }

  async function trashFile(path: string, groupIdx: number) {
    const ok = await showConfirm({
      title: "删除文件",
      message: `确定把该文件移入回收站？\n${path}`,
      confirmLabel: "移入回收站",
      danger: true,
    });
    if (!ok) return;
    try {
      await invoke("disk_trash", { path });
      setGroups((gs) =>
        gs
          ? gs
              .map((g, i) =>
                i === groupIdx
                  ? { ...g, files: g.files.filter((f) => f.path !== path) }
                  : g,
              )
              .filter((g) => g.files.length > 1)
          : gs,
      );
      showToast("已移入回收站", "success");
    } catch (e) {
      showToast(String(e), "error", 5000);
    }
  }

  async function keepFirst(groupIdx: number) {
    const g = groups?.[groupIdx];
    if (!g) return;
    const ok = await showConfirm({
      title: "批量删除",
      message: `保留第一个文件，其余 ${g.files.length - 1} 个移入回收站？`,
      confirmLabel: "移入回收站",
      danger: true,
    });
    if (!ok) return;
    try {
      for (const f of g.files.slice(1)) {
        await invoke("disk_trash", { path: f.path });
      }
      setGroups((gs) => (gs ? gs.filter((_, i) => i !== groupIdx) : gs));
      showToast(`已移入回收站 ${g.files.length - 1} 个文件`, "success");
    } catch (e) {
      showToast(String(e), "error", 5000);
    }
  }

  const totalWasted = groups ? groups.reduce((a, g) => a + g.wasted, 0) : 0;

  return (
    <div className="stack">
      <div className="tool-actions">
        <input
          className="input input-mono http-hv"
          value={dir}
          onChange={(e) => setDir(e.target.value)}
          placeholder="选择要查找的文件夹"
          spellCheck={false}
        />
        <button className="btn" onClick={pick}>
          浏览
        </button>
        {busy ? (
          <button className="btn" onClick={() => invoke("sb_cancel").catch(() => {})}>
            取消
          </button>
        ) : (
          <button className="btn btn-primary" onClick={start} disabled={!dir.trim()}>
            开始查找
          </button>
        )}
        {!busy && groups && (
          <button className="btn" onClick={() => setGroups(null)}>
            清空
          </button>
        )}
      </div>
      {busy && <div className="hint">{phase || "准备中…"}</div>}
      {!busy && !groups && (
        <div className="empty-state">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="10.5" cy="10.5" r="6.5" stroke="#9aa0ab" strokeWidth="2" />
            <path
              d="M15.5 15.5L20.5 20.5"
              stroke="#9aa0ab"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <div className="empty-title">选择一个文件夹开始查找重复文件</div>
          <div className="hint">
            空文件会忽略；内容完全相同才判定重复（大小 → 抽样 → 完整校验）
            <br />
            删除均移入回收站，结果最多显示 500 组
          </div>
        </div>
      )}
      {groups && (
        <div className="hint hint-ok">
          发现 {groups.length} 组重复文件
          {groups.length > 0 ? `，可释放约 ${fmtBytes(totalWasted)}` : ""}
        </div>
      )}
      {groups && groups.length === 0 && (
        <div className="empty-state">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="10.5" cy="10.5" r="6.5" stroke="#9aa0ab" strokeWidth="2" />
            <path
              d="M15.5 15.5L20.5 20.5"
              stroke="#9aa0ab"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <div className="empty-title">没有发现重复文件</div>
          <div className="hint">该文件夹内没有内容完全相同的文件</div>
        </div>
      )}
      {groups &&
        groups.map((g, gi) => (
          <div className="dupe-group" key={gi}>
            <div className="dupe-head">
              <span className="dupe-title">
                第 {gi + 1} 组 · {g.files.length} 个相同文件
              </span>
              <span className="hint">可释放 {fmtBytes(g.wasted)}</span>
              <button className="btn-text" onClick={() => keepFirst(gi)}>
                保留第一个，其余删除
              </button>
            </div>
            <div className="kv-list">
              {g.files.map((f) => (
                <div className="kv-row" key={f.path}>
                  <span className="kv-v kv-mono dupe-path" title={f.path}>
                    {f.path}
                  </span>
                  <span className="kv-k">{fmtBytes(f.size)}</span>
                  <button className="btn-text" onClick={(e) => reveal(f.path, e)}>
                    位置
                  </button>
                  <button className="btn-text dupe-del" onClick={() => trashFile(f.path, gi)}>
                    删除
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}

/* ---------- 大小分析 ---------- */

function SizeView() {
  const [dir, setDir] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanText, setScanText] = useState("");
  const [report, setReport] = useState<DirReport | null>(null);

  useEffect(() => {
    const un = listen<{ done: number }>("dirsz://progress", (e) =>
      setScanText(`已扫描 ${e.payload.done} 个文件`),
    );
    return () => {
      un.then((fn) => fn());
    };
  }, []);

  async function pick() {
    const sel = await open({ multiple: false, directory: true });
    if (typeof sel === "string") setDir(sel);
  }

  async function scan(target?: string) {
    const root = (target ?? dir).trim();
    if (!root) {
      showToast("请先选择文件夹", "error", 3000);
      return;
    }
    if (target) setDir(target);
    setBusy(true);
    setReport(null);
    try {
      setReport(await invoke<DirReport>("disk_dir_sizes", { root }));
    } catch (e) {
      const m = String(e);
      if (m !== "已取消") showToast(m, "error", 5000);
    } finally {
      setBusy(false);
      setScanText("");
    }
  }

  const maxBytes = report && report.items.length > 0 ? report.items[0].bytes : 1;

  // 面包屑:把当前路径拆成可点击的层级
  const crumbs = (() => {
    const parts = dir.trim().replace(/\//g, "\\").split("\\").filter(Boolean);
    const out: { name: string; path: string }[] = [];
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      if (i === 0) acc = parts[0].endsWith(":") ? parts[0] + "\\" : parts[0];
      else acc = acc.endsWith("\\") ? acc + parts[i] : acc + "\\" + parts[i];
      out.push({ name: i === 0 && parts[0].endsWith(":") ? parts[0] + "\\" : parts[i], path: acc });
    }
    return out;
  })();
  const parentPath = crumbs.length > 1 ? crumbs[crumbs.length - 2].path : null;

  return (
    <div className="stack">
      <div className="tool-actions">
        <input
          className="input input-mono http-hv"
          value={dir}
          onChange={(e) => setDir(e.target.value)}
          placeholder="选择要分析的文件夹"
          spellCheck={false}
        />
        <button className="btn" onClick={pick}>
          浏览
        </button>
        {busy ? (
          <button className="btn" onClick={() => invoke("sb_cancel").catch(() => {})}>
            取消
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => scan()} disabled={!dir.trim()}>
            开始扫描
          </button>
        )}
        {!busy && report && (
          <button className="btn" onClick={() => setReport(null)}>
            清空
          </button>
        )}
      </div>
      {busy && <div className="hint">{scanText || "准备中…"}</div>}
      {!busy && !report && (
        <div className="empty-state">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="9" stroke="#9aa0ab" strokeWidth="2" />
            <path d="M12 3a9 9 0 0 1 9 9h-9z" fill="#9aa0ab" opacity="0.5" />
          </svg>
          <div className="empty-title">选择一个文件夹开始大小分析</div>
          <div className="hint">
            按占用排序列出一级子项（可下钻），并列出目录内最大的文件
          </div>
        </div>
      )}
      {report && (
        <>
          <div className="crumb-bar">
            <button className="btn-text" onClick={() => parentPath && scan(parentPath)} disabled={!parentPath}>
              ↑ 上一级
            </button>
            <div className="crumb-path">
              {crumbs.map((c, i) => (
                <Fragment key={c.path}>
                  {i > 0 && <span className="crumb-sep">›</span>}
                  <span
                    className={`crumb-item${i === crumbs.length - 1 ? " cur" : ""}`}
                    onClick={() => i < crumbs.length - 1 && scan(c.path)}
                  >
                    {c.name}
                  </span>
                </Fragment>
              ))}
            </div>
          </div>
          <div className="hint hint-ok">
            共 {report.total_files} 个文件 · 总计 {fmtBytes(report.total_bytes)}
          </div>
          <div className="field">
            <span className="field-label">一级子项按占用排序（点「进入」下钻子文件夹）</span>
            <div className="kv-list">
              {report.items.map((it) => (
                <div className="kv-row" key={it.path}>
                  <span className={`size-name${it.is_dir ? " is-dir" : ""}`} title={it.name}>
                    {it.name}
                  </span>
                  <div className="size-bar">
                    <div
                      style={{
                        width: `${Math.max(2, Math.round((it.bytes / Math.max(maxBytes, 1)) * 100))}%`,
                      }}
                    />
                  </div>
                  <span className="kv-v">{fmtBytes(it.bytes)}</span>
                  <span className="kv-k">{it.files} 个文件</span>
                  {it.is_dir && (
                    <button className="btn-text" onClick={() => scan(it.path)}>
                      进入
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
          {report.largest.length > 0 && (
            <div className="field">
              <span className="field-label">其中最大的文件</span>
              <div className="kv-list">
                {report.largest.map((f) => (
                  <div className="kv-row" key={f.path}>
                    <span className="kv-v kv-mono dupe-path" title={f.path}>
                      {f.path}
                    </span>
                    <span className="kv-k">{fmtBytes(f.size)}</span>
                    <button className="btn-text" onClick={(e) => reveal(f.path, e)}>
                      位置
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
