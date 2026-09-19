mod commands;
mod crypto;
mod error;
mod format;
mod history;
mod mcp;
mod pack;
mod settings;
mod unpack;

use settings::SettingsState;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, RunEvent};

use mcp::McpState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(commands::AppState::default())
        .manage(mcp::McpState::default())
        .manage(commands::TailState::default())
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
            commands::sys_overview,
            commands::proc_list,
            commands::log_tail_start,
            commands::log_tail_stop,
            commands::path_exists,
            commands::read_file_base64,
            settings::settings_get,
            settings::settings_set,
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
                    let _ = w.set_position(tauri::PhysicalPosition::new(g.x, g.y));
                    let _ = w.set_size(tauri::PhysicalSize::new(g.w, g.h));
                    if g.maximized {
                        let _ = w.maximize();
                    }
                }
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
            }

            // 系统托盘:左键恢复窗口,右键菜单
            let show = MenuItem::with_id(app, "show", "显示 DevToolbox", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("DevToolbox")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
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
        .expect("DevToolbox 启动失败")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                // 退出时保存窗口几何并结束 MCP 子进程
                let st = app.state::<SettingsState>();
                let remember = st.0.lock().unwrap().remember_window;
                if remember {
                    if let Some(w) = app.get_webview_window("main") {
                        let maximized = w.is_maximized().unwrap_or(false);
                        if let (Ok(pos), Ok(size)) = (w.outer_position(), w.inner_size()) {
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
            }
        });
}
