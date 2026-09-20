//! 剪贴板历史:后台轮询监听系统剪贴板,记录文本与图片。
//! 默认加密落盘(密钥存系统凭据库,Windows 凭据管理器/macOS 钥匙串),可关闭(关闭即删除文件)。
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use arboard::{Clipboard, ImageData};
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const MAX_ITEMS: usize = 500;
const MAX_TEXT: usize = 1024 * 1024;
const MAX_PIXELS: usize = 16_000_000;
/// 落盘文件大小上限,超出时从最旧开始丢弃
const FILE_MAX: usize = 32 * 1024 * 1024;
/// 落盘节流:有新记录后至少间隔这么久才写一次盘
const SAVE_INTERVAL: u64 = 3;

#[derive(Serialize, Deserialize, Clone)]
pub struct ClipItem {
    pub id: u64,
    pub kind: String,
    pub text: Option<String>,
    pub image_base64: Option<String>,
    pub width: Option<usize>,
    pub height: Option<usize>,
    pub bytes: u64,
    pub time: u64,
}

#[derive(Default)]
pub struct ClipState {
    pub items: Mutex<Vec<ClipItem>>,
    pub next_id: AtomicU64,
    pub paused: AtomicBool,
    pub last_hash: Mutex<u64>,
    /// 是否加密落盘(来自设置,默认开)
    pub persist: AtomicBool,
    /// 有未写盘的新记录
    pub dirty: AtomicBool,
    /// 上次写盘时间(Unix 秒)
    pub last_save: Mutex<u64>,
    /// 密钥缓存(首次从系统凭据库取出后常驻)
    pub key: Mutex<Option<[u8; 32]>>,
}

fn fnv(data: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in data {
        h ^= b as u64;
        h = h.wrapping_mul(0x100_0000_01b3);
    }
    h
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn encode_png(rgba: &[u8], w: usize, h: usize) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w as u32, h as u32);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut wtr = enc.write_header().map_err(|e| e.to_string())?;
        wtr.write_image_data(rgba).map_err(|e| e.to_string())?;
    }
    Ok(out)
}

fn decode_png(bytes: &[u8]) -> Result<(Vec<u8>, usize, usize), String> {
    let dec = png::Decoder::new(std::io::Cursor::new(bytes));
    let mut rdr = dec.read_info().map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; rdr.output_buffer_size()];
    let info = rdr.next_frame(&mut buf).map_err(|e| e.to_string())?;
    buf.truncate(info.buffer_size());
    Ok((buf, info.width as usize, info.height as usize))
}

fn use_base64(data: &[u8]) -> String {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine as _;
    STANDARD.encode(data)
}

/* ---------- 加密落盘 ---------- */

const KEY_SERVICE: &str = "omnikit";
const KEY_USER: &str = "clipboard-history";

fn clip_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("clipboard").join("history.bin"))
}

/// 从系统凭据库取(没有则生成)剪贴板加密密钥;拿不到凭据库时返回 None,落盘自动停用
fn load_key() -> Option<[u8; 32]> {
    let entry = keyring::Entry::new(KEY_SERVICE, KEY_USER).ok()?;
    let raw = match entry.get_password() {
        Ok(b64) => {
            use base64::engine::general_purpose::STANDARD;
            use base64::Engine as _;
            STANDARD.decode(b64).ok()?
        }
        Err(keyring::Error::NoEntry) => {
            let mut k = [0u8; 32];
            OsRng.fill_bytes(&mut k);
            if entry.set_password(&use_base64(&k)).is_err() {
                return None;
            }
            k.to_vec()
        }
        Err(_) => return None,
    };
    raw.try_into().ok()
}

fn cached_key(state: &ClipState) -> Option<[u8; 32]> {
    let mut g = state.key.lock().unwrap();
    if g.is_none() {
        *g = load_key();
    }
    *g
}

fn encrypt(key: &[u8; 32], plain: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), plain)
        .map_err(|e| e.to_string())?;
    let mut out = nonce.to_vec();
    out.extend(ct);
    Ok(out)
}

