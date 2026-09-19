//! 全盘文件名索引:并行遍历建索引(内存),压缩缓存到本地,notify 实时跟进增删改名
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use notify::Watcher;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Deserialize, Clone)]
pub struct IndexMeta {
    pub roots: Vec<String>,
    pub files: u64,
    pub time: u64,
}

#[derive(Clone)]
pub struct SearchState {
    pub paths: Arc<RwLock<Vec<Box<str>>>>,
    pub indexing: Arc<AtomicBool>,
    pub stop: Arc<AtomicBool>,
    pub last_time: Arc<Mutex<u64>>,
    pub meta: Arc<Mutex<Option<IndexMeta>>>,
    pub watched: Arc<Mutex<Vec<String>>>,
    pub watcher: Arc<Mutex<Option<notify::RecommendedWatcher>>>,
    /// 查询代数:后台扫描完成时丢弃过期结果,前端拿到的永远是最新的
    pub query_seq: Arc<AtomicU64>,
    pub query_done: Arc<AtomicU64>,
    pub query_result: Arc<Mutex<Option<(u64, Vec<String>)>>>,
}

impl Default for SearchState {
    fn default() -> Self {
        Self {
            paths: Arc::new(RwLock::new(Vec::new())),
            indexing: Arc::new(AtomicBool::new(false)),
            stop: Arc::new(AtomicBool::new(false)),
            last_time: Arc::new(Mutex::new(0)),
            meta: Arc::new(Mutex::new(None)),
            watched: Arc::new(Mutex::new(Vec::new())),
            watcher: Arc::new(Mutex::new(None)),
            query_seq: Arc::new(AtomicU64::new(0)),
            query_done: Arc::new(AtomicU64::new(0)),
            query_result: Arc::new(Mutex::new(None)),
        }
    }
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

fn meta_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("search-index.meta.json"))
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn save_cache(app: &AppHandle, paths: &[Box<str>]) {
    let Some(p) = cache_path(app) else { return };
    if let Some(dir) = p.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let tmp = p.with_extension("gz.tmp");
    let Ok(file) = fs::File::create(&tmp) else { return };
    let mut enc = GzEncoder::new(file, Compression::fast());
    let mut ok = true;
    for path in paths {
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

fn index_worker(
    app: AppHandle,
    state: SearchState,
    roots: Vec<String>,
    excludes: Vec<String>,
    exclude_exts: Vec<String>,
) {
    let excludes_lc: Vec<String> = excludes.iter().map(|e| e.to_lowercase()).collect();
    let exts_lc: Vec<String> = exclude_exts.iter().map(|e| e.to_lowercase()).collect();
    let mut vec: Vec<Box<str>> = Vec::with_capacity(200_000);
    let mut last_emit = Instant::now();

    for root in &roots {
        let ex = excludes_lc.clone();
        for entry in jwalk::WalkDir::new(root)
            .follow_links(false)
            .process_read_dir(move |_depth, _root, _state, children| {
                // 命中排除关键字的目录整枝剪掉
                children.retain(|r| match r {
                    Ok(e) => {
                        let pl = e.path().to_string_lossy().to_lowercase();
                        !ex.iter().any(|x| pl.contains(x))
                    }
                    Err(_) => true,
                })
            })
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if state.stop.load(Ordering::Relaxed) {
                break;
            }
            let p = entry.path();
            let lossy = p.to_string_lossy();
            if lossy.len() == 3 && lossy.ends_with('\\') {
                continue; // 跳过盘符根本身
            }
            if entry.file_type().is_file() {
                if let Some(ext) = p.extension() {
                    let ext = ext.to_string_lossy().to_lowercase();
                    if exts_lc.iter().any(|x| *x == ext) {
                        continue;
                    }
                }
            }
            vec.push(lossy.to_string().into_boxed_str());
            if last_emit.elapsed().as_millis() >= 300 {
                last_emit = Instant::now();
                let last_files = app
                    .state::<SearchState>()
                    .meta
                    .lock()
                    .unwrap()
                    .as_ref()
                    .map(|m| m.files)
                    .unwrap_or(0);
                let _ = app.emit(
                    "idx://progress",
                    serde_json::json!({
                        "files": vec.len(),
                        "current": root,
                        "phase": "scanning",
                        "estimate": last_files
                    }),
                );
            }
        }
        if state.stop.load(Ordering::Relaxed) {
            break;
        }
    }

    let stopped = state.stop.load(Ordering::Relaxed);
    if !stopped {
        vec.sort_by_cached_key(|p| p.to_lowercase());
    }
    *state.paths.write().unwrap() = vec;
    *state.last_time.lock().unwrap() = now();
    state.indexing.store(false, Ordering::Relaxed);
    let files = state.paths.read().unwrap().len();
    let _ = app.emit(
        "idx://progress",
        serde_json::json!({ 
            "files": files,
            "current": "",
            "phase": if stopped { "stopped" } else { "done" },
        }),
    );
    if !stopped && files > 0 {
        let paths = state.paths.read().unwrap();
        save_cache(&app, &paths);
        drop(paths);
        let meta = IndexMeta {
            roots: roots.clone(),
            files: files as u64,
            time: now(),
        };
        save_meta(&app, &meta);
        *state.meta.lock().unwrap() = Some(meta);
        start_watcher(&state, roots, excludes, exclude_exts);
    }
}

/* ---------- 实时监听 ---------- */

fn path_excluded(p: &str, excludes_lc: &[String], exts_lc: &[String]) -> bool {
    let pl = p.to_lowercase();
    if excludes_lc.iter().any(|x| pl.contains(x)) {
        return true;
    }
    if let Some(ext) = Path::new(p).extension() {
        let ext = ext.to_string_lossy().to_lowercase();
        if exts_lc.iter().any(|x| *x == ext) {
            return true;
        }
    }
    false
}

fn insert_path(vec: &mut Vec<Box<str>>, path: &str, excludes_lc: &[String], exts_lc: &[String]) {
    if path_excluded(path, excludes_lc, exts_lc) {
        return;
    }
    let key = path.to_lowercase();
    match vec.binary_search_by(|x| x.to_lowercase().cmp(&key)) {
        Ok(_) => {}
        Err(pos) => vec.insert(pos, path.to_owned().into_boxed_str()),
    }
}

fn remove_path(vec: &mut Vec<Box<str>>, path: &str) {
    let key = path.to_lowercase();
    if let Ok(pos) = vec.binary_search_by(|x| x.to_lowercase().cmp(&key)) {
        vec.remove(pos);
    }
    // 目录删除:小写路径有序,后代为连续区间,一并移除
    let prefix = format!("{}\\", key);
    let start = vec.partition_point(|x| x.to_lowercase().as_str() < prefix.as_str());
    let mut end = start;
    while end < vec.len() && vec[end].to_lowercase().starts_with(&prefix) {
        end += 1;
    }
    if end > start {
        vec.drain(start..end);
    }
}

fn apply_event(
    state: &SearchState,
    event: &notify::Event,
    excludes_lc: &[String],
    exts_lc: &[String],
) {
    use notify::EventKind::{Create, Modify, Remove};
    use notify::event::{ModifyKind, RenameMode};
    let mut vec = state.paths.write().unwrap();
    match &event.kind {
        Create(_) => {
            for p in &event.paths {
                insert_path(&mut vec, &p.to_string_lossy(), excludes_lc, exts_lc);
            }
        }
        Remove(_) => {
            for p in &event.paths {
                remove_path(&mut vec, &p.to_string_lossy());
            }
        }
        Modify(ModifyKind::Name(mode)) => match mode {
            RenameMode::From => {
                for p in &event.paths {
                    remove_path(&mut vec, &p.to_string_lossy());
                }
            }
            RenameMode::To => {
                for p in &event.paths {
                    insert_path(&mut vec, &p.to_string_lossy(), excludes_lc, exts_lc);
                }
            }
            RenameMode::Both => {
                if let [from, to] = event.paths.as_slice() {
                    remove_path(&mut vec, &from.to_string_lossy());
                    insert_path(&mut vec, &to.to_string_lossy(), excludes_lc, exts_lc);
                }
            }
            _ => {}
        },
        _ => {}
    }
}

fn start_watcher(
    state: &SearchState,
    roots: Vec<String>,
    excludes: Vec<String>,
    exclude_exts: Vec<String>,
) {
    {
        let mut watched = state.watched.lock().unwrap();
        if *watched == roots {
            return;
        }
        *watched = roots.clone();
    }
    let excludes_lc: Vec<String> = excludes.iter().map(|e| e.to_lowercase()).collect();
    let exts_lc: Vec<String> = exclude_exts.iter().map(|e| e.to_lowercase()).collect();
    let (tx, rx) = std::sync::mpsc::channel();
    let Ok(mut watcher) = notify::recommended_watcher(tx) else {
        return;
    };
    for root in &roots {
        let _ = watcher.watch(Path::new(root), notify::RecursiveMode::Recursive);
    }
    *state.watcher.lock().unwrap() = Some(watcher);
    let st = state.clone();
    std::thread::spawn(move || {
        for res in rx {
            let Ok(event) = res else { continue };
            apply_event(&st, &event, &excludes_lc, &exts_lc);
        }
    });
}

/* ---------- 命令 ---------- */

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
    *state.paths.write().unwrap() = Vec::new();
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
pub async fn search_cache_load(
    app: AppHandle,
    state: tauri::State<'_, SearchState>,
) -> Result<(), String> {
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
            if line.is_empty() {
                continue;
            }
            vec.push(line.into_boxed_str());
        }
        vec.sort_by_cached_key(|p| p.to_lowercase());
        *st.paths.write().unwrap() = vec;
        let (excludes, exts) = {
            let cfg = app2.state::<crate::settings::SettingsState>();
            let g = cfg.0.lock().unwrap();
            (g.search_excludes.clone(), g.search_exclude_exts.clone())
        };
        if let Some(m) = load_meta(&app2) {
            *st.last_time.lock().unwrap() = m.time;
            *st.meta.lock().unwrap() = Some(m);
        }
        let files = st.paths.read().unwrap().len();
        let _ = app2.emit(
            "idx://progress",
            serde_json::json!({ "files": files, "current": "" }),
        );
        let roots = st
            .meta
            .lock()
            .unwrap()
            .as_ref()
            .map(|m| m.roots.clone())
            .unwrap_or_default();
        start_watcher(&st, roots, excludes, exts);
    });
    Ok(())
}

