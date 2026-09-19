use crate::error::Error;
use crate::history::HistoryEntry;
use crate::pack::{collect_files, pack, Progress as PackProgress};
use crate::unpack::unpack;
use md5::{Digest, Md5};
use serde::Serialize;
use sha1::Sha1;
use sha2::{Sha256, Sha512};
use std::cell::Cell;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Command;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// 隐藏子进程控制台窗口(netstat/tasklist/taskkill 是控制台程序,直接调会闪黑窗)
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub(crate) fn hidden_command(program: &str) -> Command {
    #[cfg(windows)]
    {
        let mut c = Command::new(program);
        c.creation_flags(CREATE_NO_WINDOW);
        c
    }
    #[cfg(not(windows))]
    {
        Command::new(program)
    }
}
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;
use zeroize::Zeroizing;

const EVENT_PROGRESS: &str = "safebox://progress";
const EMIT_INTERVAL: Duration = Duration::from_millis(100);

/// 全局应用状态:UI 同时只有一个加解密任务,槽位存当前任务的取消标志
#[derive(Default)]
pub struct AppState {
    cancel_slot: Mutex<Option<Arc<AtomicBool>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SbSummary {
    pub output: String,
    pub files: usize,
    pub bytes: u64,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SbProgress {
    phase: &'static str,
    current_file: String,
    files_done: usize,
    files_total: usize,
    bytes_done: u64,
    bytes_total: u64,
}

fn emit_progress(
    app: &AppHandle,
    phase: &'static str,
    p: &PackProgress,
    last: &Cell<Instant>,
    force: bool,
) {
    let now = Instant::now();
    if force || now.duration_since(last.get()) >= EMIT_INTERVAL {
        last.set(now);
        let _ = app.emit(
            EVENT_PROGRESS,
            SbProgress {
                phase,
                current_file: p.current_file.clone(),
                files_done: p.files_done,
                files_total: p.files_total,
                bytes_done: p.bytes_done,
                bytes_total: p.bytes_total,
            },
        );
    }
}

#[tauri::command]
pub async fn sb_encrypt(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    paths: Vec<String>,
    password: String,
    output: String,
) -> Result<SbSummary, String> {
    if paths.is_empty() {
        return Err("没有选择任何文件".into());
    }
    if password.is_empty() {
        return Err("密码不能为空".into());
    }
    let mut output = output;
    if !output.to_lowercase().ends_with(".box") {
        output.push_str(".box");
    }
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    let pw = Zeroizing::new(password);
    let output_path = PathBuf::from(&output);
    let started = Instant::now();
    let app2 = app.clone();
    let cancelled = Arc::new(AtomicBool::new(false));
    *state.cancel_slot.lock().unwrap() = Some(cancelled.clone());
    let task_flag = cancelled.clone();

    let joined = tauri::async_runtime::spawn_blocking(move || {
        let last = Cell::new(Instant::now() - Duration::from_secs(1));
        let stats = pack(
            &paths,
            &pw,
            &output_path,
            || task_flag.load(Ordering::Relaxed),
            |p| {
                emit_progress(&app2, "pack", &p, &last, false);
            },
        )?;
        emit_progress(
            &app2,
            "pack",
            &PackProgress {
                current_file: String::new(),
                files_done: stats.files,
                files_total: stats.files,
                bytes_done: stats.bytes,
                bytes_total: stats.bytes,
            },
            &last,
            true,
        );
        let _ = crate::history::add(
            &app2,
            HistoryEntry::new(
                "encrypt",
                output_path
                    .file_name()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_else(|| output_path.to_string_lossy().into_owned()),
                output_path.to_string_lossy().into_owned(),
                output_path
                    .parent()
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                stats.files as u64,
                stats.bytes,
            ),
        );
        Ok(stats)
    })
    .await;
    // 任务已结束,清除取消槽位(仅当仍是本任务的标志,防误清新任务)
    {
        let mut slot = state.cancel_slot.lock().unwrap();
        if slot
            .as_ref()
            .map(|f| Arc::ptr_eq(f, &cancelled))
            .unwrap_or(false)
        {
            *slot = None;
        }
    }
    let stats = joined
        .map_err(|e| format!("任务执行失败：{e}"))?
        .map_err(|e: Error| e.to_string())?;

    Ok(SbSummary {
        output,
        files: stats.files,
        bytes: stats.bytes,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

#[tauri::command]
pub async fn sb_decrypt(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    box_path: String,
    password: String,
    output_dir: String,
) -> Result<SbSummary, String> {
    if box_path.is_empty() {
        return Err("没有选择保险箱文件".into());
    }
    if password.is_empty() {
        return Err("密码不能为空".into());
    }
    let pw = Zeroizing::new(password);
    let box_path = PathBuf::from(box_path);
    let out_dir = PathBuf::from(output_dir);
    let work_dir = out_dir.clone();
    let started = Instant::now();
    let app2 = app.clone();
    let cancelled = Arc::new(AtomicBool::new(false));
    *state.cancel_slot.lock().unwrap() = Some(cancelled.clone());
    let task_flag = cancelled.clone();

    let joined = tauri::async_runtime::spawn_blocking(move || {
        let last = Cell::new(Instant::now() - Duration::from_secs(1));
        let stats = unpack(
            &box_path,
            &pw,
            &work_dir,
            || task_flag.load(Ordering::Relaxed),
            |p| {
                emit_progress(&app2, "unpack", &p, &last, false);
            },
        )?;
        emit_progress(
            &app2,
            "unpack",
            &PackProgress {
                current_file: String::new(),
                files_done: stats.files,
                files_total: stats.files,
                bytes_done: stats.bytes,
                bytes_total: stats.bytes,
            },
            &last,
            true,
        );
        let _ = crate::history::add(
            &app2,
            HistoryEntry::new(
                "decrypt",
                box_path
                    .file_name()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_else(|| box_path.to_string_lossy().into_owned()),
                box_path.to_string_lossy().into_owned(),
                work_dir.to_string_lossy().into_owned(),
                stats.files as u64,
                stats.bytes,
            ),
        );
        Ok(stats)
    })
    .await;
    {
        let mut slot = state.cancel_slot.lock().unwrap();
        if slot
            .as_ref()
            .map(|f| Arc::ptr_eq(f, &cancelled))
            .unwrap_or(false)
        {
            *slot = None;
        }
    }
    let stats = joined
        .map_err(|e| format!("任务执行失败：{e}"))?
        .map_err(|e: Error| e.to_string())?;

    Ok(SbSummary {
        output: out_dir.to_string_lossy().into_owned(),
        files: stats.files,
        bytes: stats.bytes,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedFile {
    /// 绝对路径
    pub path: String,
    /// 归档内相对路径(正斜杠)
    pub rel: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenamedInput {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub files: Vec<ScannedFile>,
    pub total_bytes: u64,
    /// 因已包含在其他所选文件夹中而被跳过的输入
    pub skipped_inputs: Vec<String>,
    /// 同名冲突自动改名的 (原名, 归档名)
    pub renamed_inputs: Vec<RenamedInput>,
}

/// 预览待打包清单:递归展开文件夹,返回全部文件与总大小(与 pack 的收集规则一致)
#[tauri::command]
pub fn sb_scan(paths: Vec<String>) -> Result<ScanResult, String> {
    if paths.is_empty() {
        return Err("没有选择任何文件".into());
    }
    let inputs: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    let collected = collect_files(&inputs).map_err(|e| e.to_string())?;
    let mut files = Vec::with_capacity(collected.files.len());
    let mut total_bytes = 0u64;
    for (abs, rel) in &collected.files {
        let size = std::fs::metadata(abs).map_err(|e| e.to_string())?.len();
        total_bytes += size;
        files.push(ScannedFile {
            path: abs.to_string_lossy().into_owned(),
            rel: rel.clone(),
            size,
        });
    }
    Ok(ScanResult {
        files,
        total_bytes,
        skipped_inputs: collected.skipped_inputs,
        renamed_inputs: collected
            .renamed_inputs
            .into_iter()
            .map(|(from, to)| RenamedInput { from, to })
            .collect(),
    })
}

/// 在资源管理器中展示文件(选中)或打开文件夹
#[tauri::command]
pub fn sb_reveal(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("路径不存在：{path}"));
    }
    let p = p.canonicalize().map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    {
        let s = p.to_string_lossy().replace('/', "\\");
        let s = s.strip_prefix("\\\\?\\").unwrap_or(&s).to_string();
        let target = if p.is_file() {
            format!("/select,{s}")
        } else {
            s
        };
        Command::new("explorer")
            .arg(target)
            .spawn()
            .map_err(|e| format!("无法打开资源管理器：{e}"))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        if p.is_file() {
            Command::new("open")
                .args(["-R", &p.to_string_lossy()])
                .spawn()
                .map_err(|e| format!("{e}"))?;
        } else {
            Command::new("open")
                .arg(&p)
                .spawn()
                .map_err(|e| format!("{e}"))?;
        }
        return Ok(());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&p)
            .spawn()
            .map_err(|e| format!("{e}"))?;
        return Ok(());
    }
}

/// 历史记录:列表(按时间倒序)
#[tauri::command]
pub fn sb_history_list(app: AppHandle) -> Vec<HistoryEntry> {
    crate::history::load(&app)
}

/// 删除单条历史
#[tauri::command]
pub fn sb_history_remove(app: AppHandle, id: u64) {
    crate::history::remove(&app, id);
}

/// 清空历史
#[tauri::command]
pub fn sb_history_clear(app: AppHandle) {
    crate::history::clear(&app);
}

/// 请求取消当前加解密任务
#[tauri::command]
pub fn sb_cancel(state: tauri::State<'_, AppState>) {
    if let Some(flag) = state.cancel_slot.lock().unwrap().as_ref() {
        flag.store(true, Ordering::Relaxed);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHashResult {
    pub file: String,
    pub size: u64,
    pub md5: String,
    pub sha1: String,
    pub sha256: String,
    pub sha512: String,
}

fn to_hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

/// 流式计算单个文件的 MD5 / SHA-1 / SHA-256 / SHA-512(一次读取同时喂四个哈希器)
pub fn compute_file_hashes(
    path: &Path,
    should_stop: impl Fn() -> bool,
    progress: impl Fn(u64, u64),
) -> crate::error::Result<FileHashResult> {
    let total = fs::metadata(path)?.len();
    let mut file = fs::File::open(path)?;
    let mut md5h = Md5::new();
    let mut sha1h = Sha1::new();
    let mut sha256h = Sha256::new();
    let mut sha512h = Sha512::new();
    let mut buf = vec![0u8; 1024 * 1024];
    let mut done: u64 = 0;
    let mut last_emit: u64 = 0;
    loop {
        if should_stop() {
            return Err(Error::Cancelled);
        }
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        md5h.update(&buf[..n]);
        sha1h.update(&buf[..n]);
        sha256h.update(&buf[..n]);
        sha512h.update(&buf[..n]);
        done += n as u64;
        if done - last_emit >= 8 * 1024 * 1024 {
            last_emit = done;
            progress(done, total);
        }
    }
    progress(done, total);
    Ok(FileHashResult {
        file: path.to_string_lossy().into_owned(),
        size: total,
        md5: to_hex(&md5h.finalize()),
        sha1: to_hex(&sha1h.finalize()),
        sha256: to_hex(&sha256h.finalize()),
        sha512: to_hex(&sha512h.finalize()),
    })
}

/// 文件校验:计算四算法哈希,支持通过 sb_cancel 取消
#[tauri::command]
pub async fn sb_hash_file(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<FileHashResult, String> {
    if path.is_empty() {
        return Err("没有选择文件".into());
    }
    let p = PathBuf::from(path);
    let cancelled = Arc::new(AtomicBool::new(false));
    *state.cancel_slot.lock().unwrap() = Some(cancelled.clone());
    let task_flag = cancelled.clone();
    let app2 = app.clone();

    let joined = tauri::async_runtime::spawn_blocking(move || {
        compute_file_hashes(
            &p,
            || task_flag.load(Ordering::Relaxed),
            |done, total| {
                let _ = app2.emit(
                    "hashfile://progress",
                    serde_json::json!({ "done": done, "total": total }),
                );
            },
        )
    })
    .await;
    {
        let mut slot = state.cancel_slot.lock().unwrap();
        if slot
            .as_ref()
            .map(|f| Arc::ptr_eq(f, &cancelled))
            .unwrap_or(false)
        {
            *slot = None;
        }
    }
    joined
        .map_err(|e| format!("任务执行失败：{e}"))?
        .map_err(|e: Error| e.to_string())
}

/* ---------- 二维码与文本对比的辅助命令 ---------- */

/// 读取图片并转为 base64,交由前端解码像素后识别二维码
#[derive(Serialize)]
pub struct QrImage {
    pub base64: String,
    pub mime: String,
}

#[tauri::command]
pub fn qr_read_image(path: String) -> Result<QrImage, String> {
    let bytes = fs::read(&path).map_err(|e| format!("读取失败：{e}"))?;
    if bytes.len() > 32 * 1024 * 1024 {
        return Err("图片超过 32MB，请压缩后再试".into());
    }
    let mime = if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else if bytes.starts_with(&[0xFF, 0xD8]) {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF8") {
        "image/gif"
    } else if bytes.starts_with(b"BM") {
        "image/bmp"
    } else if bytes.len() > 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else {
        return Err("仅支持 PNG、JPG、GIF、WebP、BMP 图片".into());
    };
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine as _;
    Ok(QrImage {
        base64: STANDARD.encode(&bytes),
        mime: mime.to_string(),
    })
}

/// 保存前端生成的数据(如二维码 PNG),路径来自系统保存对话框
#[tauri::command]
pub fn save_data_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    if path.is_empty() {
        return Err("没有选择保存位置".into());
    }
    fs::write(&path, bytes).map_err(|e| format!("保存失败：{e}"))
}

/// 读取文本文件,UTF-8 优先,非 UTF-8 时尝试 GBK,方便中文环境的老文件
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| format!("读取失败：{e}"))?;
    if bytes.len() > 4 * 1024 * 1024 {
        return Err("文件超过 4MB，请截取片段后比较".into());
    }
    match std::str::from_utf8(&bytes) {
        Ok(s) => Ok(s.to_string()),
        Err(_) => {
            let (cow, _, had_errors) = encoding_rs::GBK.decode(&bytes);
            if had_errors {
                Ok(String::from_utf8_lossy(&bytes).into_owned())
            } else {
                Ok(cow.into_owned())
            }
        }
    }
}

/* ---------- 端口占用 ---------- */

#[derive(Serialize)]
pub struct PortEntry {
    pub proto: String,
    pub address: String,
    pub port: u16,
    pub pid: u32,
    pub name: String,
    pub path: Option<String>,
    pub cmd: Option<String>,
    pub mem: u64,
    pub start: u64,
}

/// 拆出地址与端口,兼容 IPv6 方括号写法(双平台共用)
fn split_addr(s: &str) -> Option<(String, u16)> {
    let idx = s.rfind(':')?;
    let port = s[idx + 1..].parse::<u16>().ok()?;
    Some((s[..idx].trim_matches(['[', ']']).to_string(), port))
}

#[cfg(windows)]
/// 解析 netstat -ano 输出:仅保留 TCP LISTENING 与全部 UDP 行
fn parse_netstat(output: &str) -> Vec<PortEntry> {
    let mut out = Vec::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 4 {
            continue;
        }
        match parts[0] {
            "TCP" if parts.len() >= 5 && parts[3] == "LISTENING" => {
                if let Some((address, port)) = split_addr(parts[1]) {
                    if let Ok(pid) = parts[4].parse::<u32>() {
                        out.push(PortEntry {
                            proto: "TCP".into(),
                            address,
                            port,
                            pid,
                            name: String::new(),
                            path: None,
                            cmd: None,
                            mem: 0,
                            start: 0,
                        });
                    }
                }
            }
            "UDP" if parts.len() >= 4 => {
                if let Some((address, port)) = split_addr(parts[1]) {
                    if let Ok(pid) = parts[3].parse::<u32>() {
                        out.push(PortEntry {
                            proto: "UDP".into(),
                            address,
                            port,
                            pid,
                            name: String::new(),
                            path: None,
                            cmd: None,
                            mem: 0,
                            start: 0,
                        });
                    }
                }
            }
            _ => {}
        }
    }
    out
}

#[cfg(target_os = "macos")]
/// macOS:用 lsof 收集监听端口(TCP LISTEN + 全部 UDP)
fn collect_port_rows() -> Result<Vec<PortEntry>, String> {
    let mut out = Vec::new();
    for (args, proto) in [
        (vec!["-iTCP", "-sTCP:LISTEN", "-P", "-n"], "TCP"),
        (vec!["-iUDP", "-P", "-n"], "UDP"),
    ] {
        let out_text = Command::new("lsof")
            .args(&args)
            .output()
            .map_err(|e| format!("无法执行 lsof：{e}"))?;
        let text = String::from_utf8_lossy(&out_text.stdout);
        for line in text.lines().skip(1) {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 9 {
                continue;
            }
            let Ok(pid) = parts[1].parse::<u32>() else { continue };
            let Some((address, port)) = split_addr(parts[8]) else { continue };
            out.push(PortEntry {
                proto: proto.into(),
                address,
                port,
                pid,
                name: String::new(),
                path: None,
                cmd: None,
                mem: 0,
                start: 0,
            });
        }
    }
    Ok(out)
}

#[cfg(windows)]
fn collect_port_rows() -> Result<Vec<PortEntry>, String> {
    let text = run_gbk_cmd("netstat", &["-ano"]).map_err(|e| format!("无法执行 netstat：{e}"))?;
    Ok(parse_netstat(&text))
}

fn run_gbk_cmd(program: &str, args: &[&str]) -> std::io::Result<String> {
    let out = hidden_command(program).args(args).output()?;
    let (text, _, _) = encoding_rs::GBK.decode(&out.stdout);
    Ok(text.into_owned())
}

struct ProcDetail {
    name: String,
    path: Option<String>,
    cmd: Option<String>,
    mem: u64,
    start: u64,
}

/// 用 sysinfo 一次性读取全部进程的名称/路径/命令行/内存/启动时间
fn process_details() -> std::collections::HashMap<u32, ProcDetail> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let mut map = std::collections::HashMap::new();
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_exe(UpdateKind::Always)
            .with_cmd(UpdateKind::Always),
    );
    for (pid, p) in sys.processes() {
        let cmd = p.cmd();
        map.insert(
            pid.as_u32(),
            ProcDetail {
                name: p.name().to_string_lossy().into_owned(),
                path: p.exe().map(|e| e.to_string_lossy().into_owned()),
                cmd: if cmd.is_empty() {
                    None
                } else {
                    Some(
                        cmd.iter()
                            .map(|s| s.to_string_lossy().into_owned())
                            .collect::<Vec<_>>()
                            .join(" "),
                    )
                },
                mem: p.memory(),
                start: p.start_time(),
            },
        );
    }
    map
}

fn list_ports_impl() -> Result<Vec<PortEntry>, String> {
    let mut entries = collect_port_rows()?;
    let details = process_details();
    for e in entries.iter_mut() {
        if let Some(d) = details.get(&e.pid) {
            e.name = d.name.clone();
            e.path = d.path.clone();
            e.cmd = d.cmd.clone();
            e.mem = d.mem;
            e.start = d.start;
        }
        if e.name.is_empty() {
            e.name = "未知进程".into();
        }
    }
    entries.sort_by(|a, b| a.port.cmp(&b.port).then(a.pid.cmp(&b.pid)));
    Ok(entries)
}

#[tauri::command]
pub async fn net_list_ports() -> Result<Vec<PortEntry>, String> {
    tauri::async_runtime::spawn_blocking(list_ports_impl)
        .await
        .map_err(|e| format!("任务执行失败：{e}"))?
}

#[tauri::command]
pub fn net_kill(pid: u32) -> Result<(), String> {
    #[cfg(windows)]
    {
        let out = hidden_command("taskkill")
            .args(["/F", "/PID", &pid.to_string()])
            .output()
            .map_err(|e| format!("无法执行 taskkill：{e}"))?;
        if out.status.success() {
            return Ok(());
        }
        let (so, _, _) = encoding_rs::GBK.decode(&out.stdout);
        let (se, _, _) = encoding_rs::GBK.decode(&out.stderr);
        let so = so.trim();
        let se = se.trim();
        let msg = if so.is_empty() { se } else { so };
        let msg = if msg.is_empty() { "未知错误" } else { msg };
        Err(format!("结束进程（PID {pid}）失败：{msg}"))
    }
    #[cfg(not(windows))]
    {
        let st = Command::new("kill")
            .args(["-9", &pid.to_string()])
            .status()
            .map_err(|e| format!("无法执行 kill：{e}"))?;
        if st.success() {
            Ok(())
        } else {
            Err(format!("结束进程（PID {pid}）失败：权限不足或进程已退出"))
        }
    }
}

/* ---------- TCP 连通测试 ---------- */

#[derive(Serialize)]
pub struct TcpProbe {
    pub ok: bool,
    pub elapsed_ms: u64,
    pub error: Option<String>,
    pub addr: String,
}

#[tauri::command]
pub async fn net_probe_tcp(
    host: String,
    port: u16,
    timeout_ms: Option<u64>,
) -> Result<TcpProbe, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::net::{TcpStream, ToSocketAddrs};
        let timeout = Duration::from_millis(timeout_ms.unwrap_or(3000).clamp(500, 15000));
        let addr_text = format!("{}:{}", host, port);
        let addrs: Vec<std::net::SocketAddr> = match (host.as_str(), port).to_socket_addrs() {
            Ok(a) => a.collect(),
            Err(e) => {
                return Ok(TcpProbe {
                    ok: false,
                    elapsed_ms: 0,
                    error: Some(format!("地址解析失败：{e}")),
                    addr: addr_text,
                })
            }
        };
        let start = Instant::now();
        let mut last_err: Option<std::io::Error> = None;
        for a in &addrs {
            match TcpStream::connect_timeout(a, timeout) {
                Ok(_) => {
                    return Ok(TcpProbe {
                        ok: true,
                        elapsed_ms: start.elapsed().as_millis() as u64,
                        error: None,
                        addr: a.to_string(),
                    })
                }
                Err(e) => last_err = Some(e),
            }
        }
        Ok(TcpProbe {
            ok: false,
            elapsed_ms: start.elapsed().as_millis() as u64,
            error: Some(
                last_err
                    .map(|e| e.to_string())
                    .unwrap_or_else(|| "没有可用的地址".into()),
            ),
            addr: addrs
                .first()
                .map(|a| a.to_string())
                .unwrap_or(addr_text),
        })
    })
    .await
    .map_err(|e| format!("任务执行失败：{e}"))?
}

