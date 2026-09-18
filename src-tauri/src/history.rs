use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

/// 单条加解密记录;仅存本机应用数据目录(history.json)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: u64,
    /// encrypt | decrypt
    pub kind: String,
    /// .box 文件名
    pub name: String,
    /// .box 完整路径
    pub box_path: String,
    /// 加密 = .box 所在目录;解密 = 解压目录
    pub location: String,
    pub files: u64,
    pub bytes: u64,
    /// unix 秒
    pub time: u64,
}

const MAX_ENTRIES: usize = 200;

impl HistoryEntry {
    pub fn new(
        kind: &str,
        name: String,
        box_path: String,
        location: String,
        files: u64,
        bytes: u64,
    ) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();
        Self {
            id: now.as_millis() as u64,
            kind: kind.to_string(),
            name,
            box_path,
            location,
            files,
            bytes,
            time: now.as_secs(),
        }
    }
}

fn history_file(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| Error::BadInput(format!("无法定位应用数据目录：{e}")))?;
    fs::create_dir_all(&dir)?;
    Ok(dir.join("history.json"))
}

pub fn load(app: &AppHandle) -> Vec<HistoryEntry> {
    let Ok(path) = history_file(app) else {
        return Vec::new();
    };
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

fn save(app: &AppHandle, entries: &[HistoryEntry]) -> Result<()> {
    let path = history_file(app)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(
        &tmp,
        serde_json::to_vec(entries).map_err(|e| Error::Corrupt(format!("记录序列化失败：{e}")))?,
    )?;
    fs::rename(&tmp, &path)?;
    Ok(())
}

/// 新记录插到最前,超限裁掉最旧的;失败静默(记录不能影响加解密主流程)
pub fn add(app: &AppHandle, entry: HistoryEntry) {
    let mut entries = load(app);
    entries.insert(0, entry);
    entries.truncate(MAX_ENTRIES);
    let _ = save(app, &entries);
}

pub fn remove(app: &AppHandle, id: u64) {
    let mut entries = load(app);
    entries.retain(|e| e.id != id);
    let _ = save(app, &entries);
}

pub fn clear(app: &AppHandle) {
    let _ = save(app, &[]);
}
