import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { showConfirm } from "../../components/ConfirmDialog";
import { showToast } from "../../components/Toast";
import Switch from "../../components/Switch";
import { fmtBytes, fmtTime } from "../../lib/format";

interface ClipItem {
  id: number;
  kind: string;
  text: string | null;
  image_base64: string | null;
  width: number | null;
  height: number | null;
  bytes: number;
  time: number;
}

export default function ClipTool() {
  const [items, setItems] = useState<ClipItem[] | null>(null);
  const [paused, setPaused] = useState(false);
  const [q, setQ] = useState("");

  async function refresh() {
    try {
      setItems(await invoke<ClipItem[]>("clip_list"));
    } catch (e) {
      showToast(String(e), "error");
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, []);

  const shown = useMemo(() => {
    if (!items) return null;
    const s = q.trim().toLowerCase();
    return s ? items.filter((i) => (i.text ?? "").toLowerCase().includes(s)) : items;
  }, [items, q]);

  async function setPausedRun(v: boolean) {
    setPaused(v);
    try {
      await invoke("clip_set_paused", { paused: v });
    } catch (e) {
      showToast(String(e), "error");
    }
  }

  async function writeBack(item: ClipItem) {
    try {
      await invoke("clip_write", { id: item.id });
      showToast(item.kind === "text" ? "已写入剪贴板，到任意位置 Ctrl+V" : "图片已写入剪贴板", "success");
    } catch (e) {
      showToast(String(e), "error", 5000);
    }
  }

  async function clearAll() {
    const ok = await showConfirm({
      title: "清空剪贴板历史",
      message: "确定清空全部剪贴板历史记录吗？",
      confirmLabel: "清空",
      danger: true,
    });
    if (!ok) return;
    await invoke("clip_clear").catch((e) => showToast(String(e), "error"));
    refresh();
  }

  return (
    <div className="stack">
      <div className="tool-actions">
        <span className="kv-k">
          监听剪贴板
          <Switch on={!paused} onChange={(v: boolean) => setPausedRun(!v)} />
        </span>
        <span className={`jwt-chip ${paused ? "pending" : "valid"}`}>
          {paused ? "已暂停" : "监听中"}
        </span>
        <input
          className="input"
          style={{ width: 220 }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索历史内容"
          spellCheck={false}
        />
        <div style={{ flex: 1 }} />
        {items && items.length > 0 && (
          <button className="btn" onClick={clearAll}>
            清空
          </button>
        )}
      </div>

      {shown && shown.length === 0 && (
        <div className="empty-state">
          <div className="empty-title">
            {q ? "没有匹配的记录" : paused ? "监听已暂停" : "还没有记录，去任何地方按 Ctrl+C 试试"}
          </div>
          <div className="hint">
            应用在后台时也会自动记录复制内容，点条目即可写回剪贴板
          </div>
        </div>
      )}

      <div className="kv-list">
        {shown &&
          shown.map((it) => (
            <div className="kv-row clip-row" key={it.id}>
              {it.kind === "image" && it.image_base64 ? (
                <img
                  className="clip-thumb"
                  src={`data:image/png;base64,${it.image_base64}`}
                  alt="剪贴板图片"
                />
              ) : (
                <span className="clip-text" title={it.text ?? ""}>
                  {it.text || "（空）"}
                </span>
              )}
              <span className="kv-k">
                {it.kind === "image"
                  ? `图片 ${it.width}×${it.height} · ${fmtBytes(it.bytes)}`
                  : fmtBytes(new Blob([it.text ?? ""]).size)}
                {" · "}
                {fmtTime(it.time)}
              </span>
              <button className="btn-text" onClick={() => writeBack(it)}>
                回贴
              </button>
            </div>
          ))}
      </div>
      <div className="hint">
        历史只保存在本机内存（重启后清空），最多 500 条；注意：所有复制过的内容（含密码）都会被记录，可随时暂停或清空
      </div>
    </div>
  );
}
