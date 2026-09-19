import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { tools } from "../registry";
import { showToast } from "../../components/Toast";
import Switch from "../../components/Switch";
import Dropdown from "../../components/Dropdown";

interface AppSettings {
  close_to_tray: boolean;
  remember_window: boolean;
  hotkey_enabled: boolean;
  search_excludes: string[];
  search_exclude_exts: string[];
}

const START_PAGE_KEY = "omnikit.startPage";

export default function Settings() {
  const [closeToTray, setCloseToTray] = useState(false);
  const [rememberWin, setRememberWin] = useState(true);
  const [autoStart, setAutoStart] = useState(false);
  const [hotkey, setHotkey] = useState(true);
  const [searchExcludes, setSearchExcludes] = useState("");
  const [searchExts, setSearchExts] = useState("");
  const [startPage, setStartPage] = useState(localStorage.getItem(START_PAGE_KEY) ?? "last");

  useEffect(() => {
    invoke<AppSettings>("settings_get")
      .then((s) => {
        setCloseToTray(s.close_to_tray);
        setRememberWin(s.remember_window);
        setHotkey(s.hotkey_enabled);
        setSearchExcludes(s.search_excludes.join("\n"));
        setSearchExts(s.search_exclude_exts.join("\n"));
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

  async function setHotkeyRun(v: boolean) {
    setHotkey(v);
    try {
      await invoke("settings_set", { hotkeyEnabled: v });
    } catch (e) {
      showToast(String(e), "error");
    }
  }

  function saveSearchRules() {
    invoke("settings_set", {
      searchExcludes: searchExcludes
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean),
      searchExcludeExts: searchExts
        .split("\n")
        .map((x) => x.trim().replace(/^\./, ""))
        .filter(Boolean),
    }).catch((e) => showToast(String(e), "error"));
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
        <span className="field-label">快捷键</span>
        <div className="kv-list">
          <div className="kv-row">
            <span className="kv-k" style={{ minWidth: 170 }}>
              全局快捷键唤起窗口
            </span>
            <span className="hint" style={{ flex: 1 }}>
              在任何应用里按 Alt+Q，随时显示或隐藏 OmniKit
            </span>
            <Switch on={hotkey} onChange={setHotkeyRun} />
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
            <Dropdown
              width={220}
              value={startPage}
              onChange={setStart}
              options={
                [{ value: "last", label: "记住上次页面" }, ...tools.map((t) => ({ value: t.id, label: t.name }))]
              }
            />
          </div>
        </div>
      </div>

      <div className="field">
        <span className="field-label">文件搜索 · 排除规则</span>
        <div className="kv-list">
          <div className="kv-row">
            <span className="kv-k" style={{ minWidth: 90 }}>关键字</span>
            <span className="hint" style={{ flex: 1 }}>
              文件或文件夹的完整路径包含以下关键字时跳过，每行一条
            </span>
          </div>
          <div className="kv-row">
            <textarea
              className="textarea input-mono"
              style={{ height: 110, flex: 1 }}
              value={searchExcludes}
              onChange={(e) => setSearchExcludes(e.target.value)}
              onBlur={saveSearchRules}
              spellCheck={false}
            />
          </div>
          <div className="kv-row">
            <span className="kv-k" style={{ minWidth: 90 }}>后缀</span>
            <span className="hint" style={{ flex: 1 }}>
              这些扩展名的文件不进入索引，每行一个（不带点）
            </span>
          </div>
          <div className="kv-row">
            <textarea
              className="textarea input-mono"
              style={{ height: 70, flex: 1 }}
              value={searchExts}
              onChange={(e) => setSearchExts(e.target.value)}
              onBlur={saveSearchRules}
              spellCheck={false}
            />
          </div>
          <div className="kv-row">
            <span className="hint">修改后自动保存；改动只影响下次建立的索引</span>
          </div>
        </div>
      </div>

      <div className="field">
        <span className="field-label">关于</span>
        <div className="kv-list">
          <div className="kv-row">
            <span className="kv-k" style={{ minWidth: 170 }}>
              OmniKit
            </span>
            <span className="hint">
              v0.8.0 · 百宝工具箱 · 全部功能本地处理，数据不出设备
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
