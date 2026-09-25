mod clip;
mod commands;
mod dns;
mod crypto;
mod error;
mod format;
mod history;
mod lan;
mod mcp;
mod pack;
mod search;
mod settings;
mod unpack;

use settings::SettingsState;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent};

use clip::ClipState;
use mcp::McpState;
use search::SearchState;

/// 注册 Alt+Q 全局快捷键:按一下显示或隐藏主窗口
pub(crate) fn register_hotkey(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    let r = app.global_shortcut().on_shortcut("Alt+Q", |app, _sc, event| {
        if event.state() == ShortcutState::Pressed {
            if let Some(w) = app.get_webview_window("main") {
                if w.is_visible().unwrap_or(false) {
                    let _ = w.hide();
                } else {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        }
    });
    Ok(r?)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 单实例锁必须最先注册:二次启动时唤起已有窗口,新进程随即退出
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(commands::AppState::default())
        .manage(McpState::default())
        .manage(commands::TailState::default())
        .manage(ClipState::default())
        .manage(SearchState::default())
        .manage(lan::LanState::default())
        .invoke_handler(tauri::generate_handler![
            commands::sb_encrypt,
            commands::sb_decrypt,
            commands::sb_scan,
            commands::sb_reveal,
            commands::sb_history_list,
            commands::sb_history_remove,
            commands::sb_history_clear,
            commands::sb_cancel,
            commands::sb_hash_file,
            commands::qr_read_image,
            commands::save_data_file,
            commands::read_text_file,
            commands::net_list_ports,
            commands::net_kill,
            commands::net_probe_tcp,
            commands::net_resolve,
            commands::http_request,
            commands::disk_find_dupes,
            commands::disk_dir_sizes,
            commands::disk_trash,
            commands::rename_list_dir,
            commands::rename_apply,
            commands::sys_overview,
            commands::proc_list,
            commands::log_tail_start,
            commands::log_tail_stop,
            commands::path_exists,
            commands::read_file_base64,
            commands::file_snippet,
            commands::update_check,
            commands::updater_check,
            commands::updater_download,
            commands::open_url,
            commands::open_log_dir,
            commands::tray_set_favs,
            lan::lan_local_ip,
            dns::dns_query,
            lan::lan_probe_start,
            lan::lan_probe_stop,
            commands::log_append,
            commands::restart_app,
            settings::settings_get,
            settings::settings_set,
            clip::clip_list,
            clip::clip_set_paused,
            clip::clip_set_persist,
            clip::clip_write,
            clip::clip_remove,
            clip::clip_clear,
            search::search_start,
            search::search_stop,
            search::search_status,
            search::search_cache_load,
            search::search_query,
            mcp::mcp_connect,
            mcp::mcp_disconnect,
            mcp::mcp_list_tools,
            mcp::mcp_list_resources,
            mcp::mcp_list_prompts,
            mcp::mcp_call_tool,
            mcp::mcp_log
        ])
        .on_window_event(|window, event| {
            // 开启「关闭到托盘」时,主窗口点关闭只是隐藏
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let app = window.app_handle();
                    let close_tray = app.state::<SettingsState>().0.lock().unwrap().close_to_tray;
                    if close_tray {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .setup(|app| {
            // 加载设置并恢复窗口几何(窗口配置为启动不可见,恢复后再显示)
            let s = settings::load(app.handle());
            app.manage(SettingsState(std::sync::Mutex::new(s.clone())));
            if let Some(g) = s.window {
                if let Some(w) = app.get_webview_window("main") {
                    // 校验:尺寸过小或中心不在主屏内则放弃恢复(避免最小化坐标 -32000 导致窗口不可见)
                    let mut sane = g.w >= 400 && g.h >= 300;
                    if sane {
                        if let Some(Some(mon)) = w.primary_monitor().ok().map(|m| m) {
                            let mp = mon.position();
                            let ms = mon.size();
                            let cx = g.x + (g.w as i32) / 2;
                            let cy = g.y + (g.h as i32) / 2;
                            sane = cx >= mp.x
                                && cx <= mp.x + ms.width as i32
                                && cy >= mp.y
                                && cy <= mp.y + ms.height as i32;
                        }
                    }
                    if sane {
                        let _ = w.set_position(tauri::PhysicalPosition::new(g.x, g.y));
                        let _ = w.set_size(tauri::PhysicalSize::new(g.w, g.h));
                        if g.maximized {
                            let _ = w.maximize();
                        }
                    }
                }
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
            }

            // 全局快捷键
            if s.hotkey_enabled {
                let _ = register_hotkey(app.handle());
            }

            // 剪贴板后台监听(先恢复已持久化的历史)
            clip::clip_init(app.handle());
            let monitor_handle = app.handle().clone();
            std::thread::spawn(move || clip::clip_monitor(monitor_handle));

            // 系统托盘:左键恢复窗口,右键菜单
            let show = MenuItem::with_id(app, "show", "显示 OmniKit", true, None::<&str>)?;
            let clip = MenuItem::with_id(app, "clip", "剪贴板历史", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &clip, &quit])?;
            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("OmniKit")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    // 托盘直达剪贴板历史:恢复窗口并通知前端切页
                    "clip" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                        let _ = app.emit("omnikit://goto", "clip");
                    }
                    "quit" => app.exit(0),
                    // 收藏工具直达:恢复窗口并通知前端切页(fav: 前缀 + 工具 id)
                    other => {
                        if let Some(id) = other.strip_prefix("fav:") {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                            let _ = app.emit("omnikit://goto", id);
                        }
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("OmniKit 启动失败")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                // 退出时保存窗口几何并清理后台会话
                let st = app.state::<SettingsState>();
                let remember = st.0.lock().unwrap().remember_window;
                if remember {
                    if let Some(w) = app.get_webview_window("main") {
                        let minimized = w.is_minimized().unwrap_or(false);
                        let maximized = w.is_maximized().unwrap_or(false);
                        if let (Ok(pos), Ok(size)) = (w.outer_position(), w.inner_size()) {
                            // 最小化时坐标是 -32000/0,跳过保存沿用上次的好几何
                            if minimized || size.width == 0 {
                                return;
                            }
                            let mut s = st.0.lock().unwrap().clone();
                            s.window = Some(settings::WindowGeom {
                                x: pos.x,
                                y: pos.y,
                                w: size.width,
                                h: size.height,
                                maximized,
                            });
                            settings::save(app, &s);
                            *st.0.lock().unwrap() = s;
                        }
                    }
                }
                let mcp = app.state::<McpState>();
                *mcp.0.lock().unwrap() = None;
                // 退出前把未落盘的剪贴板历史写掉
                {
                    let clip = app.state::<clip::ClipState>();
                    if clip.persist.load(std::sync::atomic::Ordering::Relaxed)
                        && clip.dirty.load(std::sync::atomic::Ordering::Relaxed)
                    {
                        clip::clip_force_save(app);
                    }
                }
            }
        });
}
