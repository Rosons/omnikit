import { Component, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";

interface State {
  err: Error | null;
}

/** 错误边界:单个工具页崩溃时只降级当前页,不影响应用其他部分 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  // 崩溃信息落盘,便于事后排查远程用户的问题
  componentDidCatch(err: Error) {
    invoke("log_append", {
      level: "error",
      source: "ui",
      message: err.stack ?? err.message,
    }).catch(() => {});
  }

  render() {
    if (this.state.err) {
      return (
        <div className="empty-state">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="9" stroke="#f59e0b" strokeWidth="2" />
            <path
              d="M12 7.5V13M12 16.2V16.4"
              stroke="#f59e0b"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <div className="empty-title">这个页面出了点问题，其他功能不受影响</div>
          <div className="hint" style={{ maxWidth: 420, margin: "0 auto" }}>
            {this.state.err.message || "未知错误"}
          </div>
          <button
            className="btn"
            style={{ marginTop: 14 }}
            onClick={() => this.setState({ err: null })}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
