//! 剪贴板历史:后台轮监听系统剪贴板,记录文本与图片,全部只存内存、不落盘、不联网
use arboard::{Clipboard, ImageData};
use serde::Serialize;
use std::borrow::Cow;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const MAX_ITEMS: usize = 500;
const MAX_TEXT: usize = 1024 * 1024;
const MAX_PIXELS: usize = 16_000_000;

#[derive(Serialize, Clone)]
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

fn record(app: &AppHandle, item: ClipItem) {
    let st = app.state::<ClipState>();
    let mut items = st.items.lock().unwrap();
    items.insert(0, item);
    items.truncate(MAX_ITEMS);
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
pub fn clip_clear(state: tauri::State<'_, ClipState>) -> Result<(), String> {
    state.items.lock().unwrap().clear();
    Ok(())
}
