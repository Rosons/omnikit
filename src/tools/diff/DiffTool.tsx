import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { diffLines } from "diff";
import { showToast } from "../../components/Toast";

interface DiffRow {
  type: "add" | "del" | "ctx";
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

const MAX_CHARS = 2_000_000;
const MAX_ROWS = 4000;

const TEXT_FILTERS = [
  {
    name: "文本文件",
    extensions: [
      "txt", "md", "json", "js", "ts", "tsx", "jsx", "css", "html", "xml",
      "svg", "yml", "yaml", "toml", "ini", "cfg", "conf", "csv", "log", "sql",
      "sh", "bat", "ps1", "py", "java", "go", "rs", "c", "h", "cpp",
    ],
  },
];

export default function DiffTool() {
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [rows, setRows] = useState<DiffRow[] | null>(null);
  const [stats, setStats] = useState({ add: 0, del: 0 });

  async function loadFile(side: "left" | "right") {
    const sel = await open({ multiple: false, filters: TEXT_FILTERS });
    if (typeof sel !== "string") return;
    try {
      const s = await invoke<string>("read_text_file", { path: sel });
      if (side === "left") setLeft(s);
      else setRight(s);
    } catch (e) {
      showToast(String(e), "error", 5000);
    }
  }

  function compute() {
    if (left.length > MAX_CHARS || right.length > MAX_CHARS) {
      showToast("文本超过 2MB，请截取片段后比较", "error", 5000);
      return;
    }
    const changes = diffLines(left, right);
    const out: DiffRow[] = [];
    let oldNo = 0;
    let newNo = 0;
    let add = 0;
    let del = 0;
    for (const ch of changes) {
      const lines = ch.value.split("\n");
      if (lines.length && lines[lines.length - 1] === "") lines.pop();
      for (const text of lines) {
        if (ch.added) {
          newNo++;
          add++;
          out.push({ type: "add", oldNo: null, newNo, text });
        } else if (ch.removed) {
          oldNo++;
          del++;
          out.push({ type: "del", oldNo, newNo: null, text });
        } else {
          oldNo++;
          newNo++;
          out.push({ type: "ctx", oldNo, newNo, text });
        }
      }
    }
    setRows(out);
    setStats({ add, del });
  }

  function swap() {
    setLeft(right);
    setRight(left);
    setRows(null);
  }

  function clearAll() {
    setLeft("");
    setRight("");
    setRows(null);
  }

  const shown = rows ? rows.slice(0, MAX_ROWS) : null;

  return (
    <div className="stack">
      <div className="diff-grid">
        <div className="field">
          <span className="field-label">
            原文
            <button className="btn-text" onClick={() => loadFile("left")}>
              载入文件
            </button>
          </span>
          <textarea
            className="textarea diff-input"
            value={left}
            onChange={(e) => setLeft(e.target.value)}
            placeholder="粘贴文本，或点右侧载入文件"
            spellCheck={false}
          />
        </div>
        <div className="field">
          <span className="field-label">
            修改后
            <button className="btn-text" onClick={() => loadFile("right")}>
              载入文件
            </button>
          </span>
          <textarea
            className="textarea diff-input"
            value={right}
            onChange={(e) => setRight(e.target.value)}
            placeholder="粘贴文本，或点右侧载入文件"
            spellCheck={false}
          />
        </div>
      </div>
      <div className="tool-actions">
        <button className="btn btn-primary" onClick={compute} disabled={!left && !right}>
          开始对比
        </button>
        <button className="btn" onClick={swap}>
          左右交换
        </button>
        <button className="btn" onClick={clearAll}>
          清空
        </button>
        {rows && rows.length > 0 && (
          <span className="diff-stats">
            <span className="diff-stat-add">+{stats.add}</span>
            <span className="diff-stat-del">−{stats.del}</span>
          </span>
        )}
        {rows && rows.length === 0 && <span className="hint hint-ok">两段内容完全一致</span>}
      </div>
      {shown && shown.length > 0 && (
        <div className="diff-out">
          {shown.map((r, i) => (
            <div className={`diff-row ${r.type}`} key={i}>
              <span className="diff-no">{r.oldNo ?? ""}</span>
              <span className="diff-no">{r.newNo ?? ""}</span>
              <span className="diff-mark">
                {r.type === "add" ? "+" : r.type === "del" ? "−" : ""}
              </span>
              <span className="diff-line">{r.text === "" ? "\u00A0" : r.text}</span>
            </div>
          ))}
          {rows && rows.length > MAX_ROWS && (
            <div className="diff-more">结果过长，仅显示前 {MAX_ROWS} 行</div>
          )}
        </div>
      )}
    </div>
  );
}
