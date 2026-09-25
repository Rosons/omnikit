//! CSV 查看器:分页读取、内容筛选与列概况。全程流式,几十 MB 的文件
//! 也只按需取每页 100 行;分隔符自动识别(逗号/分号/制表符/竖线)
use csv::{ReaderBuilder, StringRecord, Terminator};
use serde::Serialize;
use std::io::Read;

/// 每页行数(前端固定分页)
pub const PAGE_SIZE: usize = 100;
/// 列概况里每列去重集合的上限,超出记为 ">10000"
const DISTINCT_CAP: usize = 10_000;
/// 筛选时最多返回的匹配行数
const FILTER_LIMIT: usize = 200;
/// 单元格显示上限
const CELL_CAP: usize = 500;

fn open_reader() -> ReaderBuilder {
    let mut b = ReaderBuilder::new();
    b.flexible(true)
        .has_headers(false)
        .terminator(Terminator::Any(b'\n'))
        .buffer_capacity(256 * 1024);
    b
}

/// 探测分隔符:读文件头 4KB,统计各候选字符出现次数取最多
fn detect_delimiter(bytes: &[u8]) -> u8 {
    let head = &bytes[..bytes.len().min(4096)];
    let mut best = b',';
    let mut best_n = 0u32;
    for &d in &[b',', b';', b'\t', b'|'] {
        let n = head.iter().filter(|&&c| c == d).count() as u32;
        if n > best_n {
            best = d;
            best_n = n;
        }
    }
    best
}

/// 非 glossy 的字符串截断:超长单元格截断加省略号,避免前端渲染爆掉
fn cap_cell(s: &str) -> String {
    if s.chars().count() > CELL_CAP {
        let cut: String = s.chars().take(CELL_CAP).collect();
        format!("{cut}…")
    } else {
        s.to_string()
    }
}

/// UTF-8 优先,含无效字节时按 GBK 解码(中文环境的老导出文件常见)
fn decode_bytes(raw: &[u8]) -> String {
    match std::str::from_utf8(raw) {
        Ok(s) => s.to_string(),
        Err(_) => {
            let (t, _, _) = encoding_rs::GBK.decode(raw);
            t.into_owned()
        }
    }
}

#[derive(Serialize)]
pub struct CsvMeta {
    pub headers: Vec<String>,
    pub row_count: u64,
    pub delimiter: String,
    pub size: u64,
}

/// 打开文件:返回表头、总行数与检测到的分隔符(不区分表头行,第一行即表头)
#[tauri::command]
pub fn csv_open(path: String) -> Result<CsvMeta, String> {
    let raw = std::fs::read(&path).map_err(|e| format!("无法读取文件：{e}"))?;
    let size = raw.len() as u64;
    let delim = detect_delimiter(&raw);
    let text = decode_bytes(&raw);
    let mut rdr = open_reader()
        .delimiter(delim)
        .from_reader(text.as_bytes());
    let mut headers = Vec::new();
    let mut row_count: u64 = 0;
    let mut first = true;
    for rec in rdr.records() {
        let rec = rec.map_err(|e| format!("解析失败：{e}"))?;
        if first {
            headers = rec.iter().map(cap_cell).collect();
            first = false;
        } else {
            row_count += 1;
        }
    }
    if first {
        return Err("文件是空的".into());
    }
    Ok(CsvMeta {
        headers,
        row_count,
        delimiter: (delim as char).to_string(),
        size,
    })
}

#[derive(Serialize)]
pub struct CsvPage {
    pub rows: Vec<Vec<String>>,
    /// 使用筛选时的总匹配行数(不用筛选时为 None)
    pub matched_total: Option<u64>,
}

