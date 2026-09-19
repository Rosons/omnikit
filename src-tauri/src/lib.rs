mod commands;
mod crypto;
mod error;
mod format;
mod history;
mod mcp;
mod pack;
mod unpack;

use mcp::McpState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
            commands::http_request,
            commands::disk_find_dupes,
            commands::disk_dir_sizes,
            commands::disk_trash,
            commands::sys_overview,
            commands::proc_list,
            commands::net_resolve,
            commands::log_tail_start,
            commands::log_tail_stop,
            mcp::mcp_connect,
            mcp::mcp_disconnect,
            mcp::mcp_list_tools,
            mcp::mcp_list_resources,
            mcp::mcp_list_prompts,
            mcp::mcp_call_tool,
            mcp::mcp_log
        ])
        .build(tauri::generate_context!())
        .expect("DevToolbox 启动失败")
        .run(|app, event| {
            // 退出时结束仍在运行的 MCP 子进程
            if let tauri::RunEvent::Exit = event {
                let state = app.state::<McpState>();
                *state.0.lock().unwrap() = None;
            }
        });
}