/* ---------- HTTP 请求测试 ---------- */

#[derive(Serialize)]
pub struct HttpResult {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
    pub time_ms: u64,
    pub size: usize,
}

fn http_build_result(r: ureq::Response, time_ms: u64) -> HttpResult {
    let mut headers: Vec<(String, String)> = Vec::new();
    for name in r.headers_names() {
        if let Some(v) = r.header(&name) {
            headers.push((name, v.to_string()));
        }
    }
    headers.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
    let status = r.status();
    let charset_gbk = r
        .header("content-type")
        .map(|c| c.to_lowercase().contains("gb2312") || c.to_lowercase().contains("gbk"))
        .unwrap_or(false);
    let mut buf = Vec::new();
    let _ = std::io::Read::read_to_end(
        &mut r.into_reader().take(2 * 1024 * 1024),
        &mut buf,
    );
    let size = buf.len();
    let body = if charset_gbk {
        let (s, _, _) = encoding_rs::GBK.decode(&buf);
        s.into_owned()
    } else {
        String::from_utf8_lossy(&buf).into_owned()
    };
    HttpResult {
        status,
        headers,
        body,
        time_ms,
        size,
    }
}

#[tauri::command]
pub async fn http_request(
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
) -> Result<HttpResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if url.trim().is_empty() {
            return Err("请输入请求地址".into());
        }
        let upper = method.to_uppercase();
        if !matches!(upper.as_str(), "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD") {
            return Err(format!("不支持的方法：{method}"));
        }
        let mut req = ureq::request(&upper, url.trim())
            .timeout(Duration::from_secs(30))
            .set("User-Agent", "DevToolbox/0.2");
        for (k, v) in &headers {
            let k = k.trim();
            let v = v.trim();
            if k.is_empty() {
                continue;
            }
            let name_ok = !k.is_empty()
                && k.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b));
            if !name_ok {
                return Err(format!("请求头名称不合法：{k}"));
            }
            if v.contains('\n') || v.contains('\r') {
                return Err(format!("请求头值不合法：{k}"));
            }
            req = req.set(k, v);
        }
        let start = Instant::now();
        let has_body = !body.as_deref().unwrap_or("").is_empty()
            && !matches!(upper.as_str(), "GET" | "HEAD");
        let result = if has_body {
            req.send_string(body.as_deref().unwrap_or(""))
        } else {
            req.call()
        };
        let time_ms = start.elapsed().as_millis() as u64;
        match result {
            Ok(r) => Ok(http_build_result(r, time_ms)),
            // 4xx/5xx 对测试工具来说是正常响应,返回内容而非错误
            Err(ureq::Error::Status(_, r)) => Ok(http_build_result(r, time_ms)),
            Err(e) => Err(format!("请求失败：{e}")),
        }
    })
    .await
    .map_err(|e| format!("任务执行失败：{e}"))?
}