/// 分页取数据行(offset 从 0 计,不含表头)。
/// 带筛选条件时全表扫描,返回匹配的前 FILTER_LIMIT 行与匹配总数
#[tauri::command]
pub fn csv_rows(
    path: String,
    offset: u64,
    limit: Option<u64>,
    filter_col: Option<i64>,
    filter_text: Option<String>,
) -> Result<CsvPage, String> {
    let raw = std::fs::read(&path).map_err(|e| format!("无法读取文件：{e}"))?;
    let delim = detect_delimiter(&raw);
    let text = decode_bytes(&raw);
    let limit = limit.unwrap_or(PAGE_SIZE as u64).clamp(1, 1000);
    let mut rdr = open_reader()
        .delimiter(delim)
        .from_reader(text.as_bytes());
    let needle = filter_text.as_deref().unwrap_or("").to_lowercase();
    let filtering = filter_col.unwrap_or(-1) >= 0 && !needle.is_empty();
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut data_idx: u64 = 0;
    let mut matched: u64 = 0;
    let mut skipped: u64 = 0;
    let mut first = true;
    for rec in rdr.records() {
        let rec: StringRecord = rec.map_err(|e| format!("解析失败：{e}"))?;
        if first {
            first = false;
            continue;
        }
        let cells: Vec<String> = rec.iter().map(cap_cell).collect();
        if filtering {
            let hit = match filter_col {
                Some(c) if (c as usize) < cells.len() => cells[c as usize].to_lowercase().contains(&needle),
                _ => cells.iter().any(|c| c.to_lowercase().contains(&needle)),
            };
            if !hit {
                continue;
            }
            matched += 1;
            if rows.len() < FILTER_LIMIT {
                rows.push(cells);
            }
        } else {
            if data_idx >= offset && skipped < limit {
                rows.push(cells);
                skipped += 1;
            }
            data_idx += 1;
        }
    }
    let matched_total = if filtering { Some(matched) } else { None };
    Ok(CsvPage { rows, matched_total })
}

#[derive(Serialize)]
pub struct ColStat {
    pub name: String,
    pub non_empty: u64,
    pub distinct: String,
}

/// 列概况:全表流式扫一遍,统计每列非空数与去重数
#[tauri::command]
pub fn csv_stats(path: String) -> Result<Vec<ColStat>, String> {
    let raw = std::fs::read(&path).map_err(|e| format!("无法读取文件：{e}"))?;
    let delim = detect_delimiter(&raw);
    let text = decode_bytes(&raw);
    let mut rdr = open_reader()
        .delimiter(delim)
        .from_reader(text.as_bytes());
    let mut names: Vec<String> = Vec::new();
    let mut non_empty: Vec<u64> = Vec::new();
    let mut sets: Vec<std::collections::HashSet<String>> = Vec::new();
    for rec in rdr.records() {
        let rec = rec.map_err(|e| format!("解析失败：{e}"))?;
        if names.is_empty() {
            for c in rec.iter() {
                names.push(cap_cell(c));
                non_empty.push(0);
                sets.push(std::collections::HashSet::new());
            }
            continue;
        }
        for (i, c) in rec.iter().enumerate() {
            if i >= names.len() {
                break;
            }
            if !c.trim().is_empty() {
                non_empty[i] += 1;
                if sets[i].len() < DISTINCT_CAP {
                    sets[i].insert(c.to_string());
                }
            }
        }
    }
    if names.is_empty() {
        return Err("文件是空的".into());
    }
    Ok(names
        .into_iter()
        .zip(non_empty)
        .zip(sets)
        .map(|((name, ne), set)| ColStat {
            name,
            non_empty: ne,
            distinct: if set.len() >= DISTINCT_CAP {
                format!(">{}", DISTINCT_CAP)
            } else {
                set.len().to_string()
            },
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::{cap_cell, detect_delimiter};

    #[test]
    fn 分隔符识别() {
        assert_eq!(detect_delimiter(b"a,b,c\n1,2,3"), b',');
        assert_eq!(detect_delimiter(b"a;b;c\n1;2;3"), b';');
        assert_eq!(detect_delimiter(b"a\tb\n1\t2"), b'\t');
        assert_eq!(detect_delimiter(b"a|b\n1|2"), b'|');
    }

    #[test]
    fn 长单元格截断() {
        let long = "好".repeat(600);
        let out = cap_cell(&long);
        assert_eq!(out.chars().count(), 501);
        assert!(out.ends_with('…'));
        assert_eq!(cap_cell("短"), "短");
    }
}
