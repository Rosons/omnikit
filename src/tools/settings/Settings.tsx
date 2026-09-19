import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { tools } from "../registry";
import { showToast } from "../../components/Toast";
import Switch from "../../components/Switch";

interface AppSettings {
  close_to_tray: boolean;
  remember_window: boolean;
}

const START_PAGE_KEY = "devtoolbox.startPage";

export default function Settings() {
  const [closeToTray, setCloseToTray] = useState(false);
  const [rememberWin, setRememberWin] = useState(true);
  const [autoStart, setAutoStart] = useState(false);
  const [startPage, setStartPage] = useState(localStorage.getItem(START_PAGE_KEY) ?? "last");

  useEffect(() => {
    invoke<AppSettings>("settings_get")
      .then((s) => {
        setCloseToTray(s.close_to_tray);
        setRememberWin(s.remember_window);
      })
      .catch(() => {});
    isEnabled()
      .then(setAutoStart)
      .catch(() => {});
  }, []);

  async function setClose(v: boolean) {
    setCloseToTray(v);
    try {
      await invoke("settings_set", { closeToTray: v });
    } catch (e) {
      showToast(String(e), "error");
    }
  }

  async function setRemember(v: boolean) {
    setRememberWin(v);
    try {
      await invoke("settings_set", { rememberWindow: v });
    } catch (e) {
      showToast(String(e), "error");
    }
  }

  async function setAuto(v: boolean) {
    try {
      if (v) await enable();
      else await disable();
      setAutoStart(v);
    } catch (e) {
      showToast(String(e), "error", 5000);
    }
  }

  function setStart(v: string) {
    setStartPage(v);
    localStorage.setItem(START_PAGE_KEY, v);
  }

  return (
    <div className="stack">
      <div className="field">
        <span className="field-label">窗口与托盘</span>
        <div className="kv-list">
          <div className="kv-row">
            <span className="kv-k" style={{ minWidth: 170 }}>
              关闭时最小化到托盘
            </span>
            <span className="hint" style={{ flex: 1 }}>
              关闭窗口后保留在系统托盘，左键托盘图标恢复，右键菜单退出
            </span>
            <Switch on={closeToTray} onChange={setClose} />
          </div>
          <div className="kv-row">
            <span className="kv-k" style={{ minWidth: 170 }}>
              记住窗口大小和位置
            </span>
            <span className="hint" style={{ flex: 1 }}>
              下次启动恢复上次关闭时的窗口布局
            </span>
            <Switch on={rememberWin} onChange={setRemember} />
          </div>
          <div className="kv-row">
            <span className="kv-k" style={{ minWidth: 170 }}>
              开机自动启动
            </span>
            <span className="hint" style={{ flex: 1 }}>
              写入当前用户的启动项，仅对当前账户生效
            </span>
            <Switch on={autoStart} onChange={setAuto} />
          </div>
        </div>
      </div>

      <div className="field">
        <span className="field-label">启动页</span>
        <div className="kv-list">
          <div className="kv-row">
            <span className="kv-k" style={{ minWidth: 170 }}>
              启动时打开
            </span>
            <select
              className="input"
              style={{ width: 200, height: 28 }}
              value={startPage}
              onChange={(e) => setStart(e.target.value)}
            >
              <option value="last">记住上次页面</option>
              {tools.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="field">
        <span className="field-label">关于</span>
        <div className="kv-list">
          <div className="kv-row">
            <span className="kv-k" style={{ minWidth: 170 }}>
              DevToolbox
            </span>
            <span className="hint">
              v0.1.0 · 开发者个人工具箱 · 全部功能本地处理，数据不出设备
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