/* ---------- 磁盘分析:重复文件与目录大小 ---------- */

#[derive(Serialize, Clone)]
pub struct DiskFile {
    pub path: String,
    pub size: u64,
}

#[derive(Serialize)]
pub struct DupeGroup {
    pub files: Vec<DiskFile>,
    pub wasted: u64,
}

#[derive(Serialize)]
pub struct DirItem {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub bytes: u64,
    pub files: u64,
}

#[derive(Serialize)]
pub struct DirReport {
    pub total_bytes: u64,
    pub total_files: u64,
    pub items: Vec<DirItem>,
    pub largest: Vec<DiskFile>,
}

fn partial_hash(path: &Path) -> [u8; 16] {
    let mut hasher = Md5::new();
    if let Ok(mut f) = fs::File::open(path) {
        let mut buf = [0u8; 4096];
        if let Ok(n) = std::io::Read::read(&mut f, &mut buf) {
            hasher.update(&buf[..n]);
        }
    }
    hasher.finalize().into()
}

fn full_hash(path: &Path) -> Result<[u8; 16], String> {
    let mut file = fs::File::open(path).map_err(|e| format!("读取失败：{e}"))?;
    let mut hasher = Md5::new();
    std::io::copy(&mut file, &mut hasher).map_err(|e| format!("读取失败：{e}"))?;
    Ok(hasher.finalize().into())
}

