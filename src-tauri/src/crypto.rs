use crate::error::{Error, Result};
use crate::format::MAGIC;
use aes_gcm::aead::{AeadInPlace, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce, Tag};
use argon2::{Algorithm, Argon2, Params, Version};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PieceKind {
    Meta,
    Verify,
    Data,
}

impl PieceKind {
    fn tag(self) -> &'static [u8; 4] {
        match self {
            PieceKind::Meta => b"meta",
            PieceKind::Verify => b"vrfy",
            PieceKind::Data => b"data",
        }
    }
}

/// Argon2id 派生 32 字节 AES-256 密钥
pub fn derive_key(password: &str, salt: &[u8], m_kib: u32, t: u32, p: u32) -> Result<[u8; 32]> {
    let params =
        Params::new(m_kib, t, p, Some(32)).map_err(|e| Error::BadInput(format!("KDF 参数不合法：{e}")))?;
    let a2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    a2.hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| Error::Corrupt(format!("密钥派生失败：{e}")))?;
    Ok(key)
}

/// nonce = prefix(4B) || counter(u64 LE);counter 分配:meta=0,verify=1,数据块从 2 起全局递增
pub fn make_nonce(prefix: &[u8; 4], counter: u64) -> [u8; 12] {
    let mut nonce = [0u8; 12];
    nonce[..4].copy_from_slice(prefix);
    nonce[4..].copy_from_slice(&counter.to_le_bytes());
    nonce
}

/// AAD = MAGIC || kind_tag || file_index(u32 LE) || chunk_index(u32 LE),共 20 字节
pub fn build_aad(kind: PieceKind, file_index: u32, chunk_index: u32) -> [u8; 20] {
    let mut aad = [0u8; 20];
    aad[..8].copy_from_slice(MAGIC);
    aad[8..12].copy_from_slice(kind.tag());
    aad[12..16].copy_from_slice(&file_index.to_le_bytes());
    aad[16..20].copy_from_slice(&chunk_index.to_le_bytes());
    aad
}

/// 原地加密 `plaintext`,返回 16 字节 GCM tag(调用方负责按 密文||tag 顺序落盘)
pub fn encrypt_piece(
    key: &[u8; 32],
    nonce: &[u8; 12],
    aad: &[u8],
    plaintext: &mut [u8],
) -> Result<[u8; 16]> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| Error::Corrupt(format!("{e}")))?;
    let tag = cipher
        .encrypt_in_place_detached(Nonce::from_slice(nonce), aad, plaintext)
        .map_err(|_| Error::Corrupt("加密失败".into()))?;
    let mut out = [0u8; 16];
    out.copy_from_slice(tag.as_slice());
    Ok(out)
}

/// 原地解密 `ciphertext`(不含 tag);认证失败返回 Err,由调用方决定映射成 WrongPassword 还是 Corrupt
pub fn decrypt_piece(
    key: &[u8; 32],
    nonce: &[u8; 12],
    aad: &[u8],
    ciphertext: &mut [u8],
    tag: &[u8],
) -> std::result::Result<(), aes_gcm::Error> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| aes_gcm::Error)?;
    cipher.decrypt_in_place_detached(Nonce::from_slice(nonce), aad, ciphertext, Tag::from_slice(tag))
}
