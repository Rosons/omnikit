import { Suspense, useEffect, useState } from "react";
import { tools, GROUPS, type ToolGroup } from "./tools/registry";
import { ToastHost } from "./components/Toast";
import { ConfirmHost } from "./components/ConfirmDialog";

const COLLAPSE_KEY = "devtoolbox.sidebar.collapsed";

function loadCollapsed(): Set<ToolGroup> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    return raw ? new Set(JSON.parse(raw) as ToolGroup[]) : new Set();
  } catch {
    return new Set();
  }
}

export default function App() {
  const [activeId, setActiveId] = useState(tools[0].id);
  const active = tools.find((t) => t.id === activeId) ?? tools[0];
  const ActiveIcon = active.icon;
  const ActiveComponent = active.component;
  const [collapsed, setCollapsed] = useState<Set<ToolGroup>>(loadCollapsed);

  // 折叠状态持久化
  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed]));
  }, [collapsed]);

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
      if (id && tools.some((t) => t.id === id)) setActiveId(id);
    };
    window.addEventListener("devtoolbox:navigate", handler);
    return () => window.removeEventListener("devtoolbox:navigate", handler);
  }, []);

  function toggleGroup(g: ToolGroup) {
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(g)) n.delete(g);
      else n.add(g);
      return n;
    });
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M9 8.5V7a3 3 0 0 1 3-3h.5a3 3 0 0 1 3 3v1.5"
                stroke="#9fcdfb"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <rect x="3" y="8.5" width="18" height="12" rx="2.5" fill="#06a7ff" />
              <rect x="3" y="13.2" width="18" height="2" fill="#e8f6ff" />
              <rect x="10.2" y="12" width="3.6" height="4.4" rx="1" fill="#e8f6ff" />
            </svg>
          </div>
          <div>
            <div className="brand-name">DevToolbox</div>
            <div className="brand-sub">开发者个人工具箱</div>
          </div>
        </div>

        <nav className="tool-list">
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
                {!isCollapsed &&
                  items.map((tool) => {
                    const Icon = tool.icon;
                    return (
                      <button
                        key={tool.id}
                        className={`tool-item${tool.id === activeId ? " active" : ""}`}
                        onClick={() => setActiveId(tool.id)}
                      >
                        <span className="tool-icon">
                          <Icon size={15} />
                        </span>
                        <span className="tool-name">{tool.name}</span>
                      </button>
                    );
                  })}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer">v0.1.0 · 本地处理，数据不出设备</div>
      </aside>

      <main className="main">
        <header className="main-header">
          <h1 className="main-title">{active.name}</h1>
          <p className="main-desc">{active.desc}</p>
        </header>
        <div className="main-body">
          <Suspense fallback={<Loading />}>
            <ActiveComponent />
          </Suspense>
        </div>
      </main>
      <ToastHost />
      <ConfirmHost />
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