fn find_dupes_impl(
    root: String,
    app: &AppHandle,
    stop: &dyn Fn() -> bool,
) -> Result<Vec<DupeGroup>, String> {
    let emit_progress = |phase: &str, done: u64, total: u64| {
        let _ = app.emit(
            "dup://progress",
            serde_json::json!({ "phase": phase, "done": done, "total": total }),
        );
    };
    if !Path::new(&root).is_dir() {
        return Err("请选择有效的文件夹".into());
    }

    // 1 递归收集非空文件
    let mut files: Vec<(PathBuf, u64)> = Vec::new();
    let mut checked = 0u64;
    for entry in WalkDir::new(&root).follow_links(false) {
        checked += 1;
        if checked % 500 == 0 {
            emit_progress("scan", files.len() as u64, 0);
        }
        if stop() {
            return Err(Error::Cancelled.to_string());
        }
        if let Ok(e) = entry {
            if e.file_type().is_file() {
                if let Ok(md) = e.metadata() {
                    if md.len() > 0 {
                        files.push((e.into_path(), md.len()));
                    }
                }
            }
        }
    }

    // 2 按大小分组,只留多副本候选
    let mut by_size: std::collections::HashMap<u64, Vec<PathBuf>> =
        std::collections::HashMap::new();
    for (path, size) in files {
        by_size.entry(size).or_default().push(path);
    }
    let size_groups: Vec<(u64, Vec<PathBuf>)> = by_size
        .into_iter()
        .filter(|(_, v)| v.len() > 1)
        .collect();

    // 3 首块抽样哈希预筛
    let total_part: u64 = size_groups.iter().map(|(_, v)| v.len() as u64).sum();
    let mut done = 0u64;
    let mut candidates: Vec<(u64, Vec<PathBuf>)> = Vec::new();
    for (size, paths) in size_groups {
        let mut m: std::collections::HashMap<[u8; 16], Vec<PathBuf>> =
            std::collections::HashMap::new();
        for path in paths {
            done += 1;
            if done % 200 == 0 {
                emit_progress("part", done, total_part);
            }
            if stop() {
                return Err(Error::Cancelled.to_string());
            }
            let h = partial_hash(&path);
            m.entry(h).or_default().push(path);
        }
        for (_, ps) in m {
            if ps.len() > 1 {
                candidates.push((size, ps));
            }
        }
    }

    // 4 全量哈希确认
    let total_full: u64 = candidates.iter().map(|(_, v)| v.len() as u64).sum();
    let mut done = 0u64;
    let mut groups: Vec<DupeGroup> = Vec::new();
    for (size, paths) in candidates {
        let mut m: std::collections::HashMap<[u8; 16], Vec<DiskFile>> =
            std::collections::HashMap::new();
        for path in paths {
            done += 1;
            if done % 50 == 0 || done == total_full {
                emit_progress("hash", done, total_full);
            }
            if stop() {
                return Err(Error::Cancelled.to_string());
            }
            let h = full_hash(&path)?;
            m.entry(h).or_default().push(DiskFile {
                path: path.to_string_lossy().into_owned(),
                size,
            });
        }
        for (_, fs) in m {
            if fs.len() > 1 {
                let wasted = size * (fs.len() as u64 - 1);
                groups.push(DupeGroup { files: fs, wasted });
            }
        }
    }
    groups.sort_by(|a, b| b.wasted.cmp(&a.wasted));
    groups.truncate(500);
    Ok(groups)
}

