import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open, save } from "@tauri-apps/plugin-dialog";
import { fmtBytes, fmtDuration } from "../../lib/format";
import { peekDecryptPrefill } from "../../lib/bus";

interface ProgressEvent {
  phase: "pack" | "unpack";
  currentFile: string;
  filesDone: number;
  filesTotal: number;
  bytesDone: number;
  bytesTotal: number;
}

interface SbSummary {
  output: string;
  files: number;
  bytes: number;
  elapsedMs: number;
}

interface ScannedFile {
  path: string;
  rel: string;
  size: number;
}

interface ScanResult {
  files: ScannedFile[];
  totalBytes: number;
  skippedInputs: string[];
  renamedInputs: { from: string; to: string }[];
}

type RunPhase = "idle" | "busy" | "done";

function baseName(p: string): string {
  const norm = p.replace(/[\\/]+$/, "");
  const i = Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/"));
  return i >= 0 ? norm.slice(i + 1) : norm;
}

function parentDir(p: string): string {
  const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return i > 0 ? p.slice(0, i) : "";
}

function defaultBoxPath(first: string): string {
  const dir = parentDir(first);
  const name = baseName(first);
  return dir ? `${dir}\\${name}.box` : `${name}.box`;
}

/* ---------- 扩展名 → 图标分组 ---------- */
const EXT_GROUPS: Record<string, string[]> = {
  image: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic", "ico"],
  video: ["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v"],
  audio: ["mp3", "wav", "flac", "aac", "ogg", "m4a", "wma"],
  archive: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso"],
  doc: ["doc", "docx", "xls", "xlsx", "ppt", "pptx", "pdf", "txt", "md", "csv", "epub"],
  code: ["js", "ts", "tsx", "jsx", "py", "rs", "go", "java", "c", "cpp", "h", "cs", "json", "html", "css", "sh", "bat", "toml", "yaml", "yml"],
};

const EXT_LABEL_OVERRIDES: Record<string, string> = {
  jpg: "JPG", jpeg: "JPG", png: "PNG", gif: "GIF", webp: "WEB", bmp: "BMP",
  svg: "SVG", heic: "HEIC", ico: "ICO",
  mp4: "MP4", mkv: "MKV", avi: "AVI", mov: "MOV", wmv: "WMV", flv: "FLV",
  webm: "WEB", m4v: "M4V", mp3: "MP3", wav: "WAV", flac: "FLAC", aac: "AAC",
  ogg: "OGG", m4a: "M4A", wma: "WMA", zip: "ZIP", rar: "RAR", "7z": "7Z",
  tar: "TAR", gz: "GZ", bz2: "BZ2", xz: "XZ", iso: "ISO",
  doc: "DOC", docx: "DOC", xls: "XLS", xlsx: "XLS", ppt: "PPT", pptx: "PPT",
  pdf: "PDF", txt: "TXT", md: "MD", csv: "CSV", epub: "EPUB",
};

