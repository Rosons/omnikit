import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { tools, GROUPS, type ToolGroup, type ToolModule } from "./tools/registry";
import { purgeLegacyKeys } from "./lib/backup";
import { saveThemeMode, applyTheme, type ThemeMode } from "./lib/theme";

/** 命令面板里的动作:非工具页的即时操作,集中注册,新动作在此数组加一行 */
interface PaletteAction {
  id: string;
  name: string;
  desc: string;
  run: () => void;
}
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
  // 自定义标题栏:窗口置顶与最大化状态
  const [pinned, setPinned] = useState(
    () => localStorage.getItem("omnikit.alwaysOnTop") === "on",
  );
  const [isMax, setIsMax] = useState(false);
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
    purgeLegacyKeys();
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

  // 命令面板的动作集:设置入口 + 即时操作。新增动作在此加一行即可
  const paletteActions: PaletteAction[] = [
    {
      id: "act-settings",
      name: "设置",
      desc: "应用偏好设置",
      run: () => {
        setShowSettings(true);
        setPaletteOpen(false);
      },
    },
    {
      id: "act-theme",
      name: "切换深浅色主题",
      desc: "在浅色与深色之间切换",
      run: () => {
        const next: ThemeMode =
          document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        saveThemeMode(next);
        applyTheme(next);
        showToast(`已切换到${next === "dark" ? "深色" : "浅色"}主题`, "success", 2000);
      },
    },
    {
      id: "act-clip-pause",
      name: "暂停/恢复剪贴板监听",
      desc: "临时停止或继续记录剪贴板历史",
      run: () => {
        invoke<boolean>("clip_toggle_pause")
          .then((paused) =>
            showToast(paused ? "已暂停剪贴板监听" : "已恢复剪贴板监听", "success", 2000),
          )
          .catch((e) => showToast(String(e), "error"));
      },
    },
    {
      id: "act-log",
      name: "打开日志文件夹",
      desc: "查看运行与错误日志",
      run: () => invoke("open_log_dir").catch((e) => showToast(String(e), "error")),
    },
    {
      id: "act-hide",
      name: "隐藏窗口",
      desc: "收到系统托盘继续后台运行",
      run: () => getCurrentWindow().hide().catch(() => {}),
    },
    {
      id: "act-check-update",
      name: "检查更新",
      desc: "查询 GitHub 上的最新发布版本",
      run: () => {
        invoke<{ current: string; version: string } | null>("updater_check")
          .then((avail) =>
            showToast(
              avail ? `发现新版本 v${avail.version}，到设置页下载安装` : "已是最新版本",
              avail ? "info" : "success",
              4000,
            ),
          )
          .catch((e) => showToast(String(e), "error", 4000));
      },
    },
  ];

  function toggleFav(id: string) {
    setFavs((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      localStorage.setItem(FAVS_KEY, JSON.stringify(next));
      return next;
    });
  }

  // 收藏变化后重建托盘右键菜单,收藏工具点一下直达
  useEffect(() => {
    const items = favs
      .map((id) => tools.find((t) => t.id === id))
      .filter((t): t is ToolModule => Boolean(t))
      .map((t) => [t.id, t.name] as [string, string]);
    invoke("tray_set_favs", { favs: items }).catch(() => {});
  }, [favs]);

  // 启动时恢复置顶状态
  useEffect(() => {
    const w = getCurrentWindow();
    if (pinned) w.setAlwaysOnTop(true).catch(() => {});
    w.isMaximized().then(setIsMax).catch(() => {});
    const un = w.onResized(() => {
      w.isMaximized().then(setIsMax).catch(() => {});
    });
    return () => {
      un.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function togglePin() {
    const v = !pinned;
    setPinned(v);
    localStorage.setItem("omnikit.alwaysOnTop", v ? "on" : "off");
    getCurrentWindow()
      .setAlwaysOnTop(v)
      .catch((e) => showToast(String(e), "error"));
  }

  function titlebarDown(e: React.MouseEvent) {
    // 左键按住空白处拖动窗口;点在按钮上不触发
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    getCurrentWindow().startDragging().catch(() => {});
  }

  function titlebarDbl(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("button")) return;
    getCurrentWindow().toggleMaximize().catch(() => {});
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
      <div className="titlebar" onMouseDown={titlebarDown} onDoubleClick={titlebarDbl}>
        <span className="titlebar-title">OmniKit</span>
        <div className="win-controls">
          <button
            className={`win-btn${pinned ? " on" : ""}`}
            onClick={togglePin}
            title={pinned ? "取消窗口置顶" : "窗口置顶，悬浮在其他应用上面"}
            aria-pressed={pinned}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill={pinned ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              style={pinned ? { transform: "rotate(45deg)" } : undefined}
            >
              <line x1="12" y1="17" x2="12" y2="22" />
              <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
            </svg>
          </button>
          <button
            className="win-btn"
            onClick={() => getCurrentWindow().minimize().catch(() => {})}
            title="最小化"
          >
            <svg width="11" height="11" viewBox="0 0 10 10" aria-hidden>
              <path d="M1.5 5h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
          <button
            className="win-btn"
            onClick={() => getCurrentWindow().toggleMaximize().catch(() => {})}
            title={isMax ? "向下还原" : "最大化"}
          >
            {isMax ? (
              <svg width="11" height="11" viewBox="0 0 10 10" fill="none" aria-hidden>
                <rect x="1" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" />
                <path d="M3.2 1.2h4.6a1 1 0 0 1 1 1v4.6" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 10 10" fill="none" aria-hidden>
                <rect x="1.8" y="1.8" width="6.4" height="6.4" rx="1" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            )}
          </button>
          <button
            className="win-btn win-close"
            onClick={() => getCurrentWindow().close().catch(() => {})}
            title="关闭"
          >
            <svg width="11" height="11" viewBox="0 0 10 10" aria-hidden>
              <path
                d="M1.8 1.8l6.4 6.4M8.2 1.8L1.8 8.2"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>
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
        actions={paletteActions}
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
  actions,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (id: string) => void;
  favs: string[];
  onToggleFav: (id: string) => void;
  actions: PaletteAction[];
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

  // 统一条目:全部工具 + 设置与动作,搜索时一起混入
  const entries = useMemo(() => {
    const list: { kind: "tool" | "action"; id: string; name: string; desc: string; run: () => void; action?: PaletteAction }[] =
      tools.map((t) => ({ kind: "tool", id: t.id, name: t.name, desc: t.desc, run: () => onPick(t.id) }));
    for (const a of actions) {
      list.push({ kind: "action", id: a.id, name: a.name, desc: a.desc, run: a.run, action: a });
    }
    const s = q.trim().toLowerCase();
    const filtered = s
      ? list.filter((e) => (e.name + e.desc + e.id).toLowerCase().includes(s))
      : list;
    // 无关键字时:常用工具置顶,工具在前动作在后
    return filtered
      .sort((a, b) => {
        if (!s) {
          const fa = a.kind === "tool" && favs.includes(a.id) ? 1 : 0;
          const fb = b.kind === "tool" && favs.includes(b.id) ? 1 : 0;
          if (fa !== fb) return fb - fa;
          if (a.kind !== b.kind) return a.kind === "tool" ? -1 : 1;
        }
        return 0;
      })
      .slice(0, 10);
  }, [q, favs, actions, onPick]);

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
          placeholder="搜索工具、设置与动作"
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, entries.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") {
              const t = entries[sel];
              if (t) {
                t.run();
                if (t.kind === "action") onClose();
              }
            } else if (e.key === "Escape") {
              onClose();
            }
          }}
        />
        <div className="palette-list">
          {entries.map((e, i) => {
            const tool = e.kind === "tool" ? tools.find((t) => t.id === e.id) : null;
            const Icon = tool?.icon;
            return (
              <div
                key={e.id}
                className={`palette-item${i === sel ? " active" : ""}`}
                onMouseEnter={() => setSel(i)}
                onClick={() => {
                  e.run();
                  if (e.kind === "action") onClose();
                }}
              >
                <span className="tool-icon">
                  {Icon ? (
                    <Icon size={15} />
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M13 2L4.5 13.5H11L9.5 22L19.5 9.5H12.5z"
                        fill="#06a7ff"
                      />
                    </svg>
                  )}
                </span>
                <span className="palette-name">{e.name}</span>
                <span className="palette-desc">{e.desc}</span>
                {e.kind === "action" && <span className="palette-tag">动作</span>}
                {tool && (
                  <span
                    className={`palette-fav${favs.includes(tool.id) ? " on" : ""}`}
                    role="button"
                    title={favs.includes(tool.id) ? "取消常用" : "设为常用"}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onToggleFav(tool.id);
                    }}
                  >
                    {favs.includes(tool.id) ? "★" : "☆"}
                  </span>
                )}
              </div>
            );
          })}
          {entries.length === 0 && <div className="palette-empty">没有匹配的工具</div>}
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
