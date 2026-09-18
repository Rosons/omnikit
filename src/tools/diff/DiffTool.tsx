import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { diffArrays, diffChars, diffWords } from "diff";
import { showToast } from "../../components/Toast";

interface Seg {
  t: string;
  chg: boolean;
}
interface Cell {
  no: number;
  text: string;
  type: "ctx" | "del" | "add";
  segs?: Seg[];
}
/** 左右对齐的一行:某侧为 null 表示另一侧独有(删除/新增),用灰底补位 */
interface Pair {
  l: Cell | null;
  r: Cell | null;
  key: number;
  /** 所属差异组序号(仅该组首行携带) */
  g?: number;
  gStart?: boolean;
  gType?: "mod" | "del" | "add";
}
type Block =
  | { kind: "rows"; pairs: Pair[] }
  | { kind: "fold"; id: number; count: number; hidden: Pair[] };
type Item =
  | { kind: "pair"; p: Pair }
  | { kind: "fold"; id: number; count: number }
  | { kind: "collapse"; id: number; count: number };

const MAX_CHARS = 2_000_000;
const FOLD_MIN = 10;
const FOLD_KEEP = 3;

interface DiffOpts {
  ignoreCR: boolean;
  ignoreBlank: boolean;
  ignoreSpace: boolean;
  ignoreAllSpace: boolean;
  ignoreCase: boolean;
}
const DEFAULT_OPTS: DiffOpts = {
  ignoreCR: true,
  ignoreBlank: false,
  ignoreSpace: false,
  ignoreAllSpace: false,
  ignoreCase: false,
};
const OPT_DEFS: { key: keyof DiffOpts; label: string }[] = [
  { key: "ignoreCR", label: "忽略换行符差异（CR/LF）" },
  { key: "ignoreBlank", label: "忽略空行" },
  { key: "ignoreSpace", label: "忽略行首尾空白" },
  { key: "ignoreAllSpace", label: "忽略空白字符" },
  { key: "ignoreCase", label: "忽略大小写" },
];

/** 参与比较的一行:no=文件里的原始行号(含被忽略的行,保证行号可对照原文件) */
interface LineItem {
  no: number;
  text: string;
  key: string;
}

function toLines(text: string, o: DiffOpts): LineItem[] {
  // 带分隔符切行,才能按需把 CR/LF 差异算进比较
  const parts = text.split(/(\r\n|\r|\n)/);
  const items: LineItem[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const t = parts[i];
    if (i === parts.length - 1 && t === "") break; // 结尾换行符,不是空行
    let key = t;
    if (!o.ignoreCR) {
      const eol = parts[i + 1] || "";
      key += eol === "\r\n" ? "\x01" : eol === "\r" ? "\x02" : eol === "\n" ? "\x03" : "";
    }
    if (o.ignoreAllSpace) key = key.replace(/\s+/g, "");
    else if (o.ignoreSpace) key = key.trim();
    if (o.ignoreCase) key = key.toLowerCase();
    items.push({ no: items.length + 1, text: t, key });
  }
  if (o.ignoreBlank) {
    return items.filter((it) => (o.ignoreAllSpace ? it.text.trim() !== "" : it.text !== ""));
  }
  return items;
}

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

/** 行内词级比对:标出这一行里具体改了哪几个词;中文无词边界改用字符级 */
function intraSegs(a: string, b: string): [Seg[], Seg[]] | null {
  if (a === b || a.length > 400 || b.length > 400) return null;
  const hasCJK = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(a + b);
  const parts = hasCJK ? diffChars(a, b) : diffWords(a, b);
  const ls: Seg[] = [];
  const rs: Seg[] = [];
  for (const pt of parts) {
    if (pt.added) rs.push({ t: pt.value, chg: true });
    else if (pt.removed) ls.push({ t: pt.value, chg: true });
    else {
      ls.push({ t: pt.value, chg: false });
      rs.push({ t: pt.value, chg: false });
    }
  }
  return [ls, rs];
}