#[tauri::command]
pub async fn disk_find_dupes(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    root: String,
) -> Result<Vec<DupeGroup>, String> {
    let cancelled = Arc::new(AtomicBool::new(false));
    *state.cancel_slot.lock().unwrap() = Some(cancelled.clone());
    let task_flag = cancelled.clone();
    let app2 = app.clone();
    let joined = tauri::async_runtime::spawn_blocking(move || {
        find_dupes_impl(root, &app2, &|| task_flag.load(Ordering::Relaxed))
    })
    .await;
    {
        let mut slot = state.cancel_slot.lock().unwrap();
        if slot
            .as_ref()
            .map(|f| Arc::ptr_eq(f, &cancelled))
            .unwrap_or(false)
        {
            *slot = None;
        }
    }
    joined.map_err(|e| format!("任务执行失败：{e}"))?
}

fn walk_size_dir(
    dir: &Path,
    app: &AppHandle,
    counter: &Cell<u64>,
    stop: &dyn Fn() -> bool,
) -> Result<(u64, u64), String> {
    let mut bytes = 0u64;
    let mut files = 0u64;
    let rd = fs::read_dir(dir).map_err(|e| format!("读取失败：{e}"))?;
    for entry in rd {
        if stop() {
            return Err(Error::Cancelled.to_string());
        }
        let entry = entry.map_err(|e| format!("读取失败：{e}"))?;
        let p = entry.path();
        if p.is_dir() {
            let (b, f) = walk_size_dir(&p, app, counter, stop)?;
            bytes += b;
            files += f;
        } else if let Ok(md) = entry.metadata() {
            bytes += md.len();
            files += 1;
            let c = counter.get() + 1;
            counter.set(c);
            if c % 2000 == 0 {
                let _ = app.emit("dirsz://progress", serde_json::json!({ "done": c }));
            }
        }
    }
    Ok((bytes, files))
}