fn glob_match(pattern: &[char], text: &[char]) -> bool {
    if pattern.is_empty() {
        return text.is_empty();
    }
    match pattern[0] {
        '*' => {
            for i in 0..=text.len() {
                if glob_match(&pattern[1..], &text[i..]) {
                    return true;
                }
            }
            false
        }
        '?' => !text.is_empty() && glob_match(&pattern[1..], &text[1..]),
        c => {
            !text.is_empty()
                && text[0].eq_ignore_ascii_case(&c)
                && glob_match(&pattern[1..], &text[1..])
        }
    }
}

fn token_match(token: &str, path_lc: &str) -> bool {
    if token.contains('*') || token.contains('?') {
        let pc: Vec<char> = token.chars().collect();
        let tc: Vec<char> = path_lc.chars().collect();
        glob_match(&pc, &tc)
    } else {
        path_lc.contains(token)
    }
}

fn scan_once(paths: &[Box<str>], tokens: &[String], limit: usize) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(64);
    'outer: for p in paths {
        let pl = p.to_lowercase();
        for t in tokens {
            if !token_match(t, &pl) {
                continue 'outer;
            }
        }
        out.push(p.to_string());
        if out.len() >= limit {
            break;
        }
    }
    out
}

/// 异步搜索:同一时刻只保留最新查询,后台扫描完成后回填,避免请求堆积卡 UI
#[tauri::command]
pub async fn search_query(
    state: tauri::State<'_, SearchState>,
    q: String,
    limit: Option<usize>,
) -> Result<QueryReply, String> {
    let tokens: Vec<String> = q
        .trim()
        .split_whitespace()
        .map(|t| t.to_lowercase())
        .collect();
    if tokens.is_empty() {
        return Ok(QueryReply { stale: false, lines: Vec::new() });
    }
    let limit = limit.unwrap_or(300);
    let seq = state.query_seq.fetch_add(1, Ordering::Relaxed) + 1;
    let st = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths = st.paths.read().unwrap().clone();
        let lines = scan_once(&paths, &tokens, limit);
        *st.query_result.lock().unwrap() = Some((seq, lines));
        st.query_done.store(seq, Ordering::Relaxed);
    });
    // 轮询等待:结果代数落后于最新请求时返回 stale,前端不渲染旧结果
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        tokio::time::sleep(Duration::from_millis(30)).await;
        if Instant::now() > deadline {
            return Ok(QueryReply { stale: true, lines: Vec::new() });
        }
        let latest = state.query_seq.load(Ordering::Relaxed);
        if let Some((done, lines)) = state.query_result.lock().unwrap().clone() {
            if done >= latest {
                return Ok(QueryReply { stale: false, lines });
            }
        }
    }
}

#[derive(serde::Serialize)]
pub struct QueryReply {
    pub stale: bool,
    pub lines: Vec<String>,
}