/** 折叠按钮的小箭头:文字箭头(⌄/⌃)字体基线不齐,用 SVG 保证垂直居中 */
function Chev({ up }: { up?: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden style={{ flex: "none" }}>
      <polyline
        points={up ? "2,6.4 5,3.4 8,6.4" : "2,3.6 5,6.6 8,3.6"}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 行内容渲染:有词级结果时仅加深变化片段 */function LineText({ cell, strong }: { cell: Cell; strong: "del" | "add" }) {
  if (!cell.segs || cell.segs.length === 0) {
    return <>{cell.text === "" ? "\u00A0" : cell.text}</>;
  }
  return (
    <>
      {cell.segs.map((s, i) =>
        s.chg ? (
          <mark key={i} className={strong === "del" ? "w-del" : "w-add"}>
            {s.t}
          </mark>
        ) : (
          <span key={i}>{s.t}</span>
        ),
      )}
    </>
  );
}

export default function DiffTool() {
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [mode, setMode] = useState<"edit" | "diff">("edit");
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [stats, setStats] = useState({ add: 0, del: 0 });
  const [opts, setOpts] = useState<DiffOpts>(DEFAULT_OPTS);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [groups, setGroups] = useState(0);
  const [chgPos, setChgPos] = useState(-1);
  const [marks, setMarks] = useState<{ pct: number; type: string }[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);

  function compute() {
    if (left.length > MAX_CHARS || right.length > MAX_CHARS) {
      setBlocks(null);
      showToast("文本超过 2MB，请截取片段后比较", "error", 5000);
      return;
    }
    const L = toLines(left, opts);
    const R = toLines(right, opts);
    const changes = diffArrays(L, R, { comparator: (a, b) => a.key === b.key });
    const flat: Pair[] = [];
    let key = 0;
    let add = 0;
    let del = 0;
    let g = -1;
    let inChange = false;
    let dels: LineItem[] = [];
    let adds: LineItem[] = [];
    const flush = () => {
      add += adds.length;
      del += dels.length;
      const n = Math.max(dels.length, adds.length);
      for (let i = 0; i < n; i++) {
        let gStart = false;
        if (!inChange) {
          g++;
          inChange = true;
          gStart = true;
        }
        const l: Cell | null =
          i < dels.length ? { no: dels[i].no, text: dels[i].text, type: "del" } : null;
        const r: Cell | null =
          i < adds.length ? { no: adds[i].no, text: adds[i].text, type: "add" } : null;
        if (l && r) {
          const segs = intraSegs(dels[i].text, adds[i].text);
          if (segs) {
            l.segs = segs[0];
            r.segs = segs[1];
          }
        }
        flat.push({
          l,
          r,
          key: key++,
          g: gStart ? g : undefined,
          gStart: gStart || undefined,
          gType: l && r ? "mod" : l ? "del" : "add",
        });
      }
      dels = [];
      adds = [];
    };
    // 相同行要分别取左右各自的原文(忽略大小写等规则只用于比较,不改显示)
    let lp = 0;
    let rp = 0;
    for (const ch of changes) {
      if (ch.added) {
        adds.push(...ch.value);
        rp += ch.count ?? ch.value.length;
      } else if (ch.removed) {
        dels.push(...ch.value);
        lp += ch.count ?? ch.value.length;
      } else {
        flush();
        const n = ch.count ?? ch.value.length;
        for (let i = 0; i < n; i++) {
          const a = L[lp + i];
          const b = R[rp + i];
          inChange = false;
          flat.push({
            l: a ? { no: a.no, text: a.text, type: "ctx" } : null,
            r: b ? { no: b.no, text: b.text, type: "ctx" } : null,
            key: key++,
          });
        }
        lp += n;
        rp += n;
      }
    }
    flush();

    // 长段相同内容折叠为可展开的一行
    const foldable = add + del > 0;
    const foldThreshold = foldable ? FOLD_MIN : 4000;
    const out: Block[] = [];
    let run: Pair[] = [];
    const endRun = () => {
      if (!run.length) return;
      if (run.length > foldThreshold) {
        out.push({ kind: "rows", pairs: run.slice(0, FOLD_KEEP) });
        out.push({
          kind: "fold",
          id: run[FOLD_KEEP].key,
          count: run.length - FOLD_KEEP * 2,
          hidden: run.slice(FOLD_KEEP, -FOLD_KEEP),
        });
        out.push({ kind: "rows", pairs: run.slice(-FOLD_KEEP) });
      } else {
        out.push({ kind: "rows", pairs: run });
      }
      run = [];
    };
    for (const p of flat) {
      if (p.l?.type === "ctx") run.push(p);
      else {
        endRun();
        out.push({ kind: "rows", pairs: [p] });
      }
    }
    endRun();

    setBlocks(out);
    setStats({ add, del });
    setGroups(g + 1);
    setChgPos(-1);
    setExpanded(new Set());
  }

  const items = useMemo<Item[]>(() => {
    if (!blocks) return [];
    const list: Item[] = [];
    for (const b of blocks) {
      if (b.kind === "rows") for (const p of b.pairs) list.push({ kind: "pair", p });
      else if (expanded.has(b.id)) {
        for (const p of b.hidden) list.push({ kind: "pair", p });
        list.push({ kind: "collapse", id: b.id, count: b.count });
      } else list.push({ kind: "fold", id: b.id, count: b.count });
    }
    return list;
  }, [blocks, expanded]);

  // 对比模式下内容或选项变化(载入文件、左右交换、勾选项)自动重算,结果实时刷新
  useEffect(() => {
    if (mode !== "diff") return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(compute, 200);
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, right, mode, opts]);

  // 渲染后测量每处差异的真实位置:滚动条标记 + 首次自动定位到第一处
  useLayoutEffect(() => {
    const c = scrollRef.current;
    if (mode !== "diff" || !c) {
      setMarks([]);
      return;
    }
    const els = Array.from(c.querySelectorAll<HTMLElement>("[data-chg]"));
    const total = c.scrollHeight || 1;
    setMarks(
      els.map((el) => ({
        pct: Math.min(1, el.offsetTop / total),
        type: el.dataset.chgType || "mod",
      })),
    );
    if (chgPos === -1 && els.length > 0) {
      setChgPos(0);
      c.scrollTo({ top: Math.max(0, els[0].offsetTop - 72) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, mode]);

  function scrollToGroup(i: number) {
    const c = scrollRef.current;
    if (!c) return;
    const el = c.querySelector<HTMLElement>(`[data-chg="${i}"]`);
    if (el) c.scrollTo({ top: Math.max(0, el.offsetTop - 72), behavior: "smooth" });
  }

  function go(delta: number) {
    if (groups === 0) return;
    const next = Math.min(groups - 1, Math.max(0, chgPos + delta));
    if (next === chgPos) return;
    setChgPos(next);
    scrollToGroup(next);
  }

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
    setBlocks(null);
    setExpanded(new Set());
    setGroups(0);
    setChgPos(-1);
  }

  const same = mode === "diff" && blocks !== null && stats.add === 0 && stats.del === 0;

  function renderPair(p: Pair) {
    const cur = p.gStart && p.g === chgPos;
    const cls = cur ? " chg-cur" : "";
    const mark = p.gStart ? { "data-chg": p.g, "data-chg-type": p.gType } : undefined;
    return (
      <Fragment key={p.key}>
        {p.l ? (
          <div className={`diff-cell ${p.l.type}${cls}`} {...(mark as object)}>
            <span className="diff-no">{p.l.no}</span>
            <span className="diff-mark">−</span>
            <span className="diff-line">
              <LineText cell={p.l} strong="del" />
            </span>
          </div>
        ) : (
          <div className="diff-cell filler">
            <span className="diff-line">{"\u00A0"}</span>
          </div>
        )}
        {p.r ? (
          <div className={`diff-cell ${p.r.type}${cls}`} {...(p.l ? undefined : (mark as object))}>
            <span className="diff-no">{p.r.no}</span>
            <span className="diff-mark">+</span>
            <span className="diff-line">
              <LineText cell={p.r} strong="add" />
            </span>
          </div>
        ) : (
          <div className="diff-cell filler">
            <span className="diff-line">{"\u00A0"}</span>
          </div>
        )}
      </Fragment>
    );
  }

  return (
    <div className="stack">
      <div className="diff-panes">
        <div className="diff-opts">
          {OPT_DEFS.map((o) => (
            <button
              key={o.key}
              className={`opt-chip${opts[o.key] ? " on" : ""}`}
              onClick={() => setOpts((s) => ({ ...s, [o.key]: !s[o.key] }))}
            >
              {opts[o.key] ? "✓ " : ""}
              {o.label}
            </button>
          ))}
        </div>
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
          <div className="diff-wrap">
            <div className="diff-scroll" ref={scrollRef}>
              <div className="diff-grid2">
                {items.map((it) =>
                  it.kind === "fold" ? (
                    <div key={it.id} className="diff-fold">
                      <span className="diff-fold-line" />
                      <button
                        className="diff-fold-btn"
                        onClick={() => setExpanded((s) => new Set(s).add(it.id))}
                      >
                        展开中间相同的 {it.count} 行
                        <Chev />
                      </button>
                      <span className="diff-fold-line" />
                    </div>
                  ) : it.kind === "collapse" ? (
                    <div key={`c-${it.id}`} className="diff-fold">
                      <span className="diff-fold-line" />
                      <button
                        className="diff-fold-btn"
                        onClick={() =>
                          setExpanded((s) => {
                            const n = new Set(s);
                            n.delete(it.id);
                            return n;
                          })
                        }
                      >
                        收起相同的 {it.count} 行
                        <Chev up />
                      </button>
                      <span className="diff-fold-line" />
                    </div>
                  ) : (
                    renderPair(it.p)
                  ),
                )}
                {blocks && blocks.length === 0 && (
                  <div className="diff-empty">没有内容</div>
                )}
              </div>
            </div>
            {groups > 0 && (
              <div className="diff-nav">
                <button className="btn-text" onClick={() => go(-1)} disabled={chgPos <= 0}>
                  ▲
                </button>
                <span className="diff-nav-pos">
                  {chgPos + 1}/{groups}
                </span>
                <button
                  className="btn-text"
                  onClick={() => go(1)}
                  disabled={chgPos >= groups - 1}
                >
                  ▼
                </button>
              </div>
            )}
            {marks.length > 0 && (
              <div className="diff-rail">
                {marks.map((m, i) => (
                  <span
                    key={i}
                    className={`diff-marker ${m.type}`}
                    style={{ top: `${m.pct * 100}%` }}
                    onClick={() => scrollToGroup(i)}
                  />
                ))}
              </div>
            )}
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
        {mode === "diff" && blocks !== null && !same && (
          <span className="diff-stats">
            <span className="diff-stat-add">+{stats.add}</span>
            <span className="diff-stat-del">−{stats.del}</span>
          </span>
        )}
      </div>
    </div>
  );
}
