import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import "./styles.css";
import "./lib/theme";

// 全局脚本异常落盘(同一次运行最多记 50 条,防刷屏)
let reportCount = 0;
function report(level: string, message: string) {
  if (reportCount >= 50) return;
  reportCount++;
  invoke("log_append", { level, source: "window", message }).catch(() => {});
}
window.addEventListener("error", (e) => report("error", e.message || "未知脚本错误"));
window.addEventListener("unhandledrejection", (e) =>
  report("error", `未处理的 Promise 拒绝：${String(e.reason)}`),
);

// 启动一条环境信息,方便远程排障时对上版本与系统
import { getVersion } from "@tauri-apps/api/app";
getVersion()
  .then((v) =>
    report("info", `启动 v${v} ${navigator.userAgent}`.slice(0, 300)),
  )
  .catch(() => {});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