fn keep_top_n(list: &mut Vec<DiskFile>, item: DiskFile, n: usize) {
    if list.len() < n {
        list.push(item);
        list.sort_by(|a, b| b.size.cmp(&a.size));
    } else if let Some(last) = list.last() {
        if item.size > last.size {
            list.pop();
            list.push(item);
            list.sort_by(|a, b| b.size.cmp(&a.size));
        }
    }
}

fn dir_sizes_impl(
    root: String,
    app: &AppHandle,
    stop: &dyn Fn() -> bool,
) -> Result<DirReport, String> {
    let top = PathBuf::from(&root);
    if !top.is_dir() {
        return Err("请选择有效的文件夹".into());
    }
    let counter = Cell::new(0u64);
    let mut largest: Vec<DiskFile> = Vec::new();
    let mut items: Vec<DirItem> = Vec::new();
    let rd = fs::read_dir(&top).map_err(|e| format!("读取失败：{e}"))?;
    for entry in rd {
        if stop() {
            return Err(Error::Cancelled.to_string());
        }
        let entry = entry.map_err(|e| format!("读取失败：{e}"))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_dir = path.is_dir();
        let (bytes, files) = if is_dir {
            walk_size_dir(&path, app, &counter, stop)?
        } else {
            let b = entry.metadata().map(|m| m.len()).unwrap_or(0);
            let c = counter.get() + 1;
            counter.set(c);
            (b, 1)
        };
        if !is_dir {
            keep_top_n(
                &mut largest,
                DiskFile {
                    path: path.to_string_lossy().into_owned(),
                    size: bytes,
                },
                20,
            );
        }
        items.push(DirItem {
            name,
            path: path.to_string_lossy().into_owned(),
            is_dir,
            bytes,
            files,
        });
    }
    // 目录在前、文件在后,各自内部按占用降序
    items.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(b.bytes.cmp(&a.bytes)));
    Ok(DirReport {
        total_bytes: items.iter().map(|i| i.bytes).sum(),
        total_files: items.iter().map(|i| i.files).sum(),
        items,
        largest,
    })
}

