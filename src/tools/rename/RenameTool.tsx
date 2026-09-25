import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { showConfirm } from "../../components/ConfirmDialog";
import { showToast } from "../../components/Toast";
import { DEFAULT_RULE, buildPlans, type RenameRule } from "../../lib/rename";
import { fmtBytes } from "../../lib/format";

interface DirFile {
  name: string;
  mtime_secs: number;
  size: number;
}

interface ApplyResult {
  from: string;
  ok: boolean;
  err: string;
}

export default function RenameTool() {
  const [dir, setDir] = useState("");
  const [files, setFiles] = useState<DirFile[] | null>(null);
  const [rule, setRule] = useState<RenameRule>(DEFAULT_RULE);
  const [results, setResults] = useState<ApplyResult[] | null>(null);
  const [applying, setApplying] = useState(false);

  const plans = useMemo(
    () => (files ? buildPlans(files.map((f) => ({ name: f.name, mtimeSec: f.mtime_secs })), rule) : []),
    [files, rule],
  );
  const changeCount = plans.filter((p) => p.from !== p.to).length;
  const errCount = plans.filter((p) => p.err).length;

  useEffect(() => {
    if (!dir) return;
    setResults(null);
    invoke<DirFile[]>("rename_list_dir", { dir })
      .then(setFiles)
      .catch((e) => {
        setFiles(null);
        showToast(String(e), "error", 5000);
      });
  }, [dir]);

  async function pickDir() {
    const picked = await open({ title: "选择要批量重命名的文件夹", multiple: false, directory: true });
    if (typeof picked === "string" && picked) setDir(picked);
  }

  function set<K extends keyof RenameRule>(k: K, v: RenameRule[K]) {
    setRule((r) => ({ ...r, [k]: v }));
  }

  async function apply() {
    if (errCount > 0 || changeCount === 0) return;
    const ok = await showConfirm({
      title: "执行批量重命名",
      message: `将重命名 ${changeCount} 个文件，此操作直接改写文件名（不入回收站）。确定执行吗？`,
      confirmLabel: "执行",
    });
    if (!ok) return;
    setApplying(true);
    try {
      const todo = plans.filter((p) => p.from !== p.to).map((p) => [p.from, p.to] as [string, string]);
      const r = await invoke<ApplyResult[]>("rename_apply", { dir, plans: todo });
      setResults(r);
      const failN = r.filter((x) => !x.ok).length;
      showToast(
        failN === 0 ? `已重命名 ${r.length} 个文件` : `完成，${r.length - failN} 成功、${failN} 失败`,
        failN === 0 ? "success" : "info",
        4000,
      );
      invoke<DirFile[]>("rename_list_dir", { dir }).then(setFiles).catch(() => {});
    } catch (e) {
      showToast(String(e), "error", 5000);
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="stack">
      <div className="field rename-flex-none">
        <span className="field-label">目标文件夹</span>
        <div className="rename-row">
          <input
            className="input input-mono rename-dir"
            value={dir}
            onChange={(e) => setDir(e.target.value)}
            placeholder="选择或粘贴文件夹路径"
            spellCheck={false}
          />
          <button className="btn" onClick={pickDir}>
            选择
          </button>
        </div>
        <span className="hint">只处理文件夹里的普通文件，子文件夹不参与</span>
      </div>

      <div className="field rename-flex-none">
        <span className="field-label">改名规则</span>
        <div className="rename-rules">
          <div className="rename-rule">
            <span className="kv-k" style={{ minWidth: 84 }}>查找替换</span>
            <input
              className="input input-sm input-mono"
              style={{ width: 170 }}
              value={rule.find}
              onChange={(e) => set("find", e.target.value)}
              placeholder="查找内容"
              spellCheck={false}
            />
            <span className="kv-k">→</span>
            <input
              className="input input-sm input-mono"
              style={{ width: 130 }}
              value={rule.replace}
              onChange={(e) => set("replace", e.target.value)}
              placeholder="替换为"
              spellCheck={false}
            />
            <label className="kv-k rename-check">
              <input
                type="checkbox"
                checked={rule.useRegex}
                onChange={(e) => set("useRegex", e.target.checked)}
              />
              按正则
            </label>
          </div>
          <div className="rename-rule">
            <span className="kv-k" style={{ minWidth: 84 }}>前后缀</span>
            <input
              className="input input-sm input-mono"
              style={{ width: 130 }}
              value={rule.prefix}
              onChange={(e) => set("prefix", e.target.value)}
              placeholder="前缀"
              spellCheck={false}
            />
            <input
              className="input input-sm input-mono"
              style={{ width: 130 }}
              value={rule.suffix}
              onChange={(e) => set("suffix", e.target.value)}
              placeholder="后缀"
              spellCheck={false}
            />
          </div>
          <div className="rename-rule">
            <span className="kv-k" style={{ minWidth: 84 }}>加序号</span>
            <label className="kv-k rename-check">
              <input
                type="checkbox"
                checked={rule.seqEnabled}
                onChange={(e) => set("seqEnabled", e.target.checked)}
              />
              启用
            </label>
            <span className="kv-k">起始</span>
            <input
              className="input input-sm"
              style={{ width: 56 }}
              type="number"
              min={0}
              value={rule.seqStart}
              onChange={(e) => set("seqStart", Math.max(0, Number(e.target.value) || 0))}
            />
            <span className="kv-k">位数</span>
            <input
              className="input input-sm"
              style={{ width: 56 }}
              type="number"
              min={1}
              max={6}
              value={rule.seqPad}
              onChange={(e) => set("seqPad", Math.min(6, Math.max(1, Number(e.target.value) || 3)))}
            />
            <span className="kv-k">连接符</span>
            <input
              className="input input-sm input-mono"
              style={{ width: 52 }}
              value={rule.seqSep}
              onChange={(e) => set("seqSep", e.target.value)}
              spellCheck={false}
            />
          </div>
          <div className="rename-rule">
            <span className="kv-k" style={{ minWidth: 84 }}>加修改日期</span>
            <label className="kv-k rename-check">
              <input
                type="checkbox"
                checked={rule.dateEnabled}
                onChange={(e) => set("dateEnabled", e.target.checked)}
              />
              在扩展名前插入 yyyyMMdd
            </label>
          </div>
        </div>
      </div>

      {files && (
        <div className="field rename-flex-none">
          <span className="field-label">
            预览（{files.length} 个文件 · {changeCount} 个将改名
            {errCount > 0 ? ` · ${errCount} 个有冲突，需修正后才能执行` : " · 无冲突"}）
            {changeCount > 0 && errCount === 0 && (
              <button className="btn-text" onClick={apply} disabled={applying}>
                {applying ? "执行中…" : "执行重命名"}
              </button>
            )}
          </span>
          <div className="rename-list">
            <div className="rename-head">
              <span>原名字</span>
              <span>新名字</span>
              <span className="rename-size">大小</span>
            </div>
            {plans.map((p) => {
              const changed = p.from !== p.to;
              const res = results?.find((x) => x.from === p.from);
              return (
                <div className="rename-item" key={p.from}>
                  <span className="rename-from" title={p.from}>
                    {p.from}
                  </span>
                  <span
                    className={`rename-to${p.err ? " rename-bad" : changed ? " rename-changed" : ""}`}
                    title={p.err || p.to}
                  >
                    {p.to}
                    {p.err && <em>（{p.err}）</em>}
                    {res && !res.ok && <em>（失败：{res.err}）</em>}
                  </span>
                  <span className="rename-size hint">
                    {fmtBytes(files.find((f) => f.name === p.from)?.size ?? 0)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!files && (
        <div className="empty-state">
          <div className="empty-title">先选一个文件夹</div>
          <div className="hint">规则改动实时预览，确认无误才写盘</div>
        </div>
      )}
    </div>
  );
}