function extOf(rel: string): string {
  const name = rel.split("/").pop() ?? "";
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

function extGroup(rel: string): string {
  const ext = extOf(rel);
  for (const [group, exts] of Object.entries(EXT_GROUPS)) {
    if (exts.includes(ext)) return group;
  }
  return "other";
}

function extLabel(rel: string): string {
  const ext = extOf(rel);
  if (!ext) return "FILE";
  return EXT_LABEL_OVERRIDES[ext] ?? ext.slice(0, 4).toUpperCase();
}

export default function SafeBox() {
  const [tab, setTab] = useState<"encrypt" | "decrypt">("encrypt");

  // 加密表单
  const [items, setItems] = useState<string[]>([]);
  const [scanned, setScanned] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const scanSeqRef = useRef(0);
  const [output, setOutput] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  // 解密表单
  const [boxPath, setBoxPath] = useState("");
  const [outDir, setOutDir] = useState("");

  // 运行状态
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [summary, setSummary] = useState<SbSummary | null>(null);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const speedRef = useRef({ lastBytes: 0, lastTime: 0, speed: 0 });
  const appliedPrefill = useRef(0);

  const tabRef = useRef(tab);
  tabRef.current = tab;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const outputRef = useRef(output);
  outputRef.current = output;

  const clearRunState = () => {
    setPhase("idle");
    setProgress(null);
    setSummary(null);
    setError("");
  };

  const clearAll = () => {
    scanSeqRef.current++; // 作废进行中的扫描
    setItems([]);
    setScanned(null);
    setScanning(false);
    setOutput("");
    setPassword("");
    setConfirm("");
    clearRunState();
  };

  // 追加待加密项(去重),并扫描出完整文件清单
  async function addItems(paths: string[]) {
    if (!paths.length) return;
    clearRunState();
    const merged = Array.from(new Set([...itemsRef.current, ...paths]));
    setItems(merged);
    if (!outputRef.current) setOutput(defaultBoxPath(merged[0]));
    // 序号防竞态:只有最新一次扫描的结果会被采纳
    const seq = ++scanSeqRef.current;
    setScanning(true);
    try {
      const res = await invoke<ScanResult>("sb_scan", { paths: merged });
      if (seq !== scanSeqRef.current) return;
      setScanned(res);
      setError("");
    } catch (e) {
      if (seq !== scanSeqRef.current) return;
      setError(String(e));
      setScanned(null);
    } finally {
      if (seq === scanSeqRef.current) setScanning(false);
    }
  }

  const addItemsRef = useRef(addItems);
  addItemsRef.current = addItems;

  // 拖放:enter/over 高亮,drop 按当前 Tab 分发
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "enter" || p.type === "over") {
          setDragOver(true);
        } else if (p.type === "leave") {
          setDragOver(false);
        } else if (p.type === "drop") {
          setDragOver(false);
          if (tabRef.current === "encrypt") {
            addItemsRef.current(p.paths);
          } else {
            const box = p.paths.find((x) => x.toLowerCase().endsWith(".box"));
            if (!box) {
              setError("请拖入 .box 保险箱文件");
              return;
            }
            clearRunState();
            setBoxPath(box);
            setOutDir(parentDir(box));
          }
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 进度事件 + 前端估算速度
  useEffect(() => {
    const un = listen<ProgressEvent>("safebox://progress", (e) => {
      const now = performance.now();
      const st = speedRef.current;
      if (st.lastTime && e.payload.bytesDone >= st.lastBytes) {
        const dt = (now - st.lastTime) / 1000;
        if (dt >= 0.25) {
          st.speed = (e.payload.bytesDone - st.lastBytes) / dt;
          st.lastBytes = e.payload.bytesDone;
          st.lastTime = now;
        }
      } else {
        st.lastBytes = e.payload.bytesDone;
        st.lastTime = now;
      }
      setProgress(e.payload);
    });
    return () => {
      un.then((fn) => fn());
    };
  }, []);

  // 其他页面(文件管理)发起的解密预填
  useEffect(() => {
    const p = peekDecryptPrefill(appliedPrefill.current);
    if (p) {
      appliedPrefill.current = p.v;
      clearRunState();
      setTab("decrypt");
      setBoxPath(p.boxPath);
      setOutDir(p.outDir);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickFiles() {
    const sel = await open({ multiple: true });
    if (Array.isArray(sel) && sel.length) addItemsRef.current(sel);
  }

  async function pickDir() {
    const sel = await open({ directory: true, multiple: false });
    if (typeof sel === "string") addItemsRef.current([sel]);
  }

  async function browseOutput() {
    const sel = await save({
      defaultPath: output || "保险箱.box",
      filters: [{ name: "DevToolbox 保险箱", extensions: ["box"] }],
    });
    if (typeof sel === "string") setOutput(sel);
  }

  async function pickBox() {
    const sel = await open({
      multiple: false,
      filters: [{ name: "DevToolbox 保险箱", extensions: ["box"] }],
    });
    if (typeof sel === "string") {
      clearRunState();
      setBoxPath(sel);
      setOutDir(parentDir(sel));
    }
  }

  async function browseOutDir() {
    const sel = await open({ directory: true, multiple: false });
    if (typeof sel === "string") setOutDir(sel);
  }

  function switchTab(next: "encrypt" | "decrypt") {
    if (next === tab) return;
    setTab(next);
    clearRunState();
  }

  async function startEncrypt() {
    setPhase("busy");
    setProgress(null);
    setSummary(null);
    setError("");
    speedRef.current = { lastBytes: 0, lastTime: 0, speed: 0 };
    try {
      const s = await invoke<SbSummary>("sb_encrypt", {
        paths: items,
        password,
        output,
      });
      setSummary(s);
      setPhase("done");
      setPassword("");
      setConfirm("");
    } catch (e) {
      const msg = String(e);
      if (msg === "已取消") clearRunState();
      else {
        setError(msg);
        setPhase("idle");
      }
    } finally {
      setCancelling(false);
    }
  }

  async function startDecrypt() {
    setPhase("busy");
    setProgress(null);
    setSummary(null);
    setError("");
    speedRef.current = { lastBytes: 0, lastTime: 0, speed: 0 };
    try {
      const s = await invoke<SbSummary>("sb_decrypt", {
        boxPath,
        password,
        outputDir: outDir,
      });
      setSummary(s);
      setPhase("done");
      setPassword("");
    } catch (e) {
      const msg = String(e);
      if (msg === "已取消") clearRunState();
      else {
        setError(msg);
        setPhase("idle");
      }
    } finally {
      setCancelling(false);
    }
  }

  async function cancelTask() {
    if (cancelling) return;
    setCancelling(true);
    await invoke("sb_cancel").catch(() => {});
  }

  // 「继续使用」:清空当前页全部输入,回到全新状态
  function resetForNext() {
    scanSeqRef.current++;
    setScanning(false);
    if (tab === "encrypt") {
      setItems([]);
      setScanned(null);
      setOutput("");
    } else {
      setBoxPath("");
      setOutDir("");
    }
    setPassword("");
    setConfirm("");
    clearRunState();
  }

  async function reveal(path: string) {
    try {
      await invoke("sb_reveal", { path });
    } catch (e) {
      setError(String(e));
    }
  }

  const busy = phase === "busy";
  const mismatch = confirm.length > 0 && password !== confirm;
  const needConfirm = password.length > 0 && confirm.length === 0;
  const canEncrypt =
    items.length > 0 &&
    output.trim().length > 0 &&
    password.length > 0 &&
    confirm.length > 0 &&
    password === confirm;
  const canDecrypt = boxPath.trim().length > 0 && password.length > 0;

  return (
    <div>
      <div className="seg" role="tablist">
        <button
          className={`seg-btn${tab === "encrypt" ? " active" : ""}`}
          onClick={() => switchTab("encrypt")}
        >
          加密
        </button>
        <button
          className={`seg-btn${tab === "decrypt" ? " active" : ""}`}
          onClick={() => switchTab("decrypt")}
        >
          解密
        </button>
      </div>

      {error && (
        <div className="error-banner">
          <WarnIcon />
          <span>{error}</span>
        </div>
      )}

      {busy && (
        <TaskCard
          phase={tab}
          name={tab === "encrypt" ? baseName(output) || "保险箱任务" : baseName(boxPath) || "保险箱任务"}
          progress={progress}
          speed={speedRef.current.speed}
          onCancel={cancelTask}
          cancelling={cancelling}
        />
      )}

      {!busy && phase === "done" && summary && (
        <div className="result">
          <div className="result-icon">
            <CheckIcon />
          </div>
          <div className="result-main">
            <div className="result-title">{tab === "encrypt" ? "加密完成" : "解密完成"}</div>
            <div className="result-stats">
              <span>{summary.files} 个文件</span>
              <span>{fmtBytes(summary.bytes)}</span>
              <span>耗时 {fmtDuration(summary.elapsedMs)}</span>
            </div>
            <div className="result-path">{summary.output}</div>
          </div>
          <div className="result-actions">
            <button className="btn" onClick={() => reveal(summary.output)}>
              打开所在文件夹
            </button>
            <button className="btn btn-primary" onClick={resetForNext}>
              继续使用
            </button>
          </div>
        </div>
      )}

      {!busy && phase !== "done" && tab === "encrypt" && (
        <div className="stack">
          {items.length === 0 ? (
            <div
              className={`dropzone${dragOver ? " over" : ""}`}
              onClick={pickFiles}
              role="button"
              aria-label="拖拽或选择要加密的文件"
            >
              <div className="dropzone-title">拖拽文件 / 文件夹到此处</div>
              <div className="dropzone-sub">或点击下方按钮选择</div>
              <div className="dropzone-actions" onClick={(e) => e.stopPropagation()}>
                <button className="btn" onClick={pickFiles}>添加文件</button>
                <button className="btn" onClick={pickDir}>添加文件夹</button>
              </div>
            </div>
          ) : (
            <>
              <div className="toolbar">
                <button className="btn" onClick={pickFiles} disabled={busy || scanning}>添加文件</button>
                <button className="btn" onClick={pickDir} disabled={busy || scanning}>添加文件夹</button>
                <span className="toolbar-hint">可继续拖拽追加</span>
                <div className="toolbar-right">
                  <button className="btn-text" onClick={clearAll}>清空</button>
                </div>
              </div>

              {scanned &&
                (scanned.skippedInputs.length > 0 || scanned.renamedInputs.length > 0) && (
                  <div className="scan-notices">
                    {scanned.skippedInputs.map((s) => (
                      <div className="notice notice-info" key={s} title={s}>
                        <span className="notice-icon">
                          <InfoIcon />
                        </span>
                        <span className="notice-text">
                          已跳过 <span className="notice-path">{s}</span>
                          ，内容已包含在其他所选文件夹中
                        </span>
                      </div>
                    ))}
                    {scanned.renamedInputs.map((r) => (
                      <div className="notice notice-warn" key={r.to}>
                        <span className="notice-icon">
                          <RenameIcon />
                        </span>
                        <span className="notice-text">
                          名称冲突，已自动改名{" "}
                          <span className="notice-path">{r.from}</span> →{" "}
                          <span className="notice-name">{r.to}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}

              <div className="file-table">
                <div className="file-table-head">
                  <span>文件名</span>
                  <span>大小</span>
                </div>
                <div className="file-table-body">
                  {scanning ? (
                    <div className="table-loading">
                      <span className="spinner spinner-s" />
                      正在扫描文件…
                    </div>
                  ) : (
                    scanned?.files.map((f) => (
                      <div className="file-row" key={f.path} title={f.path}>
                        <span className={`file-ext ext-${extGroup(f.rel)}`}>{extLabel(f.rel)}</span>
                        <span className="file-name">{f.rel}</span>
                        <span className="file-size">{fmtBytes(f.size)}</span>
                      </div>
                    ))
                  )}
                </div>
                <div className="file-table-foot">
                  <span>共 {scanned?.files.length ?? 0} 个文件</span>
                  <span>合计 {fmtBytes(scanned?.totalBytes ?? 0)}</span>
                </div>
              </div>
            </>
          )}

          <div className="card form-grid">
            <div className="field span-2">
              <span className="field-label">存储位置</span>
              <div className="input-group">
                <input
                  className="input input-mono"
                  value={output}
                  placeholder="选择文件后自动生成，可修改"
                  onChange={(e) => setOutput(e.target.value)}
                  disabled={busy}
                  spellCheck={false}
                />
                <button className="btn-text" onClick={browseOutput} disabled={busy}>
                  浏览
                </button>
              </div>
            </div>
            <div className="field">
              <span className="field-label">密码</span>
              <input
                className="input"
                type="password"
                value={password}
                placeholder="设置保险箱密码"
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="field">
              <span className="field-label">确认密码</span>
              <input
                className="input"
                type="password"
                value={confirm}
                placeholder="再输入一遍"
                onChange={(e) => setConfirm(e.target.value)}
                disabled={busy}
              />
              {mismatch && <span className="hint hint-error">两次输入不一致</span>}
              {needConfirm && <span className="hint">请再输入一遍确认密码</span>}
            </div>
          </div>

          <div className="form-footer">
            <span className="hint">密码丢失后无法找回</span>
            <button
              className="btn btn-primary btn-lg"
              disabled={!canEncrypt}
              onClick={startEncrypt}
            >
              开始加密
            </button>
          </div>
        </div>
      )}

      {!busy && phase !== "done" && tab === "decrypt" && (
        <div className="stack">
          <div
            className={`dropzone${dragOver ? " over" : ""}`}
            onClick={pickBox}
            role="button"
            aria-label="拖入或选择保险箱文件"
          >
            <div className="dropzone-title">
              {boxPath ? baseName(boxPath) : "拖入 .box 保险箱文件"}
            </div>
            <div className="dropzone-sub" title={boxPath}>
              {boxPath || "或点击下方按钮选择"}
            </div>
            <div className="dropzone-actions" onClick={(e) => e.stopPropagation()}>
              <button className="btn" onClick={pickBox} disabled={busy}>
                选择 .box 文件
              </button>
            </div>
          </div>

          <div className="card form-grid">
            <div className="field span-2">
              <span className="field-label">解压到</span>
              <div className="input-group">
                <input
                  className="input input-mono"
                  value={outDir}
                  placeholder="默认与保险箱同目录"
                  onChange={(e) => setOutDir(e.target.value)}
                  disabled={busy}
                  spellCheck={false}
                />
                <button className="btn-text" onClick={browseOutDir} disabled={busy}>
                  浏览
                </button>
              </div>
            </div>
            <div className="field span-2">
              <span className="field-label">密码</span>
              <input
                className="input"
                type="password"
                value={password}
                placeholder="输入保险箱密码"
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canDecrypt) startDecrypt();
                }}
                disabled={busy}
              />
            </div>
          </div>

          <div className="form-footer">
            <button
              className="btn btn-primary btn-lg"
              disabled={!canDecrypt}
              onClick={startDecrypt}
            >
              开始解密
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 网盘「传输任务」式进度卡片 */
function TaskCard({
  phase,
  name,
  progress: p,
  speed,
  onCancel,
  cancelling,
}: {
  phase: "encrypt" | "decrypt";
  name: string;
  progress: ProgressEvent | null;
  speed: number;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const pct = p && p.bytesTotal > 0 ? Math.min(100, (p.bytesDone / p.bytesTotal) * 100) : 0;
  return (
    <div className="card task-card">
      <div className="task-head">
        <span className="task-head-icon">
          <BoxIcon />
        </span>
        <div>
          <div className="task-head-name">{name}</div>
          <div className="task-head-sub">
            {phase === "encrypt" ? "正在加密" : "正在解密"}
            {p ? ` · ${p.filesDone} / ${p.filesTotal} 个文件` : " · 准备中…"}
          </div>
        </div>
        <span className="task-pct">{pct.toFixed(1)}%</span>
        <button className="btn btn-sm" onClick={onCancel} disabled={cancelling}>
          {cancelling ? "取消中…" : "取消"}
        </button>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="task-meta">
        <span>
          {p ? `${fmtBytes(p.bytesDone)} / ${fmtBytes(p.bytesTotal)}` : ""}
        </span>
        {speed > 1 && <span>{fmtBytes(speed)}/s</span>}
      </div>
      {p?.currentFile && <div className="task-file">正在处理：{p.currentFile}</div>}
    </div>
  );
}

/* ---------- 小图标 ---------- */
function BoxIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3 4 6.8v10.4L12 21l8-3.8V6.8L12 3Z"
        stroke="#06a7ff"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M4 6.8 12 10.5l8-3.7M12 10.5V21" stroke="#06a7ff" strokeWidth="1.7" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="m5 12.5 4.5 4.5L19 7.5"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden style={{ flex: "none", marginTop: 2 }}>
      <path
        d="M12 4 2.8 20h18.4L12 4Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M12 10v4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="17" r="1.1" fill="currentColor" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 11v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="7.8" r="1.1" fill="currentColor" />
    </svg>
  );
}

function RenameIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="m14.5 5.5 4 4L8 20H4v-4L14.5 5.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="m12.5 7.5 4 4" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
