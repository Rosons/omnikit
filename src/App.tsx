import { Suspense, useEffect, useState } from "react";
import { tools } from "./tools/registry";
import { ToastHost } from "./components/Toast";
import { ConfirmHost } from "./components/ConfirmDialog";

export default function App() {
  const [activeId, setActiveId] = useState(tools[0].id);
  const active = tools.find((t) => t.id === activeId) ?? tools[0];
  const ActiveIcon = active.icon;
  const ActiveComponent = active.component;

  // 其他页面可发起切换(如文件管理 → 去解密)
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (id && tools.some((t) => t.id === id)) setActiveId(id);
    };
    window.addEventListener("devtoolbox:navigate", handler);
    return () => window.removeEventListener("devtoolbox:navigate", handler);
  }, []);

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
          {tools.map((tool) => {
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
