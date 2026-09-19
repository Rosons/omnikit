import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { fmtBytes, fmtTime } from "../../lib/format";
import { requestDecrypt } from "../../lib/bus";
import { showToast } from "../../components/Toast";
import { showConfirm } from "../../components/ConfirmDialog";

interface HistoryEntry {
  id: number;
  kind: "encrypt" | "decrypt";
  name: string;
  boxPath: string;
  location: string;
  files: number;
  bytes: number;
  time: number;
}

export default function History() {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);

  useEffect(() => {
    invoke<HistoryEntry[]>("sb_history_list")
      .then(setEntries)
      .catch(() => setEntries([]));
  }, []);

  async function remove(id: number) {
    const entry = entries?.find((e) => e.id === id);
    const ok = await showConfirm({
      title: "删除记录",
      message: entry
        ? `确定删除这条记录吗？\n${entry.name}`
        : "确定删除这条记录吗？",
      confirmLabel: "删除",
      danger: true,
    });
    if (!ok) return;
    try {
      await invoke("sb_history_remove", { id });
      setEntries((es) => es?.filter((e) => e.id !== id) ?? null);
    } catch (e) {
      showToast(String(e), "error");
    }
  }

  async function clearAll() {
    const ok = await showConfirm({
      title: "清空记录",
      message: `确定清空全部 ${count} 条记录吗？`,
      confirmLabel: "清空",
      danger: true,
    });
    if (!ok) return;
    try {
      await invoke("sb_history_clear");
      setEntries([]);
    } catch (e) {
      showToast(String(e), "error");
    }
  }

  function reveal(entry: HistoryEntry) {
    invoke("sb_reveal", { path: entry.kind === "encrypt" ? entry.boxPath : entry.location }).catch(
      (e) => showToast(String(e), "error")
    );
  }

  const count = entries?.length ?? 0;

  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 16 }}>
        <span className="toolbar-hint">
          共 {count} 条记录 · 仅保存在本机{count > 0 && "，删除记录不影响文件本身"}
        </span>
        <div className="toolbar-right">
          {count > 0 && (
            <button className="btn-text" onClick={clearAll}>清空记录</button>
          )}
        </div>
      </div>

      {entries === null ? (
        <div className="table-loading">
          <span className="spinner spinner-s" />
          加载中…
        </div>
      ) : count === 0 ? (
        <div className="empty-state">
          <EmptyIcon />
          还没有记录，去「文件保险箱」完成第一次加密吧
        </div>
      ) : (
        <div className="file-table">
          <div className="file-table-body">
            {entries.map((e) => (
              <div className="his-row" key={e.id}>
                <span className={`his-chip ${e.kind}`}>
                  {e.kind === "encrypt" ? "加密" : "解密"}
                </span>
                <span className="his-main">
                  <span className="his-name">{e.name}</span>
                  <span
                    className="his-path"
                    title={e.kind === "encrypt" ? e.boxPath : e.location}
                  >
                    {e.kind === "encrypt" ? e.boxPath : e.location}
                  </span>
                </span>
                <span className="his-meta">
                  <span className="his-time">{fmtTime(e.time)}</span>
                  <span className="his-size">
                    {e.files} 个文件 · {fmtBytes(e.bytes)}
                  </span>
                </span>
                <span className="his-actions">
                  {e.kind === "encrypt" && (
                    <button
                      className="btn-text"
                      onClick={() => requestDecrypt(e.boxPath, e.location)}
                    >
                      解密
                    </button>
                  )}
                  <button className="btn-text" onClick={() => reveal(e)}>打开</button>
                  <button className="btn-text his-del" onClick={() => remove(e.id)}>
                    删除
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2.5h7A2.5 2.5 0 0 1 21 10v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17V7.5Z"
        stroke="#9aa0ab"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M3 11h18" stroke="#9aa0ab" strokeWidth="1.5" />
    </svg>
  );
}
