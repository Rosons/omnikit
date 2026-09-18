import { Fragment, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { diffLines } from "diff";
import { showToast } from "../../components/Toast";

interface Cell {
  no: number;
  text: string;
  type: "ctx" | "del" | "add";
}
/** 左右对齐的一行:某侧为 null 表示另一侧独有(删除/新增),用灰底补位 */
interface Pair {
  l: Cell | null;
  r: Cell | null;
}

const MAX_CHARS = 2_000_000;
const MAX_PAIRS = 4000;

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
  const [mode, setMode] = useState<"edit" | "diff">("edit");
  const [pairs, setPairs] = useState<Pair[] | null>(null);
  const [stats, setStats] = useState({ add: 0, del: 0 });
  const timer = useRef<number | undefined>(undefined);

  function compute() {
    if (left.length > MAX_CHARS || right.length > MAX_CHARS) {
      setPairs(null);
      showToast("文本超过 2MB，请截取片段后比较", "error", 5000);
      return;
    }
    const split = (v: string) => {
      const ls = v.split("\n");
      if (ls.length && ls[ls.length - 1] === "") ls.pop();
      return ls;
    };
    const out: Pair[] = [];
    let oldNo = 0;
    let newNo = 0;
    let add = 0;
    let del = 0;
    let dels: string[] = [];
    let adds: string[] = [];
    const flush = () => {
      add += adds.length;
      del += dels.length;
      const n = Math.max(dels.length, adds.length);
      for (let i = 0; i < n; i++) {
        out.push({
          l: i < dels.length ? { no: ++oldNo, text: dels[i], type: "del" } : null,
          r: i < adds.length ? { no: ++newNo, text: adds[i], type: "add" } : null,
        });
      }
      dels = [];
      adds = [];
    };
    for (const ch of diffLines(left, right)) {
      if (ch.added) adds.push(...split(ch.value));
      else if (ch.removed) dels.push(...split(ch.value));
      else {
        flush();
        for (const t of split(ch.value)) {
          oldNo++;
          newNo++;
          out.push({
            l: { no: oldNo, text: t, type: "ctx" },
            r: { no: newNo, text: t, type: "ctx" },
          });
        }
      }
    }
    flush();
    setPairs(out);
    setStats({ add, del });
  }

  // 对比模式下内容变化(载入文件、左右交换)自动重算,结果实时刷新
  useEffect(() => {
    if (mode !== "diff") return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(compute, 200);
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, right, mode]);

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

  function swap() {
    setLeft(right);
    setRight(left);
  }

  function clearAll() {
    setLeft("");
    setRight("");
    setMode("edit");
    setPairs(null);
  }

  const shown = pairs ? pairs.slice(0, MAX_PAIRS) : null;
  const same = mode === "diff" && pairs !== null && stats.add === 0 && stats.del === 0;

  return (
    <div className="stack">
      <div className="diff-panes">
        <div className="diff-cols">
          <div className="diff-col-head">
            原文
            <button className="btn-text" onClick={() => loadFile("left")}>
              载入文件
            </button>
          </div>
          <div className="diff-col-head">
            修改后
            <button className="btn-text" onClick={() => loadFile("right")}>
              载入文件
            </button>
          </div>
        </div>
        {mode === "edit" ? (
          <div className="diff-cols diff-cols-fill">
            <textarea
              className="textarea diff-input"
              value={left}
              onChange={(e) => setLeft(e.target.value)}
              placeholder="粘贴文本，或点上方「载入文件」"
              spellCheck={false}
            />
            <textarea
              className="textarea diff-input"
              value={right}
              onChange={(e) => setRight(e.target.value)}
              placeholder="粘贴文本，或点上方「载入文件」"
              spellCheck={false}
            />
          </div>
        ) : (
          <div className="diff-scroll">
            <div className="diff-grid2">
              {shown &&
                shown.map((p, i) => (
                <Fragment key={i}>
                  {p.l ? (
                    <div className={`diff-cell ${p.l.type}`}>
                      <span className="diff-no">{p.l.no}</span>
                      <span className="diff-mark">−</span>
                      <span className="diff-line">{p.l.text === "" ? "\u00A0" : p.l.text}</span>
                    </div>
                  ) : (
                    <div className="diff-cell filler">
                      <span className="diff-line">{"\u00A0"}</span>
                    </div>
                  )}
                  {p.r ? (
                    <div className={`diff-cell ${p.r.type}`}>
                      <span className="diff-no">{p.r.no}</span>
                      <span className="diff-mark">+</span>
                      <span className="diff-line">{p.r.text === "" ? "\u00A0" : p.r.text}</span>
                    </div>
                  ) : (
                    <div className="diff-cell filler">
                      <span className="diff-line">{"\u00A0"}</span>
                    </div>
                  )}
                </Fragment>
              ))}
              {pairs && pairs.length > MAX_PAIRS && (
                <div className="diff-more">结果过长，仅显示前 {MAX_PAIRS} 行</div>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="tool-actions">
        {mode === "edit" ? (
          <button
            className="btn btn-primary"
            onClick={() => {
              compute();
              setMode("diff");
            }}
            disabled={!left && !right}
          >
            开始对比
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => setMode("edit")}>
            返回编辑
          </button>
        )}
        <button className="btn" onClick={swap}>
          左右交换
        </button>
        <button className="btn" onClick={clearAll}>
          清空
        </button>
        {same && <span className="hint hint-ok">两段内容完全一致</span>}
        {mode === "diff" && pairs !== null && !same && (
          <span className="diff-stats">
            <span className="diff-stat-add">+{stats.add}</span>
            <span className="diff-stat-del">−{stats.del}</span>
          </span>
        )}
      </div>
    </div>
  );
}