#[tauri::command]
pub async fn disk_dir_sizes(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    root: String,
) -> Result<DirReport, String> {
    let cancelled = Arc::new(AtomicBool::new(false));
    *state.cancel_slot.lock().unwrap() = Some(cancelled.clone());
    let task_flag = cancelled.clone();
    let app2 = app.clone();
    let joined = tauri::async_runtime::spawn_blocking(move || {
        dir_sizes_impl(root, &app2, &|| task_flag.load(Ordering::Relaxed))
    })
    .await;
    {
        let mut slot = state.cancel_slot.lock().unwrap();
        if slot
            .as_ref()
            .map(|f| Arc::ptr_eq(f, &cancelled))
            .unwrap_or(false)
        {
            *slot = None;
        }
    }
    joined.map_err(|e| format!("任务执行失败：{e}"))?
}

#[tauri::command]
pub fn disk_trash(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| format!("移入回收站失败：{e}"))
}

/* ---------- 系统监控 ---------- */

#[derive(Serialize)]
pub struct SysDisk {
    pub mount: String,
    pub total: u64,
    pub available: u64,
}

#[derive(Serialize)]
pub struct SysOverview {
    pub cpu_usage: f32,
    pub cores: Vec<f32>,
    pub mem_total: u64,
    pub mem_used: u64,
    pub disks: Vec<SysDisk>,
    pub os_name: String,
    pub uptime_secs: u64,
    pub process_count: usize,
}

#[tauri::command]
pub async fn sys_overview() -> Result<SysOverview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
        // CPU 使用率需要两次采样才有意义
        let mut sys = System::new();
        sys.refresh_cpu_usage();
        std::thread::sleep(Duration::from_millis(250));
        sys.refresh_cpu_usage();
        sys.refresh_memory();
        sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing(),
        );

        let cores: Vec<f32> = sys.cpus().iter().map(|c| c.cpu_usage()).collect();
        let cpu_usage = if cores.is_empty() {
            0.0
        } else {
            cores.iter().sum::<f32>() / cores.len() as f32
        };

        let disks = sysinfo::Disks::new_with_refreshed_list();
        let disk_list: Vec<SysDisk> = disks
            .list()
            .iter()
            .filter(|d| d.total_space() > 0)
            .map(|d| SysDisk {
                mount: d.mount_point().to_string_lossy().into_owned(),
                total: d.total_space(),
                available: d.available_space(),
            })
            .collect();

        let os_name = [
            System::name().unwrap_or_default(),
            System::os_version().unwrap_or_default(),
        ]
        .iter()
        .filter(|s| !s.is_empty())
        .cloned()
        .collect::<Vec<_>>()
        .join(" ");

        Ok(SysOverview {
            cpu_usage: (cpu_usage * 10.0).round() / 10.0,
            cores: cores.iter().map(|c| (c * 10.0).round() / 10.0).collect(),
            mem_total: sys.total_memory(),
            mem_used: sys.used_memory(),
            disks: disk_list,
            os_name,
            uptime_secs: System::uptime(),
            process_count: sys.processes().len(),
        })
    })
    .await
    .map_err(|e| format!("任务执行失败：{e}"))?
}


/* ---------- 进程管理 ---------- */

#[derive(Serialize, Clone)]
pub struct ProcEntry {
    pub pid: u32,
    pub name: String,
    pub path: Option<String>,
    pub cpu: f32,
    pub mem: u64,
    pub start: u64,
}

#[tauri::command]
pub async fn proc_list() -> Result<Vec<ProcEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
        let mut sys = System::new();
        // nothing() 的 cpu/memory 开关默认关闭,必须显式开启
        let kind = ProcessRefreshKind::nothing()
            .with_memory()
            .with_cpu()
            .with_exe(UpdateKind::Always);
        sys.refresh_processes_specifics(ProcessesToUpdate::All, true, kind);
        std::thread::sleep(Duration::from_millis(300));
        sys.refresh_processes_specifics(ProcessesToUpdate::All, true, kind);
        let mut out: Vec<ProcEntry> = sys
            .processes()
            .iter()
            .map(|(pid, p)| ProcEntry {
                pid: pid.as_u32(),
                name: p.name().to_string_lossy().into_owned(),
                path: p.exe().map(|e| e.to_string_lossy().into_owned()),
                cpu: (p.cpu_usage() * 10.0).round() / 10.0,
                mem: p.memory(),
                start: p.start_time(),
            })
            .collect();
        out.sort_by(|a, b| b.mem.cmp(&a.mem).then(a.pid.cmp(&b.pid)));
        Ok(out)
    })
    .await
    .map_err(|e| format!("任务执行失败：{e}"))?
}

/* ---------- 域名解析 ---------- */

#[derive(Serialize, Clone)]
pub struct ResolveEntry {
    pub ip: String,
    pub version: String,
}

