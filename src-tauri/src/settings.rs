//! 应用设置:持久化到 %APPDATA%/settings.json,供托盘关闭行为、窗口几何恢复等使用
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Copy)]
pub struct WindowGeom {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
    pub maximized: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct AppSettings {
    pub close_to_tray: bool,
    pub remember_window: bool,
    pub hotkey_enabled: bool,
    pub window: Option<WindowGeom>,
    #[serde(default = "default_search_excludes")]
    pub search_excludes: Vec<String>,
    #[serde(default = "default_search_exclude_exts")]
    pub search_exclude_exts: Vec<String>,
    /// 剪贴板历史是否加密落盘
    pub clip_persist: bool,
}

pub fn default_search_excludes() -> Vec<String> {
    [
        "node_modules",
        ".git",
        ".venv",
        "__pycache__",
        "$recycle.bin",
        "system volume information",
        "pagefile.sys",
        "hiberfil.sys",
        "swapfile.sys",
    ]
    .into_iter()
    .map(String::from)
    .collect()
}

pub fn default_search_exclude_exts() -> Vec<String> {
    ["tmp", "temp", "lnk"]
        .into_iter()
        .map(String::from)
        .collect()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            close_to_tray: false,
            remember_window: true,
            hotkey_enabled: true,
            window: None,
            search_excludes: default_search_excludes(),
            search_exclude_exts: default_search_exclude_exts(),
            clip_persist: true,
        }
    }
}

pub struct SettingsState(pub Mutex<AppSettings>);

fn settings_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("settings.json"))
}

pub fn load(app: &AppHandle) -> AppSettings {
    let Some(p) = settings_path(app) else {
        return AppSettings::default();
    };
    fs::read_to_string(p)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, s: &AppSettings) {
    let Some(p) = settings_path(app) else { return };
    if let Some(dir) = p.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(t) = serde_json::to_string_pretty(s) {
        let tmp = p.with_extension("json.tmp");
        if fs::write(&tmp, t).is_ok() {
            let _ = fs::rename(&tmp, &p);
        }
    }
}

#[tauri::command]
pub fn settings_get(state: tauri::State<'_, SettingsState>) -> AppSettings {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
pub fn settings_set(
    state: tauri::State<'_, SettingsState>,
    app: AppHandle,
    close_to_tray: Option<bool>,
    remember_window: Option<bool>,
    hotkey_enabled: Option<bool>,
    search_excludes: Option<Vec<String>>,
    search_exclude_exts: Option<Vec<String>>,
) -> Result<(), String> {
    let mut s = state.0.lock().unwrap().clone();
    if let Some(v) = close_to_tray {
        s.close_to_tray = v;
    }
    if let Some(v) = remember_window {
        s.remember_window = v;
    }
    if let Some(v) = hotkey_enabled {
        s.hotkey_enabled = v;
        if v {
            let _ = crate::register_hotkey(&app);
        } else {
            use tauri_plugin_global_shortcut::GlobalShortcutExt;
            let _ = app.global_shortcut().unregister("Alt+Q");
        }
    }
    if let Some(v) = search_excludes {
        s.search_excludes = v;
    }
    if let Some(v) = search_exclude_exts {
        s.search_exclude_exts = v;
    }
    save(&app, &s);
    *state.0.lock().unwrap() = s;
    Ok(())
}
