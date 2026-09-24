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

const PINS_KEY = "omnikit.clip.pins";

/** 置顶标记的内容指纹:文本用哈希,图片用尺寸+字节组合 */
function pinKey(it: ClipItem): string {
  if (it.kind === "text" && it.text) {
    let h = 5381;
    for (let i = 0; i < it.text.length; i++) h = ((h << 5) + h + it.text.charCodeAt(i)) | 0;
    return `t${(h >>> 0).toString(36)}`;
  }
  return `i${it.width}x${it.height}b${it.bytes}`;
}

function loadPins(): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(PINS_KEY) ?? "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export default function ClipTool() {
  const [items, setItems] = useState<ClipItem[] | null>(null);
  const [paused, setPaused] = useState(false);
  const [q, setQ] = useState("");
  const [pins, setPins] = useState<string[]>(loadPins);
  const [persist, setPersist] = useState(true);
  const [preview, setPreview] = useState<ClipItem | null>(null);

  async function refresh() {
    try {
      setItems(await invoke<ClipItem[]>("clip_list"));
    } catch (e) {
      showToast(String(e), "error");
    }
  }

  useEffect(() => {
    refresh();
    invoke<{ clip_persist: boolean }>("settings_get")
      .then((s) => setPersist(s.clip_persist))
      .catch(() => {});
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, []);

  async function setPersistRun(v: boolean) {
    setPersist(v);
    try {
      await invoke("clip_set_persist", { persist: v });
      showToast(
        v ? "已开启加密落盘，重启后历史仍在" : "已关闭并删除磁盘上的历史文件",
        "success",
        4000,
      );
    } catch (e) {
      showToast(String(e), "error");
    }
  }

  const shown = useMemo(() => {
    if (!items) return null;
    const s = q.trim().toLowerCase();
    const filtered = s ? items.filter((i) => (i.text ?? "").toLowerCase().includes(s)) : items;
    // 置顶的排前面,其余保持时间倒序(排序稳定)
    return [...filtered].sort(
      (a, b) => Number(pins.includes(pinKey(b))) - Number(pins.includes(pinKey(a))),
    );
  }, [items, q, pins]);

  function togglePin(it: ClipItem) {
    setPins((prev) => {
      const k = pinKey(it);
      const next = (
        prev.includes(k) ? prev.filter((x) => x !== k) : [k, ...prev]
      ).slice(0, 50);
      localStorage.setItem(PINS_KEY, JSON.stringify(next));
      return next;
    });
  }

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

  async function removeOne(it: ClipItem) {
    try {
      await invoke("clip_remove", { id: it.id });
      refresh();
    } catch (e) {
      showToast(String(e), "error");
    }
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
        <span className="kv-k">
          落盘保存
          <Switch on={persist} onChange={setPersistRun} />
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
          shown.map((it) => {
            const isPinned = pins.includes(pinKey(it));
            return (
              <div className="kv-row clip-row" key={it.id}>
                {it.kind === "image" && it.image_base64 ? (
                  <>
                    <img
                      className="clip-thumb clickable"
                      src={`data:image/png;base64,${it.image_base64}`}
                      alt="剪贴板图片"
                      title="点击预览大图"
                      onClick={() => setPreview(it)}
                    />
                    <span className="clip-dim">
                      图片 {it.width}×{it.height}
                    </span>
                  </>
                ) : (
                  <span className="clip-text" title={it.text ?? ""}>
                    {it.text || "（空）"}
                  </span>
                )}
                <span className="kv-k">
                  {fmtBytes(it.kind === "image" ? it.bytes : new Blob([it.text ?? ""]).size)}
                  {" · "}
                  {fmtTime(it.time)}
                </span>
                <button
                  className={`btn-text clip-pin${isPinned ? " on" : ""}`}
                  onClick={() => togglePin(it)}
                  title={isPinned ? "取消置顶" : "置顶显示在前面"}
                >
                  {isPinned ? "已置顶" : "置顶"}
                </button>
                <button className="btn-text" onClick={() => writeBack(it)}>
                  回贴
                </button>
                <button className="btn-text clip-del" onClick={() => removeOne(it)}>
                  删除
                </button>
              </div>
            );
          })}
      </div>
      {preview && (
        <div className="modal-mask open" onClick={() => setPreview(null)}>
          <div className="clip-modal" onClick={(e) => e.stopPropagation()}>
            <div className="qr-modal-title">
              剪贴板图片 · {preview.width}×{preview.height} · {fmtBytes(preview.bytes)}
            </div>
            <img src={`data:image/png;base64,${preview.image_base64 ?? ""}`} alt="剪贴板图片预览" />
            <div className="tool-actions">
              <button
                className="btn btn-sm btn-primary"
                onClick={() => {
                  writeBack(preview);
                  setPreview(null);
                }}
              >
                回贴
              </button>
              <button className="btn btn-sm" onClick={() => setPreview(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="hint">
        最多 500 条；落盘开启时历史加密保存到本机（密钥存系统凭据库），重启不丢，关闭即删除文件。注意：复制过的内容（含密码）都会被记录，可随时暂停、关闭落盘或清空
      </div>
    </div>
  );
}
