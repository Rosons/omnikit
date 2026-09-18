use serde::{Deserialize, Serialize};

/// .box 容器格式 v1
///
/// ```text
/// 偏移  大小  字段
/// 0     8    MAGIC = b"DBOXv001"
/// 8     16   argon2 salt(随机)
/// 24    4    m_kib  u32 LE
/// 28    4    t      u32 LE
/// 32    4    p      u32 LE
/// 36    4    nonce_prefix(随机 4 字节)
/// 40    27   verify 块密文 = 11B 明文 b"DBOX-VERIFY" + 16B GCM tag
/// 67    4    meta_len u32 LE(明文 JSON 字节数)
/// 71    N    meta 密文 = JSON + 16B tag
/// ...        数据区:逐块 = 密文(明文 chunk + 16B tag)
/// ```
pub const MAGIC: &[u8; 8] = b"DBOXv001";

/// 明文分块大小:1 MiB
pub const CHUNK_SIZE: u64 = 1024 * 1024;

// 以下偏移量为格式文档常量(解包时一次性读取 40 字节定长头,不逐字段 seek)
#[allow(dead_code)]
pub const OFF_SALT: u64 = 8;
#[allow(dead_code)]
pub const OFF_M_KIB: u64 = 24;
#[allow(dead_code)]
pub const OFF_T: u64 = 28;
#[allow(dead_code)]
pub const OFF_P: u64 = 32;
#[allow(dead_code)]
pub const OFF_NONCE_PREFIX: u64 = 36;
pub const OFF_VERIFY: u64 = 40;
pub const OFF_META_LEN: u64 = 67;
pub const OFF_META: u64 = 71;

pub const VERIFY_CIPHER_LEN: usize = 11 + 16;
/// 元数据明文长度上限 512 MiB(防异常长度导致超大分配)
pub const META_LEN_MAX: u32 = 512 * 1024 * 1024;
/// GCM tag 固定 16 字节
pub const TAG_LEN: usize = 16;

pub const ARGON_M_KIB: u32 = 65536;
pub const ARGON_T: u32 = 3;
pub const ARGON_P: u32 = 1;

pub const VERIFY_PLAINTEXT: &[u8; 11] = b"DBOX-VERIFY";
pub const META_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetaFile {
    /// 归档内相对路径,统一正斜杠
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoxMeta {
    pub v: u32,
    pub created_at: u64,
    pub files: Vec<MetaFile>,
}
