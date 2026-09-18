import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open, save } from "@tauri-apps/plugin-dialog";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { showToast } from "../../components/Toast";
import CopyButton from "../../components/CopyButton";
import { baseName } from "../../lib/format";

const SUBTABS = [
  { id: "gen", name: "生成" },
  { id: "scan", name: "识别" },
] as const;

type SubTab = (typeof SUBTABS)[number]["id"];

export default function QrTool() {
  const [tab, setTab] = useState<SubTab>("gen");
  return (
    <div>
      <div className="seg seg-sm" role="tablist">
        {SUBTABS.map((t) => (
          <button
            key={t.id}
            className={`seg-btn${tab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.name}
          </button>
        ))}
      </div>
      {tab === "gen" ? <GenView /> : <ScanView active={tab === "scan"} />}
    </div>
  );
}

/* ---------- 生成 ---------- */
function GenView() {
  const [text, setText] = useState("");
  const [hasQr, setHasQr] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  async function generate() {
    const canvas = canvasRef.current;
    if (!canvas || !text.trim()) return;
    try {
      await QRCode.toCanvas(canvas, text, {
        width: 528,
        margin: 3,
        errorCorrectionLevel: "M",
        color: { dark: "#1f2329", light: "#ffffff" },
      });
      setHasQr(true);
    } catch (e) {
      setHasQr(false);
      showToast(`生成失败：${String(e)}`, "error", 5000);
    }
  }

  async function saveImage() {
    const canvas = canvasRef.current;
    if (!canvas || !hasQr) return;
    const target = await save({
      title: "保存二维码",
      defaultPath: "二维码.png",
      filters: [{ name: "PNG 图片", extensions: ["png"] }],
    });
    if (typeof target !== "string" || !target) return;
    try {
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("画布导出失败"))), "image/png"),
      );
      const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
      await invoke("save_data_file", { path: target, bytes });
      showToast(`已保存到 ${baseName(target)}`, "success");
    } catch (e) {
      showToast(String(e), "error", 5000);
    }
  }

  return (
    <div className="stack">
      <div className="field">
        <span className="field-label">二维码内容（链接或任意文本）</span>
        <textarea
          className="textarea"
          style={{ height: 92 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="粘贴链接或文本，如 https://example.com"
          spellCheck={false}
        />
      </div>
      <div className="tool-actions">
        <button className="btn btn-primary" onClick={generate} disabled={!text.trim()}>
          生成二维码
        </button>
        <button
          className="btn"
          onClick={() => {
            setText("");
            setHasQr(false);
          }}
        >
          清空
        </button>
      </div>
      <div className="qr-stage" style={{ display: hasQr ? "flex" : "none" }}>
        <canvas ref={canvasRef} />
        <div className="tool-actions">
          <button className="btn" onClick={saveImage}>
            保存图片
          </button>
        </div>
        <div className="hint">手机扫码即可打开链接或查看文本</div>
      </div>
    </div>
  );
}

/* ---------- 识别 ---------- */
interface QrImagePayload {
  base64: string;
  mime: string;
}

function ScanView({ active }: { active: boolean }) {
  const [imgName, setImgName] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  async function decodeBlob(blob: Blob, name: string) {
    setBusy(true);
    setResult(null);
    setImgName(name);
    try {
      const bmp = await createImageBitmap(blob);
      // 超大照片等比缩小后再识别,避免卡顿
      const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("画布不可用");
      ctx.drawImage(bmp, 0, 0, w, h);
      const frame = ctx.getImageData(0, 0, w, h);
      const code = jsQR(frame.data, w, h);
      if (code && code.data) setResult(code.data);
      else showToast("未在图片中识别到二维码", "error", 4000);
    } catch (e) {
      showToast(`图片无法解码：${String(e)}`, "error", 5000);
    } finally {
      setBusy(false);
    }
  }

  async function readPath(path: string) {
    try {
      const img = await invoke<QrImagePayload>("qr_read_image", { path });
      const blob = await (await fetch(`data:${img.mime};base64,${img.base64}`)).blob();
      await decodeBlob(blob, baseName(path));
    } catch (e) {
      showToast(String(e), "error", 5000);
    }
  }

  async function pickImage() {
    if (busy) return;
    const sel = await open({
      multiple: false,
      filters: [
        { name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] },
      ],
    });
    if (typeof sel === "string") readPath(sel);
  }

  // 拖入图片路径走后端读取;仅在识别子页激活时响应
  useEffect(() => {
    if (!active) return;
    let un: (() => void) | undefined;
    let cancelled = false;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "enter" || p.type === "over") setDrag(true);
        else if (p.type === "leave") setDrag(false);
        else if (p.type === "drop") {
          setDrag(false);
          const f = p.paths[0];
          if (f && !busy) readPath(f);
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else un = fn;
      });
    return () => {
      cancelled = true;
      un?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // 支持直接粘贴截图识别
  useEffect(() => {
    if (!active) return;
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of Array.from(items)) {
        if (it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) {
            e.preventDefault();
            decodeBlob(f, "剪贴板图片");
          }
          return;
        }
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <div className="stack">
      <div className="field">
        <div
          className={`dropzone dropzone-sm${drag ? " over" : ""}`}
          onClick={pickImage}
          role="button"
        >
          <div className="dropzone-title">拖入图片，点击选择，或直接 Ctrl+V 粘贴截图</div>
          <div className="dropzone-sub">
            {busy
              ? "识别中…"
              : imgName
                ? result !== null
                  ? `识别成功 · ${imgName}`
                  : ""
                : "支持 PNG、JPG、GIF、WebP、BMP，仅在本机识别"}
          </div>
        </div>
      </div>
      {result !== null && (
        <div className="field">
          <span className="field-label">
            识别结果
            <CopyButton text={result} />
          </span>
          <textarea className="textarea" value={result} readOnly spellCheck={false} />
        </div>
      )}
    </div>
  );
}
