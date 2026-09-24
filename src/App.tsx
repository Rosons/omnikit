import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { tools, GROUPS, type ToolGroup, type ToolModule } from "./tools/registry";
import { ToastHost, showToast } from "./components/Toast";
import { ConfirmHost } from "./components/ConfirmDialog";
import Settings from "./tools/settings/Settings";
import { ErrorBoundary } from "./components/ErrorBoundary";

const COLLAPSE_KEY = "omnikit.sidebar.collapsed";
const FAVS_KEY = "omnikit.favs";

function loadCollapsed(): Set<ToolGroup> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    return raw ? new Set(JSON.parse(raw) as ToolGroup[]) : new Set();
  } catch {
    return new Set();
  }
}

function loadFavs(): string[] {
  try {
    const raw = localStorage.getItem(FAVS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((id: string) => tools.some((t) => t.id === id)) : [];
  } catch {
    return [];
  }
}

function loadStartPage(): string {
  const sp = localStorage.getItem("omnikit.startPage") ?? "last";
  if (sp !== "last" && tools.some((t) => t.id === sp)) return sp;
  const last = localStorage.getItem("omnikit.lastPage");
  if (last && tools.some((t) => t.id === last)) return last;
  return tools[0].id;
}

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [activeId, setActiveId] = useState(loadStartPage);
  const active = tools.find((t) => t.id === activeId) ?? tools[0];
  const ActiveIcon = active.icon;
  const ActiveComponent = active.component;
  const [collapsed, setCollapsed] = useState<Set<ToolGroup>>(loadCollapsed);
  const [favs, setFavs] = useState<string[]>(loadFavs);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [version, setVersion] = useState("");

  // 折叠状态持久化
  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed]));
  }, [collapsed]);
  // 记录上次页面,供「记住上次页面」启动项使用
  useEffect(() => {
    localStorage.setItem("omnikit.lastPage", activeId);
  }, [activeId]);

  // 切换到某工具时,自动展开其所在分组
  useEffect(() => {
    const t = tools.find((x) => x.id === activeId);
    if (t) {
      setCollapsed((s) => {
        if (!s.has(t.group)) return s;
        const n = new Set(s);
        n.delete(t.group);
        return n;
      });
    }
  }, [activeId]);

  // 其他页面可发起切换(如文件管理 → 去解密)
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (id && tools.some((t) => t.id === id)) {
        setActiveId(id);
        setShowSettings(false);
      }
    };
    window.addEventListener("omnikit:navigate", handler);
    return () => window.removeEventListener("omnikit:navigate", handler);
  }, []);

  // 托盘「剪贴板历史」直达:恢复窗口后由后端发来切页事件
  useEffect(() => {
    const un = listen<string>("omnikit://goto", (e) => {
      if (tools.some((t) => t.id === e.payload)) {
        setActiveId(e.payload);
        setShowSettings(false);
      }
    });
    return () => {
      un.then((fn) => fn());
    };
  }, []);

  // Ctrl/Cmd+K 命令面板
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  // 版本号取自应用本体,与打包配置天然一致
  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  // 启动时静默检查更新(每天最多一次,可在设置里关)
  useEffect(() => {
    const KEY_LAST = "omnikit.update.last";
    if (localStorage.getItem("omnikit.update.auto") === "off") return;
    const last = Number(localStorage.getItem(KEY_LAST) ?? 0);
    if (Date.now() - last < 24 * 3600 * 1000) return;
    localStorage.setItem(KEY_LAST, String(Date.now()));
    invoke<{ has_update: boolean; latest: string; current: string }>("update_check")
      .then((r) => {
        const msg = r.has_update ? `发现新版本 v${r.latest}` : `已是最新版本 v${r.current}`;
        localStorage.setItem(
          "omnikit.update.lastResult",
          JSON.stringify({ t: Date.now(), ok: true, msg }),
        );
        if (r.has_update) {
          showToast(`发现新版本 v${r.latest}，可在设置页查看并前往下载`, "info", 6000);
        }
      })
      .catch((e) => {
        localStorage.setItem(
          "omnikit.update.lastResult",
          JSON.stringify({ t: Date.now(), ok: false, msg: String(e).slice(0, 300) }),
        );
      });
  }, []);

  function openTool(id: string) {
    setActiveId(id);
    setShowSettings(false);
    setPaletteOpen(false);
  }

  function toggleFav(id: string) {
    setFavs((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      localStorage.setItem(FAVS_KEY, JSON.stringify(next));
      return next;
    });
  }

  function toggleGroup(g: ToolGroup) {
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(g)) n.delete(g);
      else n.add(g);
      return n;
    });
  }

  function renderToolItem(tool: ToolModule) {
    const Icon = tool.icon;
    return (
      <button
        key={tool.id}
        className={`tool-item${tool.id === activeId && !showSettings ? " active" : ""}`}
        onClick={() => openTool(tool.id)}
      >
        <span className="tool-icon">
          <Icon size={15} />
        </span>
        <span className="tool-name">{tool.name}</span>
        <span
          className={`fav-star${favs.includes(tool.id) ? " on" : ""}`}
          role="button"
          tabIndex={-1}
          title={favs.includes(tool.id) ? "取消常用" : "设为常用"}
          onClick={(e) => {
            e.stopPropagation();
            toggleFav(tool.id);
          }}
        >
          {favs.includes(tool.id) ? "★" : "☆"}
        </span>
      </button>
    );
  }

  const favTools = tools.filter((t) => favs.includes(t.id));

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M6.5 7L12 11.6L6.5 16.2"
                stroke="#ffffff"
                strokeWidth="2.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <rect x="13.6" y="14.8" width="6.4" height="2.7" rx="1.35" fill="#ffffff" />
            </svg>
          </div>
          <div>
            <div className="brand-name">OmniKit</div>
            <div className="brand-sub">百宝工具箱</div>
          </div>
        </div>

        <nav className="tool-list">
          {favTools.length > 0 && (
            <div className="tool-group">
              <div className="group-head group-head-static">
                <span>常用</span>
              </div>
              {favTools.map(renderToolItem)}
            </div>
          )}
          {GROUPS.map((g) => {
            const items = tools.filter((t) => t.group === g.id);
            const isCollapsed = collapsed.has(g.id);
            return (
              <div className="tool-group" key={g.id}>
                <button
                  className={`group-head${isCollapsed ? "" : " open"}`}
                  onClick={() => toggleGroup(g.id)}
                  title={isCollapsed ? "展开分组" : "折叠分组"}
                >
                  <span>{g.name}</span>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                    <path
                      d="M2 3.5L5 6.5L8 3.5"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                {!isCollapsed && items.map(renderToolItem)}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-settings">
          <button
            className={"tool-item" + (showSettings ? " active" : "")}
            onClick={() => setShowSettings(true)}
          >
            <span className="tool-icon">
              <GearIcon size={15} />
            </span>
            <span className="tool-name">设置</span>
          </button>
        </div>
        <div className="sidebar-footer">
          OmniKit{version ? ` v${version}` : ""} · 本地处理，数据不出设备
        </div>
      </aside>

      <main className="main">
        <header className="main-header">
          <h1 className="main-title">{showSettings ? "设置" : active.name}</h1>
          <p className="main-desc">
            {showSettings ? "应用偏好设置" : active.desc}
          </p>
          <button
            className="btn btn-sm header-search"
            onClick={() => setPaletteOpen(true)}
            title="快速打开工具"
          >
            快速打开 <span className="kbd">Ctrl K</span>
          </button>
        </header>
        <div className="main-body">
          {showSettings ? (
            <Settings />
          ) : (
            <ErrorBoundary key={activeId}>
              <Suspense fallback={<Loading />}>
                <ActiveComponent />
              </Suspense>
            </ErrorBoundary>
          )}
        </div>
      </main>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onPick={openTool}
        favs={favs}
        onToggleFav={toggleFav}
      />
      <ToastHost />
      <ConfirmHost />
    </div>
  );
}

/** Ctrl+K 快速切换工具的命令面板 */
function CommandPalette({
  open,
  onClose,
  onPick,
  favs,
  onToggleFav,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (id: string) => void;
  favs: string[];
  onToggleFav: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = s
      ? tools.filter((t) => (t.name + t.desc + t.id).toLowerCase().includes(s))
      : [...tools].sort(
          (a, b) => Number(favs.includes(b.id)) - Number(favs.includes(a.id)),
        );
    return base.slice(0, 10);
  }, [q, favs]);

  useEffect(() => {
    setSel(0);
  }, [q]);

  if (!open) return null;

  return (
    <div className="palette-mask" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="input palette-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="输入名称快速打开工具"
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, list.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") {
              const t = list[sel];
              if (t) onPick(t.id);
            } else if (e.key === "Escape") {
              onClose();
            }
          }}
        />
        <div className="palette-list">
          {list.map((t, i) => {
            const Icon = t.icon;
            return (
              <div
                key={t.id}
                className={`palette-item${i === sel ? " active" : ""}`}
                onMouseEnter={() => setSel(i)}
                onClick={() => onPick(t.id)}
              >
                <span className="tool-icon">
                  <Icon size={15} />
                </span>
                <span className="palette-name">{t.name}</span>
                <span className="palette-desc">{t.desc}</span>
                <span
                  className={`palette-fav${favs.includes(t.id) ? " on" : ""}`}
                  role="button"
                  title={favs.includes(t.id) ? "取消常用" : "设为常用"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFav(t.id);
                  }}
                >
                  {favs.includes(t.id) ? "★" : "☆"}
                </span>
              </div>
            );
          })}
          {list.length === 0 && <div className="palette-empty">没有匹配的工具</div>}
        </div>
        <div className="palette-foot">
          <span>↑↓ 选择 · Enter 打开 · Esc 关闭</span>
          <span>标 ★ 的工具会置顶在侧栏「常用」</span>
        </div>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="loading">
      <div className="spinner" />
    </div>
  );
}

function GearIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" fill="#9fcdfb" />
      <path
        d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"
        fill="#06a7ff"
      />
    </svg>
  );
}
