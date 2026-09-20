import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { tools } from "../registry";
import { showToast } from "../../components/Toast";
import Switch from "../../components/Switch";
import Dropdown from "../../components/Dropdown";
import { loadThemeMode, saveThemeMode, type ThemeMode } from "../../lib/theme";

interface AppSettings {
  close_to_tray: boolean;
  remember_window: boolean;
  hotkey_enabled: boolean;
  search_excludes: string[];
  search_exclude_exts: string[];
}

interface UpdateInfo {
  current: string;
  latest: string;
  notes: string;
  url: string;
  has_update: boolean;
}

const START_PAGE_KEY = "omnikit.startPage";
const AUTO_UPDATE_KEY = "omnikit.update.auto";

export default function Settings() {
  const [closeToTray, setCloseToTray] = useState(false);
  const [rememberWin, setRememberWin] = useState(true);
  const [autoStart, setAutoStart] = useState(false);
  const [hotkey, setHotkey] = useState(true);
  const [searchExcludes, setSearchExcludes] = useState("");
  const [searchExts, setSearchExts] = useState("");
  const [startPage, setStartPage] = useState(localStorage.getItem(START_PAGE_KEY) ?? "last");
  const [theme, setTheme] = useState<ThemeMode>(loadThemeMode);
  const [version, setVersion] = useState("");
  const [autoUpdate, setAutoUpdate] = useState(
    localStorage.getItem(AUTO_UPDATE_KEY) !== "off",
  );
  const [checking, setChecking] = useState(false);
  const [updateMsg, setUpdateMsg] = useState("");
  const [updateUrl, setUpdateUrl] = useState("");
  // 应用内更新(需 Release 里有签名的 latest.json;没有时退回版本比较+下载页)
  const [updater, setUpdater] = useState<Update | null>(null);
  const [dlMsg, setDlMsg] = useState("");

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
    getVersion().then(setVersion).catch(() => {});
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

  function setThemeMode(v: string) {
    setTheme(v as ThemeMode);
    saveThemeMode(v as ThemeMode);
  }

  function setAutoUpdateRun(v: boolean) {
    setAutoUpdate(v);
    localStorage.setItem(AUTO_UPDATE_KEY, v ? "on" : "off");
  }

  function checkUpdate() {
    setChecking(true);
    setUpdateMsg("");
    setUpdateUrl("");
    setUpdater(null);
    setDlMsg("");
    localStorage.setItem("omnikit.update.last", String(Date.now()));
    (async () => {
      try {
        // 优先走更新器插件(读 Release 上的 latest.json,可应用内安装)
        const u = await check();
        if (u) {
          setUpdater(u);
          setUpdateMsg(`发现新版本 v${u.version}（当前 v${version || "…"}）`);
        } else {
          setUpdateMsg(`已是最新版本 v${version || "…"}`);
        }
        return;
      } catch {
        // latest.json 尚未发布或网络失败:退回 GitHub API 版本比较
      }
      try {
        const r = await invoke<UpdateInfo>("update_check");
        if (r.has_update) {
          setUpdateMsg(`发现新版本 v${r.latest}（当前 v${r.current}）`);
          setUpdateUrl(r.url);
        } else {
          setUpdateMsg(`已是最新版本 v${r.current}`);
        }
      } catch (e) {
        setUpdateMsg(String(e));
        invoke("log_append", {
          level: "warn",
          source: "updater",
          message: `检查更新失败：${String(e)}`.slice(0, 400),
        }).catch(() => {});
      }
    })().finally(() => setChecking(false));
  }

  async function installUpdate() {
    if (!updater) return;
    setDlMsg("准备下载…");
    let received = 0;
    try {
      await updater.downloadAndInstall((evt) => {
        if (evt.event === "Started") {
          received = 0;
          setDlMsg("开始下载…");
        } else if (evt.event === "Progress") {
          received += evt.data.chunkLength;
          setDlMsg(`下载中 ${(received / 1024 / 1024).toFixed(1)} MB`);
        } else if (evt.event === "Finished") {
          setDlMsg("下载完成，正在安装…");
        }
      });
      setDlMsg("安装完成，即将重启…");
      await invoke("restart_app");
    } catch (e) {
      setDlMsg("");
      showToast(String(e), "error", 6000);
      invoke("log_append", {
        level: "error",
        source: "updater",
        message: `更新下载/安装失败：${String(e)}`.slice(0, 500),
      }).catch(() => {});
    }
  }

  function goDownload() {
    invoke("open_url", { url: updateUrl }).catch((e) => showToast(String(e), "error"));
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
        <span className="field-label">外观</span>
        <div className="kv-list">
          <div className="kv-row">
            <span className="kv-k" style={{ minWidth: 170 }}>
              界面主题
            </span>
            <span className="hint" style={{ flex: 1 }}>
              跟随系统时，系统切换深浅色会实时同步
            </span>
            <Dropdown
              width={140}
              value={theme}
              onChange={setThemeMode}
              options={[
                { value: "system", label: "跟随系统" },
                { value: "light", label: "浅色" },
                { value: "dark", label: "深色" },
              ]}
            />
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
        <span className="field-label">更新</span>
        <div className="kv-list">
          <div className="kv-row">
            <span className="kv-k" style={{ minWidth: 170 }}>
              启动时检查更新
            </span>
            <span className="hint" style={{ flex: 1 }}>
              每天最多检查一次，只查询版本号，不上传任何数据
            </span>
            <Switch on={autoUpdate} onChange={setAutoUpdateRun} />
          </div>
          <div className="kv-row">
            <span className="kv-k" style={{ minWidth: 170 }}>
              检查更新
            </span>
            <span className="hint" style={{ flex: 1 }}>
              {dlMsg || updateMsg || "查询 GitHub 上的最新发布版本，可直接下载安装"}
            </span>
            {updater && !dlMsg && (
              <button className="btn btn-sm btn-primary" onClick={installUpdate}>
                下载并安装
              </button>
            )}
            {updateUrl && !updater && (
              <button className="btn btn-sm btn-primary" onClick={goDownload}>
                前往下载页
              </button>
            )}
            <button className="btn btn-sm" onClick={checkUpdate} disabled={checking}>
              {checking ? "检查中…" : "立即检查"}
            </button>
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
            <span className="hint" style={{ flex: 1 }}>
              {version ? `v${version} · ` : ""}百宝工具箱 · 全部功能本地处理，数据不出设备
            </span>
          </div>
          <div className="kv-row">
            <span className="kv-k" style={{ minWidth: 170 }}>
              运行日志
            </span>
            <span className="hint" style={{ flex: 1 }}>
              页面异常会记录到本地日志文件，便于反馈排查
            </span>
            <button
              className="btn btn-sm"
              onClick={() =>
                invoke("open_log_dir").catch((e) => showToast(String(e), "error"))
              }
            >
              打开日志文件夹
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