#[tauri::command]
pub async fn net_resolve(host: String) -> Result<Vec<ResolveEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::net::ToSocketAddrs;
        let mut host = host.trim().to_string();
        for scheme in ["https://", "http://"] {
            if let Some(rest) = host.strip_prefix(scheme) {
                host = rest.to_string();
                break;
            }
        }
        host = host.split('/').next().unwrap_or("").to_string();
        if !host.contains(']') {
            if let Some(i) = host.rfind(':') {
                let tail = &host[i + 1..];
                if !tail.is_empty() && tail.bytes().all(|c| c.is_ascii_digit()) {
                    host.truncate(i);
                }
            }
        }
        if host.is_empty() {
            return Err("请输入域名或主机名".into());
        }
        let list: Vec<ResolveEntry> = (host.as_str(), 0)
            .to_socket_addrs()
            .map_err(|e| format!("解析失败：{e}"))?
            .map(|a| ResolveEntry {
                ip: a.ip().to_string(),
                version: if a.is_ipv4() { "IPv4" } else { "IPv6" }.into(),
            })
            .collect();
        let mut seen = std::collections::HashSet::new();
        let out: Vec<ResolveEntry> = list
            .into_iter()
            .filter(|e| seen.insert(e.ip.clone()))
            .collect();
        if out.is_empty() {
            return Err("没有解析到任何地址".into());
        }
        Ok(out)
    })
    .await
    .map_err(|e| format!("任务执行失败：{e}"))?
}

/* ---------- 实时日志 ---------- */

pub struct TailHandle {
    pub stop: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct TailState(pub Mutex<Option<TailHandle>>);

fn watch_log(path: PathBuf, app: AppHandle, stop: Arc<AtomicBool>) {
    let mut pos: u64 = match fs::metadata(&path) {
        Ok(md) => md.len().saturating_sub(200 * 1024),
        Err(_) => 0,
    };
    let mut carry = String::new();
    let mut first = true;
    loop {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        if let Ok(md) = fs::metadata(&path) {
            if md.len() < pos {
                // 文件被轮转或清空:通知前端重置后从头读
                pos = 0;
                carry.clear();
                let _ = app.emit("logtail://lines", serde_json::json!({ "reset": true, "lines": [] }));
            }
        }
        if let Ok(mut f) = fs::File::open(&path) {
            if f.seek(SeekFrom::Start(pos)).is_ok() {
                let mut chunk = Vec::new();
                if f.read_to_end(&mut chunk).is_ok() && !chunk.is_empty() {
                    pos += chunk.len() as u64;
                    carry.push_str(&String::from_utf8_lossy(&chunk));
                    if first {
                        // 起始位置在行中间,丢弃残行
                        if let Some(i) = carry.find('\n') {
                            carry.drain(..=i);
                        }
                        first = false;
                    }
                    let mut lines: Vec<String> = Vec::new();
                    while let Some(i) = carry.find('\n') {
                        lines.push(carry[..i].trim_end_matches('\r').to_string());
                        carry.drain(..=i);
                    }
                    if lines.len() > 2000 {
                        let n = lines.len();
                        lines = lines.split_off(n - 2000);
                    }
                    if !lines.is_empty() {
                        let _ = app.emit(
                            "logtail://lines",
                            serde_json::json!({ "reset": false, "lines": lines }),
                        );
                    }
                }
            }
        }
        std::thread::sleep(Duration::from_millis(500));
    }
}

#[tauri::command]
pub async fn log_tail_start(
    app: AppHandle,
    state: tauri::State<'_, TailState>,
    path: String,
) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.is_file() {
        return Err("文件不存在".into());
    }
    let stop = Arc::new(AtomicBool::new(false));
    {
        let mut g = state.0.lock().unwrap();
        if let Some(h) = g.replace(TailHandle { stop: stop.clone() }) {
            h.stop.store(true, Ordering::Relaxed);
        }
    }
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || watch_log(p, app2, stop));
    Ok(())
}

#[tauri::command]
pub async fn log_tail_stop(state: tauri::State<'_, TailState>) -> Result<(), String> {
    if let Some(h) = state.0.lock().unwrap().take() {
        h.stop.store(true, Ordering::Relaxed);
    }
    Ok(())
}
/// 检查文件或目录是否存在,供覆盖确认等场景使用
#[tauri::command]
pub fn path_exists(path: String) -> Result<bool, String> {
    Ok(Path::new(&path).exists())
}

/// 读取任意文件转 Base64(文件转 Base64 工具用),上限 16MB
#[derive(Serialize)]
pub struct FileB64 {
    pub base64: String,
    pub size: u64,
}

#[tauri::command]
pub async fn read_file_base64(path: String) -> Result<FileB64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let meta = fs::metadata(&path).map_err(|e| format!("读取失败：{e}"))?;
        if meta.len() > 16 * 1024 * 1024 {
            return Err("文件超过 16MB，请先压缩或换小文件".into());
        }
        let bytes = fs::read(&path).map_err(|e| format!("读取失败：{e}"))?;
        use base64::engine::general_purpose::STANDARD;
        use base64::Engine as _;
        Ok(FileB64 { base64: STANDARD.encode(&bytes), size: meta.len() })
    })
    .await
    .map_err(|e| format!("任务执行失败：{e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_hash_known_vectors() {
        let dir = std::env::temp_dir().join(format!("devtoolbox-hash-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("abc.txt");
        fs::write(&p, b"abc").unwrap();
        let r = compute_file_hashes(&p, || false, |_, _| {}).unwrap();
        assert_eq!(r.md5, "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(r.sha1, "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert_eq!(
            r.sha256,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            r.sha512,
            "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f"
        );
        assert_eq!(r.size, 3);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn netstat_parse_sample() {
        let sample = "\n  活动连接\n\n  协议  本地地址          外部地址        状态           PID\n\n  TCP    0.0.0.0:135           0.0.0.0:0              LISTENING       1120\n  TCP    [::]:135              [::]:0                 LISTENING       1120\n  TCP    127.0.0.1:8000        0.0.0.0:0              TIME_WAIT       4444\n  UDP    0.0.0.0:5353          *:*                                    5555\n";
        let v = parse_netstat(sample);
        assert_eq!(v.len(), 3);
        assert_eq!(v[0].proto, "TCP");
        assert_eq!(v[0].port, 135);
        assert_eq!(v[1].address, "::");
        assert_eq!(v[2].proto, "UDP");
        assert_eq!(v[2].pid, 5555);
    }
}
