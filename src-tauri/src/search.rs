//! 全盘文件名索引:后台遍历磁盘构建路径索引(内存),压缩缓存到本地,支持子串秒搜
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;

#[derive(Serialize, Deserialize, Clone)]
pub struct IndexMeta {
    pub roots: Vec<String>,
    pub files: u64,
    pub time: u64,
}

#[derive(Default, Clone)]
pub struct SearchState {
    pub paths: Arc<RwLock<Arc<Vec<Box<str>>>>>,
    pub indexing: Arc<AtomicBool>,
    pub stop: Arc<AtomicBool>,
    pub last_time: Arc<Mutex<u64>>,
    pub meta: Arc<Mutex<Option<IndexMeta>>>,
}

#[derive(Serialize, Clone)]
pub struct SearchStatus {
    pub indexing: bool,
    pub files: usize,
    pub last_time: u64,
    pub roots: Vec<String>,
}

fn cache_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("search-index.gz"))
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn meta_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("search-index.meta.json"))
}

fn save_meta(app: &AppHandle, meta: &IndexMeta) {
    let Some(p) = meta_path(app) else { return };
    if let Some(dir) = p.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(t) = serde_json::to_string_pretty(meta) {
        let _ = fs::write(&p, t);
    }
}

fn load_meta(app: &AppHandle) -> Option<IndexMeta> {
    let p = meta_path(app)?;
    let t = fs::read_to_string(p).ok()?;
    serde_json::from_str(&t).ok()
}

fn save_cache(app: &AppHandle, paths: &Arc<Vec<Box<str>>>) {
    let Some(p) = cache_path(app) else { return };
    if let Some(dir) = p.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let tmp = p.with_extension("gz.tmp");
    let Ok(file) = fs::File::create(&tmp) else { return };
    let mut enc = GzEncoder::new(file, Compression::fast());
    let mut ok = true;
    for path in paths.iter() {
        if enc.write_all(path.as_bytes()).is_err() || enc.write_all(b"\n").is_err() {
            ok = false;
            break;
        }
    }
    if ok && enc.finish().is_ok() {
        let _ = fs::rename(&tmp, &p);
    } else {
        let _ = fs::remove_file(&tmp);
    }
}

fn index_worker(
    app: AppHandle,
    state: SearchState,
    roots: Vec<String>,
    excludes: Vec<String>,
    exclude_exts: Vec<String>,
) {
    let excludes_lc: Vec<String> = excludes.iter().map(|e| e.to_lowercase()).collect();
    let mut vec: Vec<Box<str>> = Vec::with_capacity(200_000);
    let mut last_emit = Instant::now();
    let started = Instant::now();

    for root in &roots {
        for entry in WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| {
                // 排除规则命中目录时整枝剪掉
                let pl = e.path().to_string_lossy().to_lowercase();
                !excludes_lc.iter().any(|x| pl.contains(x))
            })
            .filter_map(|e| e.ok())
        {
            if state.stop.load(Ordering::Relaxed) {
                break;
            }
            let p = entry.path();
            if p.to_string_lossy().len() == 3 && p.to_string_lossy().ends_with('\\') {
                continue; // 跳过盘符根本身
            }
            if let Some(ext) = p.extension() {
                let ext = ext.to_string_lossy().to_lowercase();
                if exclude_exts.iter().any(|x| *x == ext) {
                    continue;
                }
            }
            vec.push(p.to_string_lossy().to_string().into_boxed_str());
            if last_emit.elapsed().as_millis() >= 400 {
                last_emit = Instant::now();
                let _ = app.emit(
                    "idx://progress",
                    serde_json::json!({ "files": vec.len(), "current": root }),
                );
            }
        }
        if state.stop.load(Ordering::Relaxed) {
            break;
        }
    }

    let stopped = state.stop.load(Ordering::Relaxed);
    *state.paths.write().unwrap() = Arc::new(vec);
    *state.last_time.lock().unwrap() = now();
    state.indexing.store(false, Ordering::Relaxed);
    let files = state.paths.read().unwrap().len();
    let _ = app.emit(
        "idx://progress",
        serde_json::json!({ "files": files, "current": "" }),
    );
    if !stopped && files > 0 {
        let paths = state.paths.read().unwrap().clone();
        save_cache(&app, &paths);
        let meta = IndexMeta {
            roots: roots.clone(),
            files: files as u64,
            time: now(),
        };
        save_meta(&app, &meta);
        *state.meta.lock().unwrap() = Some(meta);
    }
    let _ = started.elapsed();
}

