mod commands;
mod crypto;
mod error;
mod format;
mod history;
mod pack;
mod unpack;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::AppState::default())
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
            commands::sys_overview
        ])
        .run(tauri::generate_context!())
        .expect("DevToolbox 启动失败");
}