fn decrypt(key: &[u8; 32], data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() <= 12 {
        return Err("密文不完整".into());
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    cipher
        .decrypt(Nonce::from_slice(&data[..12]), &data[12..])
        .map_err(|_| "解密失败：密文损坏或密钥不匹配".into())
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ClipFile {
    items: Vec<ClipItem>,
}

/// 把当前历史加密写入磁盘(超限从最旧丢弃,tmp+rename 原子替换)
fn save_now(app: &AppHandle) {
    let st = app.state::<ClipState>();
    if !st.persist.load(Ordering::Relaxed) {
        return;
    }
    let Some(key) = cached_key(&st) else { return };
    let Some(path) = clip_file(app) else { return };
    let plain = {
        let mut items = st.items.lock().unwrap();
        loop {
            let payload = ClipFile { items: items.clone() };
            let Ok(json) = serde_json::to_vec(&payload) else { return };
            if json.len() <= FILE_MAX || items.is_empty() {
                break Some(json);
            }
            // 超限:丢掉最旧的 10% 再试
            let cut = (items.len() / 10).max(1);
            let keep = items.len() - cut;
            items.truncate(keep);
        }
    };
    let Some(json) = plain else { return };
    let Ok(blob) = encrypt(&key, &json) else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let tmp = path.with_extension("bin.tmp");
    if std::fs::write(&tmp, &blob).is_ok() {
        let _ = std::fs::rename(&tmp, &path);
    }
    *st.last_save.lock().unwrap() = now();
    st.dirty.store(false, Ordering::Relaxed);
}

/// 启动时恢复:读到历史后回填内存,续上 id 序列
pub fn clip_init(app: &AppHandle) {
    let st = app.state::<ClipState>();
    st.persist
        .store(crate::settings::load(app).clip_persist, Ordering::Relaxed);
    if !st.persist.load(Ordering::Relaxed) {
        return;
    }
    let Some(key) = cached_key(&st) else {
        eprintln!("[clip] 无法获取系统凭据库密钥，本次运行不落盘");
        return;
    };
    let Some(path) = clip_file(app) else { return };
    let Ok(blob) = std::fs::read(&path) else { return };
    let Ok(json) = decrypt(&key, &blob) else {
        eprintln!("[clip] 历史文件解密失败，忽略");
        return;
    };
    if let Ok(file) = serde_json::from_slice::<ClipFile>(&json) {
        let mut items = st.items.lock().unwrap();
        *items = file.items;
        items.truncate(MAX_ITEMS);
        let max_id = items.first().map(|i| i.id).unwrap_or(0);
        st.next_id.store(max_id + 1, Ordering::Relaxed);
    }
}

/// 节流写盘:有脏数据且距上次写盘超过间隔时执行(监听线程每秒调一次)
fn maybe_save(app: &AppHandle) {
    let st = app.state::<ClipState>();
    if !st.dirty.load(Ordering::Relaxed) {
        return;
    }
    let last = *st.last_save.lock().unwrap();
    if now().saturating_sub(last) >= SAVE_INTERVAL {
        save_now(app);
    }
}

/// 退出钩子用的无条件落盘
pub fn clip_force_save(app: &AppHandle) {
    save_now(app);
}

fn record(app: &AppHandle, item: ClipItem) {
    let st = app.state::<ClipState>();
    let mut items = st.items.lock().unwrap();
    items.insert(0, item);
    items.truncate(MAX_ITEMS);
    drop(items);
    st.dirty.store(true, Ordering::Relaxed);
}

pub fn clip_monitor(app: AppHandle) {
    let Ok(mut cb) = Clipboard::new() else { return };
    loop {
        std::thread::sleep(Duration::from_millis(1000));
        if app
            .state::<ClipState>()
            .paused
            .load(Ordering::Relaxed)
        {
            continue;
        }
        maybe_save(&app);
        // 文本
        if let Ok(text) = cb.get_text() {
            if !text.is_empty() && text.len() <= MAX_TEXT {
                let h = fnv(text.as_bytes());
                let st = app.state::<ClipState>();
let mut last = st.last_hash.lock().unwrap();
                if h != *last {
                    *last = h;
                    drop(last);
                    record(
                        &app,
                        ClipItem {
                            id: app.state::<ClipState>().next_id.fetch_add(1, Ordering::Relaxed),
                            kind: "text".into(),
                            text: Some(text),
                            image_base64: None,
                            width: None,
                            height: None,
                            bytes: 0,
                            time: now(),
                        },
                    );
                    continue;
                }
            }
        }
        // 图片(RGBA → PNG)
        if let Ok(img) = cb.get_image() {
            let ImageData { width, height, bytes } = img;
            if width == 0 || height == 0 || width * height > MAX_PIXELS {
                continue;
            }
            let mut hash_bytes = Vec::with_capacity(bytes.len());
            hash_bytes.extend_from_slice(&width.to_le_bytes());
            hash_bytes.extend_from_slice(&height.to_le_bytes());
            hash_bytes.extend_from_slice(&bytes);
            let h = fnv(&hash_bytes);
            let st = app.state::<ClipState>();
let mut last = st.last_hash.lock().unwrap();
            if h == *last {
                continue;
            }
            *last = h;
            drop(last);
            if let Ok(png_bytes) = encode_png(&bytes, width, height) {
                let b64 = use_base64(&png_bytes);
                let size = png_bytes.len() as u64;
                record(
                    &app,
                    ClipItem {
                        id: app.state::<ClipState>().next_id.fetch_add(1, Ordering::Relaxed),
                        kind: "image".into(),
                        text: None,
                        image_base64: Some(b64),
                        width: Some(width),
                        height: Some(height),
                        bytes: size,
                        time: now(),
                    },
                );
            }
        }
    }
}

#[tauri::command]
pub fn clip_list(state: tauri::State<'_, ClipState>) -> Vec<ClipItem> {
    state.items.lock().unwrap().clone()
}

#[tauri::command]
pub fn clip_set_paused(state: tauri::State<'_, ClipState>, paused: bool) -> Result<(), String> {
    state.paused.store(paused, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub fn clip_write(state: tauri::State<'_, ClipState>, id: u64) -> Result<(), String> {
    let item = {
        let items = state.items.lock().unwrap();
        items.iter().find(|i| i.id == id).cloned()
    };
    let Some(item) = item else {
        return Err("该条记录已不存在".into());
    };
    let mut cb = Clipboard::new().map_err(|e| format!("无法访问剪贴板：{e}"))?;
    if item.kind == "text" {
        let text = item.text.clone().unwrap_or_default();
        cb.set_text(text).map_err(|e| format!("写入失败：{e}"))?;
        let h = 0; // 回贴内容下次轮询会因 last_hash 更新而被跳过
        let _ = h;
        // 主动更新 last_hash,避免监听线程把自己的回贴再记一条
        let text2 = item.text.clone().unwrap_or_default();
        *state.last_hash.lock().unwrap() = fnv(text2.as_bytes());
    } else {
        let b64 = item.image_base64.clone().unwrap_or_default();
        let png_bytes = {
            use base64::engine::general_purpose::STANDARD;
            use base64::Engine as _;
            STANDARD.decode(b64).map_err(|e| format!("解码失败：{e}"))?
        };
        let (rgba, w, h) = decode_png(&png_bytes)?;
        cb.set_image(ImageData {
            width: w,
            height: h,
            bytes: Cow::Owned(rgba.clone()),
        })
        .map_err(|e| format!("写入失败：{e}"))?;
        let mut hb = Vec::new();
        hb.extend_from_slice(&(w as u64).to_le_bytes());
        hb.extend_from_slice(&(h as u64).to_le_bytes());
        hb.extend_from_slice(&rgba);
        *state.last_hash.lock().unwrap() = fnv(&hb);
    }
    Ok(())
}

#[tauri::command]
pub fn clip_clear(state: tauri::State<'_, ClipState>, app: AppHandle) -> Result<(), String> {
    state.items.lock().unwrap().clear();
    // 清空即删盘上历史,避免留下已「清空」的旧数据
    if let Some(path) = clip_file(&app) {
        let _ = std::fs::remove_file(path);
    }
    state.dirty.store(false, Ordering::Relaxed);
    Ok(())
}

/// 切换加密落盘:关闭时删除历史文件,开启时立即写一次盘
#[tauri::command]
pub fn clip_set_persist(state: tauri::State<'_, ClipState>, app: AppHandle, persist: bool) -> Result<(), String> {
    state.persist.store(persist, Ordering::Relaxed);
    // 同步进 settings.json,重启后保持
    {
        let st = app.state::<crate::settings::SettingsState>();
        let mut s = st.0.lock().unwrap().clone();
        s.clip_persist = persist;
        crate::settings::save(&app, &s);
        *st.0.lock().unwrap() = s;
    }
    if persist {
        save_now(&app);
    } else if let Some(path) = clip_file(&app) {
        let _ = std::fs::remove_file(path);
    }
    Ok(())
}
