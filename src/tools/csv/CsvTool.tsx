import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { showToast } from "../../components/Toast";
import Dropdown from "../../components/Dropdown";
import { fmtBytes } from "../../lib/format";

interface CsvMeta {
  headers: string[];
  row_count: number;
  delimiter: string;
  size: number;
}

interface CsvPage {
  rows: string[][];
  matched_total: number | null;
}

interface ColStat {
  name: string;
  non_empty: number;
  distinct: string;
}

const PAGE = 100;

export default function CsvTool() {
  const [path, setPath] = useState("");
  const [meta, setMeta] = useState<CsvMeta | null>(null);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<string[][]>([]);
  const [filterCol, setFilterCol] = useState(-1);
  const [filterText, setFilterText] = useState("");
  const [matchedTotal, setMatchedTotal] = useState<number | null>(null);
  const [stats, setStats] = useState<ColStat[] | null>(null);
  const statsRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<number | null>(null);

  const totalPages =
    matchedTotal !== null
      ? Math.max(1, Math.ceil(matchedTotal / PAGE))
      : meta
        ? Math.max(1, Math.ceil(meta.row_count / PAGE))
        : 1;

  useEffect(() => {
    if (!path) return;
    setStats(null);
    setFilterText("");
    setFilterCol(-1);
    setPage(0);
    invoke<CsvMeta>("csv_open", { path })
      .then(setMeta)
      .catch((e) => {
        setMeta(null);
        showToast(String(e), "error", 5000);
      });
  }, [path]);

  // 翻页或筛选变化时取当前页(筛选输入 300ms 防抖,避免每键一字符全扫一遍)
  useEffect(() => {
    if (!meta) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const delay = filterText ? 300 : 0;
    debounceRef.current = window.setTimeout(() => {
      setLoading(true);
      invoke<CsvPage>("csv_rows", {
        path,
        offset: page * PAGE,
        limit: PAGE,
        filterCol: filterCol >= 0 ? filterCol : null,
        filterText: filterText || null,
      })
        .then((p) => {
          setRows(p.rows);
          setMatchedTotal(p.matched_total);
        })
        .catch((e) => showToast(String(e), "error", 5000))
        .finally(() => setLoading(false));
    }, delay);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [meta, path, page, filterCol, filterText]);

  async function pickFile() {
    const picked = await open({
      title: "选择 CSV 文件",
      multiple: false,
      filters: [{ name: "CSV 文件", extensions: ["csv", "tsv", "txt"] }],
    });
    if (typeof picked === "string" && picked) setPath(picked);
  }

  async function loadStats() {
    try {
      setStats(await invoke<ColStat[]>("csv_stats", { path }));
      // 统计块在表格下方,加载完自动滚过去,别让用户找
      setTimeout(() => statsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    } catch (e) {
      showToast(String(e), "error", 5000);
    }
  }

  function cellClass(s: string): string {
    if (s.trim() === "") return " csv-empty";
    return "";
  }

  return (
    <div className="stack">
      <div className="field csv-flex-none">
        <span className="field-label">文件</span>
        <div className="csv-row">
          <input
            className="input input-mono csv-path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="选择或粘贴 CSV 文件路径"
            spellCheck={false}
          />
          <button className="btn" onClick={pickFile}>
            选择
          </button>
        </div>
        {meta && (
          <span className="hint">
            {meta.headers.length} 列 · {meta.row_count} 行数据 · 分隔符
            {meta.delimiter === "\t" ? "制表符" : `「${meta.delimiter}」`} · {fmtBytes(meta.size)}
          </span>
        )}
      </div>

      {meta && (
        <>
          <div className="tool-actions csv-flex-none">
            <Dropdown
              width={130}
              value={String(filterCol)}
              onChange={(v) => {
                setFilterCol(Number(v));
                setPage(0);
              }}
              options={[
                { value: "-1", label: "全部列" },
                ...meta.headers.map((h, i) => ({
                  value: String(i),
                  label: h || `第 ${i + 1} 列`,
                })),
              ]}
            />
            <input
              className="input input-sm csv-filter"
              value={filterText}
              onChange={(e) => {
                setFilterText(e.target.value);
                setPage(0);
              }}
              placeholder={filterCol >= 0 ? `在「${meta.headers[filterCol] || `第 ${filterCol + 1} 列`}」中筛选` : "全表筛选，输入即查"}
              spellCheck={false}
            />
            <button className="btn btn-sm" onClick={stats ? () => setStats(null) : loadStats}>
              {stats ? "收起概况" : "列概况"}
            </button>
            {loading && <span className="hint">读取中…</span>}
          </div>

          {matchedTotal !== null && (
            <span className="hint csv-flex-none">
              共匹配 {matchedTotal} 行{matchedTotal > 200 ? "，仅显示前 200 行" : ""}
            </span>
          )}

          <div className="csv-table-wrap">
            <table className="csv-table">
              <thead>
                <tr>
                  <th className="csv-idx">#</th>
                  {meta.headers.map((h, i) => (
                    <th key={i}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => (
                  <tr key={ri}>
                    <td className="csv-idx">{page * PAGE + ri + 1}</td>
                    {meta.headers.map((_, ci) => (
                      <td key={ci} className={cellClass(r[ci] ?? "")} title={r[ci] ?? ""}>
                        {r[ci] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="tool-actions csv-flex-none">
            <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage(0)}>
              首页
            </button>
            <button
              className="btn btn-sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              上一页
            </button>
            <span className="hint">
              第 {page + 1} / {totalPages} 页
            </span>
            <button
              className="btn btn-sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            >
              下一页
            </button>
            <button
              className="btn btn-sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(totalPages - 1)}
            >
              末页
            </button>
          </div>

          {stats && (
            <div className="field csv-flex-none" ref={statsRef}>
              <span className="field-label">列概况</span>
              <div className="kv-list">
                {stats.map((s, i) => (
                  <div className="kv-row" key={i}>
                    <span className="kv-k kv-mono csv-stat-name" title={s.name}>
                      {s.name}
                    </span>
                    <span className="csv-stat">
                      <em>非空<i>{s.non_empty}</i></em>
                      <em>去重<i>{s.distinct}</i></em>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {!meta && (
        <div className="empty-state">
          <div className="empty-title">先选一个 CSV 文件</div>
          <div className="hint">自动识别分隔符与编码，大文件只按需读取当前页</div>
        </div>
      )}
    </div>
  );
}
