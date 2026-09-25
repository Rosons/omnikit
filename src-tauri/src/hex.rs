//! 二进制查看器:按页读取文件的十六进制窗口与字节序列搜索。
//! 只读、分页,GB 级文件也只读当前 4KB 窗口
use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use serde::Serialize;
use std::io::{Read, Seek, SeekFrom};

/// 每页读取上限
const PAGE_MAX: u64 = 4096;
/// 搜索分块大小
const CHUNK: usize = 1024 * 1024;
/// 搜索默认命中上限
const DEFAULT_MAX_HITS: u32 = 500;

#[derive(Serialize)]
pub struct HexPage {
    pub total: u64,
    pub offset: u64,
    pub data_b64: String,
}

/// 读取 [offset, offset+len) 的字节窗口(base64 返回)
#[tauri::command]
pub fn hex_read(path: String, offset: u64, len: Option<u32>) -> Result<HexPage, String> {
    let mut f = std::fs::File::open(&path).map_err(|e| format!("无法打开文件：{e}"))?;
    let total = f.metadata().map_err(|e| format!("无法读取文件信息：{e}"))?.len();
    let want = len.unwrap_or(PAGE_MAX as u32) as u64;
    let off = offset.min(total);
    let real = want.min(total - off).min(PAGE_MAX) as usize;
    f.seek(SeekFrom::Start(off))
        .map_err(|e| format!("定位失败：{e}"))?;
    let mut buf = vec![0u8; real];
    f.read_exact(&mut buf)
        .map_err(|e| format!("读取失败：{e}"))?;
    Ok(HexPage {
        total,
        offset: off,
        data_b64: STANDARD.encode(&buf),
    })
}

/// 解析用户输入的 hex 字节序列("89 50 4E 47"、"89504e47" 均可)
fn parse_hex_pattern(s: &str) -> Result<Vec<u8>, String> {
    let cleaned: String = s.chars().filter(|c| !c.is_whitespace()).collect();
    if cleaned.len() < 2 || cleaned.len() % 2 != 0 || cleaned.len() > 256 {
        return Err("请输入偶数长度的十六进制字节（1~128 字节），如 89 50 4E 47".into());
    }
    (0..cleaned.len() / 2)
        .map(|i| {
            u8::from_str_radix(&cleaned[i * 2..i * 2 + 2], 16)
                .map_err(|_| format!("不是合法的十六进制：{}", &cleaned[i * 2..i * 2 + 2]))
        })
        .collect()
}

/// 全文件搜索字节序列,返回命中的文件偏移(最多 max_hits 个)。
/// 分块读取,块间保留 pattern-1 字节重叠避免跨块漏检
#[tauri::command]
pub fn hex_search(path: String, pattern: String, max_hits: Option<u32>) -> Result<Vec<u64>, String> {
    let pat = parse_hex_pattern(&pattern)?;
    let cap = max_hits.unwrap_or(DEFAULT_MAX_HITS).min(5000) as usize;
    let mut f = std::fs::File::open(&path).map_err(|e| format!("无法打开文件：{e}"))?;
    let total = f.metadata().map_err(|e| format!("无法读取文件信息：{e}"))?.len();
    let overlap = pat.len() - 1;
    let mut hits = Vec::new();
    let mut block_off: u64 = 0;
    loop {
        if block_off >= total || hits.len() >= cap {
            break;
        }
        f.seek(SeekFrom::Start(block_off))
            .map_err(|e| format!("定位失败：{e}"))?;
        let mut buf = vec![0u8; CHUNK + overlap];
        let n = f.read(&mut buf).map_err(|e| format!("读取失败：{e}"))?;
        if n == 0 {
            break;
        }
        let window = &buf[..n];
        let mut from = 0;
        while hits.len() < cap {
            match twoway_find(window, from, &pat) {
                Some(pos) => {
                    hits.push(block_off + pos as u64);
                    from = pos + 1;
                }
                None => break,
            }
        }
        if n < buf.len() {
            break;
        }
        block_off += CHUNK as u64;
    }
    Ok(hits)
}

/// 简易子串查找(朴素算法对本场景足够:1MB 窗口 × 短模式)
fn twoway_find(hay: &[u8], from: usize, pat: &[u8]) -> Option<usize> {
    if pat.is_empty() || hay.len() < pat.len() {
        return None;
    }
    let last = hay.len() - pat.len();
    let mut i = from.min(last + 1);
    while i <= last {
        if hay[i..i + pat.len()] == *pat {
            return Some(i);
        }
        i += 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{parse_hex_pattern, twoway_find};

    #[test]
    fn hex模式解析() {
        assert_eq!(parse_hex_pattern("89 50 4E 47").unwrap(), vec![0x89, 0x50, 0x4e, 0x47]);
        assert_eq!(parse_hex_pattern("89504e47").unwrap(), vec![0x89, 0x50, 0x4e, 0x47]);
        assert!(parse_hex_pattern("89 5").is_err());
        assert!(parse_hex_pattern("zz").is_err());
        assert!(parse_hex_pattern("").is_err());
    }

    #[test]
    fn 子串查找() {
        let hay = b"\x89PNG\r\n\x1a\nrest\x89PNG tail";
        assert_eq!(twoway_find(hay, 0, b"\x89PNG"), Some(0));
        assert_eq!(twoway_find(hay, 1, b"\x89PNG"), Some(12));
        assert_eq!(twoway_find(hay, 0, b"not-there"), None);
    }
}
