import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { showToast } from "../../components/Toast";
import { fmtBytes } from "../../lib/format";

interface HexPage {
  total: number;
  offset: number;
  data_b64: string;
}

/** 每页显示的字节数(32 行 × 16) */
const PAGE_BYTES = 512;
const LINE = 16;

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
const ASCII = Array.from({ length: 256 }, (_, i) =>
  i >= 0x20 && i < 0x7f ? String.fromCharCode(i) : "·",
);

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 解析跳转输入:0x1A2B 按十六进制,其余按十进制 */
function parseOffsetInput(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = /^0x[0-9a-f]+$/i.test(t) ? parseInt(t, 16) : Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

export default function HexTool() {
  const [path, setPath] = useState("");
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [bytes, setBytes] = useState<Uint8Array>(new Uint8Array(0));
  const [loading, setLoading] = useState(false);
  const [pat, setPat] = useState("");
  const [hits, setHits] = useState<number[] | null>(null);
  const [jump, setJump] = useState("");
  const [hitActive, setHitActive] = useState(-1);
  const searchSeq = useRef(0);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_BYTES));

  useEffect(() => {
    if (!path) return;
    setHits(null);
    setPage(0);
  }, [path]);

  useEffect(() => {
    if (!path || !total) return;
    setLoading(true);
    invoke<HexPage>("hex_read", { path, offset: page * PAGE_BYTES, len: PAGE_BYTES })
      .then((p) => setBytes(b64ToBytes(p.data_b64)))
      .catch((e) => showToast(String(e), "error", 5000))
      .finally(() => setLoading(false));
  }, [path, page, total]);

  // 先读 1 字节拿总大小,再由上面的 effect 装载首页
  useEffect(() => {
    if (!path) return;
    invoke<HexPage>("hex_read", { path, offset: 0, len: 1 })
      .then((p) => setTotal(p.total))
      .catch((e) => {
        setTotal(0);
        showToast(String(e), "error", 5000);
      });
  }, [path]);

  const lines = useMemo(() => {
    const out: { off: number; cells: number[] }[] = [];
    for (let i = 0; i < bytes.length; i += LINE) {
      out.push({ off: page * PAGE_BYTES + i, cells: Array.from(bytes.slice(i, i + LINE)) });
    }
    return out;
  }, [bytes, page]);

  async function pickFile() {
    const picked = await open({
      title: "选择要查看的文件",
      multiple: false,
      filters: [{ name: "所有文件", extensions: ["*"] }],
    });
    if (typeof picked === "string" && picked) setPath(picked);
  }

  async function doSearch() {
    if (!pat.trim()) return;
    const seq = ++searchSeq.current;
    setHits(null);
    setHitActive(-1);
    try {
      const r = await invoke<number[]>("hex_search", { path, pattern: pat.trim() });
      if (seq !== searchSeq.current) return;
      setHits(r);
      showToast(r.length === 0 ? "没有找到匹配的字节序列" : `找到 ${r.length} 处`, r.length ? "success" : "info", 3000);
      if (r.length > 0) gotoOffset(r[0], 0);
    } catch (e) {
      showToast(String(e), "error", 5000);
    }
  }

  function gotoOffset(off: number, hitIdx: number) {
    setPage(Math.floor(off / PAGE_BYTES));
    setHitActive(hitIdx);
  }

  function doJump() {
    const n = parseOffsetInput(jump);
    if (n === null) {
      showToast("输入 0x 开头的十六进制或十进制偏移", "info", 3000);
      return;
    }
    if (total && n >= total) {
      showToast(`超出文件大小 ${total}`, "error", 3000);
      return;
    }
    setHits(null);
    setHitActive(-1);
    setPage(Math.floor(n / PAGE_BYTES));
  }

  const activeOff = hitActive >= 0 && hits ? hits[hitActive] : -1;

  return (
    <div className="stack">
      <div className="field hex-flex-none">
        <span className="field-label">文件</span>
        <div className="hex-row">
          <input
            className="input input-mono hex-path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="选择或粘贴文件路径"
            spellCheck={false}
          />
          <button className="btn" onClick={pickFile}>
            选择
          </button>
        </div>
        {total > 0 && (
          <span className="hint">
            {fmtBytes(total)}（{total} 字节） · 只读查看，不修改文件
          </span>
        )}
      </div>

      {total > 0 && (
        <>
          <div className="tool-actions hex-flex-none">
            <input
              className="input input-sm input-mono hex-pat"
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              placeholder="搜索字节序列，如 89 50 4E 47"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === "Enter") doSearch();
              }}
            />
            <button className="btn btn-sm" onClick={doSearch}>
              搜索
            </button>
            {hits && hits.length > 0 && (
              <>
                <button
                  className="btn btn-sm"
                  disabled={hitActive <= 0}
                  onClick={() => gotoOffset(hits[hitActive - 1], hitActive - 1)}
                >
                  上一处
                </button>
                <span className="hint">
                  {hitActive + 1} / {hits.length}
                </span>
                <button
                  className="btn btn-sm"
                  disabled={hitActive >= hits.length - 1}
                  onClick={() => gotoOffset(hits[hitActive + 1], hitActive + 1)}
                >
                  下一处
                </button>
              </>
            )}
            <input
              className="input input-sm input-mono hex-jump"
              value={jump}
              onChange={(e) => setJump(e.target.value)}
              placeholder="跳转偏移 0x100"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === "Enter") doJump();
              }}
            />
            <button className="btn btn-sm" onClick={doJump}>
              跳转
            </button>
          </div>

          <div className="hex-view">
            {lines.map((ln) => (
              <div className="hex-line" key={ln.off}>
                <span className="hex-off">{ln.off.toString(16).padStart(8, "0")}</span>
                <span className="hex-cells">
                  {Array.from({ length: LINE }, (_, i) => {
                    const cellOff = ln.off + i;
                    const hit =
                      activeOff >= 0 &&
                      cellOff >= activeOff &&
                      cellOff < activeOff + (pat.replace(/\s+/g, "").length / 2 || 0);
                    return (
                      <span
                        key={i}
                        className={`hex-cell${hit ? " hex-hit" : ""}${i === 7 ? " hex-gap" : ""}`}
                      >
                        {ln.cells[i] !== undefined ? HEX[ln.cells[i]] : "  "}
                      </span>
                    );
                  })}
                </span>
                <span className="hex-ascii">
                  {ln.cells.map((b, i) => (
                    <span key={i} className={activeOff >= 0 && ln.off + i >= activeOff && ln.off + i < activeOff + (pat.replace(/\s+/g, "").length / 2 || 0) ? "hex-hit" : undefined}>
                      {ASCII[b]}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>

          <div className="tool-actions hex-flex-none">
            <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage(0)}>
              开头
            </button>
            <button
              className="btn btn-sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              上一页
            </button>
            <span className="hint">
              偏移 0x{(page * PAGE_BYTES).toString(16).padStart(8, "0")} · 第 {page + 1} / {pageCount} 页
              {loading ? " · 读取中…" : ""}
            </span>
            <button
              className="btn btn-sm"
              disabled={page >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            >
              下一页
            </button>
            <button
              className="btn btn-sm"
              disabled={page >= pageCount - 1}
              onClick={() => setPage(pageCount - 1)}
            >
              末页
            </button>
          </div>
        </>
      )}

      {!total && (
        <div className="empty-state">
          <div className="empty-title">先选一个文件</div>
          <div className="hint">十六进制与 ASCII 对照浏览，支持按字节序列搜索定位</div>
        </div>
      )}
    </div>
  );
}