#[tauri::command]
pub async fn search_start(
    app: AppHandle,
    state: tauri::State<'_, SearchState>,
    settings: tauri::State<'_, crate::settings::SettingsState>,
    roots: Vec<String>,
) -> Result<(), String> {
    if state.indexing.load(Ordering::Relaxed) {
        return Err("索引正在进行中，请先取消".into());
    }
    let roots: Vec<String> = roots.into_iter().filter(|r| !r.trim().is_empty()).collect();
    if roots.is_empty() {
        return Err("请选择至少一个要索引的磁盘".into());
    }
    state.indexing.store(true, Ordering::Relaxed);
    state.stop.store(false, Ordering::Relaxed);
    *state.paths.write().unwrap() = Arc::new(Vec::new());
    let (excludes, exts) = {
        let cfg = settings.0.lock().unwrap();
        (cfg.search_excludes.clone(), cfg.search_exclude_exts.clone())
    };
    let app2 = app.clone();
    let st = state.inner().clone();
    std::thread::spawn(move || index_worker(app2, st, roots, excludes, exts));
    Ok(())
}

#[tauri::command]
pub async fn search_stop(state: tauri::State<'_, SearchState>) -> Result<(), String> {
    state.stop.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub fn search_status(state: tauri::State<'_, SearchState>) -> SearchStatus {
    SearchStatus {
        indexing: state.indexing.load(Ordering::Relaxed),
        files: state.paths.read().unwrap().len(),
        last_time: *state.last_time.lock().unwrap(),
        roots: state
            .meta
            .lock()
            .unwrap()
            .as_ref()
            .map(|m| m.roots.clone())
            .unwrap_or_default(),
    }
}

#[tauri::command]
pub async fn search_cache_load(app: AppHandle, state: tauri::State<'_, SearchState>) -> Result<(), String> {
    if state.indexing.load(Ordering::Relaxed) {
        return Ok(());
    }
    let Some(p) = cache_path(&app) else { return Ok(()) };
    if !p.exists() {
        return Ok(());
    }
    let st = state.inner().clone();
    let app2 = app.clone();
    std::thread::spawn(move || {
        let Ok(file) = fs::File::open(&p) else { return };
        let dec = GzDecoder::new(file);
        let mut vec: Vec<Box<str>> = Vec::with_capacity(100_000);
        for line in BufReader::new(dec).lines().map_while(Result::ok) {
            if line.is_empty() { continue; }
            vec.push(line.into_boxed_str());
        }
        if let Ok(meta) = fs::metadata(&p) {
            if let Ok(t) = meta.modified() {
                if let Ok(d) = t.duration_since(UNIX_EPOCH) {
                    *st.last_time.lock().unwrap() = d.as_secs();
                }
            }
        }
        if let Some(m) = load_meta(&app2) {
            *st.last_time.lock().unwrap() = m.time;
            *st.meta.lock().unwrap() = Some(m);
        }
        *st.paths.write().unwrap() = Arc::new(vec);
        let files = st.paths.read().unwrap().len();
        let _ = app2.emit(
            "idx://progress",
            serde_json::json!({ "files": files, "current": "" }),
        );
    });
    Ok(())
}

#[tauri::command]
pub fn search_query(
    state: tauri::State<'_, SearchState>,
    q: String,
    limit: Option<usize>,
) -> Vec<String> {
    let q = q.trim().to_lowercase();
    if q.is_empty() {
        return Vec::new();
    }
    let limit = limit.unwrap_or(300);
    let paths = state.paths.read().unwrap().clone();
    let mut out: Vec<String> = Vec::with_capacity(64);
    for p in paths.iter() {
        if p.to_lowercase().contains(&q) {
            out.push(p.to_string());
            if out.len() >= limit {
                break;
            }
        }
    }
    out
}
