use crate::crypto::{build_aad, decrypt_piece, derive_key, make_nonce, PieceKind};
use crate::error::{Error, Result};
use crate::format::*;
use crate::pack::Progress;
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone)]
pub struct UnpackStats {
    pub files: usize,
    pub bytes: u64,
}

/// 路径清洗防 zip-slip:只接受 Normal 组件(拒绝绝对路径、`..`、`.` 等)
fn clean_rel(rel: &str) -> Result<PathBuf> {
    let mut clean = PathBuf::new();
    for comp in Path::new(rel).components() {
        match comp {
            Component::Normal(seg) => clean.push(seg),
            _ => return Err(Error::Corrupt(format!("元数据含非法路径组件：{rel}"))),
        }
    }
    if clean.as_os_str().is_empty() {
        return Err(Error::Corrupt(format!("元数据路径为空：{rel}")));
    }
    Ok(clean)
}

/// 取消时删除已解出的半成品文件(尽力而为)
fn cleanup_created(created: &[PathBuf]) {
    for f in created {
        let _ = fs::remove_file(f);
    }
}

pub fn unpack(
    box_path: &Path,
    password: &str,
    out_dir: &Path,
    should_stop: impl Fn() -> bool,
    mut progress: impl FnMut(Progress),
) -> Result<UnpackStats> {
    let mut f = fs::File::open(box_path)?;

    // 固定头 40 字节
    let mut head = [0u8; 40];
    f.read_exact(&mut head)
        .map_err(|_| Error::Corrupt("文件太小，不是有效的 .box".into()))?;
    if &head[..8] != MAGIC {
        return Err(Error::Corrupt("不是有效的 .box 文件（MAGIC 不匹配）".into()));
    }
    let mut salt = [0u8; 16];
    salt.copy_from_slice(&head[8..24]);
    let m = u32::from_le_bytes(head[24..28].try_into().unwrap());
    let t = u32::from_le_bytes(head[28..32].try_into().unwrap());
    let p = u32::from_le_bytes(head[32..36].try_into().unwrap());
    let mut nonce_prefix = [0u8; 4];
    nonce_prefix.copy_from_slice(&head[36..40]);
    if !(8192..=1_048_576).contains(&m) || t == 0 || t > 64 || p == 0 || p > 64 {
        return Err(Error::Corrupt("KDF 参数异常".into()));
    }
    let key = derive_key(password, &salt, m, t, p)?;

    // verify 块:错密码在此快速失败
    let mut verify_ct = [0u8; VERIFY_CIPHER_LEN];
    f.seek(SeekFrom::Start(OFF_VERIFY))?;
    f.read_exact(&mut verify_ct)?;
    let (v_plain, v_tag) = verify_ct.split_at_mut(VERIFY_PLAINTEXT.len());
    decrypt_piece(
        &key,
        &make_nonce(&nonce_prefix, 1),
        &build_aad(PieceKind::Verify, 0, 0),
        v_plain,
        v_tag,
    )
    .map_err(|_| Error::WrongPassword)?;

    // meta
    // meta_len 记录的是明文 JSON 字节数;磁盘上密文 = 明文 + 16B tag
    f.seek(SeekFrom::Start(OFF_META_LEN))?;
    let mut len_buf = [0u8; 4];
    f.read_exact(&mut len_buf)?;
    let meta_len = u32::from_le_bytes(len_buf);
    if meta_len > META_LEN_MAX {
        return Err(Error::Corrupt("元数据长度异常".into()));
    }
    let mut meta_ct = vec![0u8; meta_len as usize + TAG_LEN];
    f.read_exact(&mut meta_ct)
        .map_err(|_| Error::Corrupt("元数据被截断".into()))?;
    let meta_split = meta_ct.len() - TAG_LEN;
    let (m_plain, m_tag) = meta_ct.split_at_mut(meta_split);
    decrypt_piece(
        &key,
        &make_nonce(&nonce_prefix, 0),
        &build_aad(PieceKind::Meta, 0, 0),
        m_plain,
        m_tag,
    )
    .map_err(|_| Error::Corrupt("元数据解密失败".into()))?;
    let meta: BoxMeta = serde_json::from_slice(m_plain)
        .map_err(|_| Error::Corrupt("元数据解析失败".into()))?;
    if meta.files.is_empty() {
        return Err(Error::Corrupt("元数据里没有任何文件".into()));
    }

    // 解密前预检:路径清洗 + 输出冲突(存在同名文件则整体报错不覆盖)
    let mut targets: Vec<(PathBuf, &MetaFile)> = Vec::with_capacity(meta.files.len());
    let mut conflicts: Vec<String> = Vec::new();
    for mf in &meta.files {
        let target = out_dir.join(clean_rel(&mf.path)?);
        if target.exists() {
            conflicts.push(mf.path.clone());
        }
        targets.push((target, mf));
    }
    if !conflicts.is_empty() {
        // 只展示前 3 个相对路径,总数写进提示,避免错误横幅被绝对路径刷屏
        let total = conflicts.len();
        let mut msg = format!("输出位置已有 {total} 个同名文件，为防覆盖已中止：");
        msg.push_str(&conflicts.iter().take(3).cloned().collect::<Vec<_>>().join("、"));
        if total > 3 {
            msg.push_str(" 等");
        }
        return Err(Error::Conflict(msg));
    }

    fs::create_dir_all(out_dir)?;
    let files_total = meta.files.len();
    let bytes_total: u64 = meta.files.iter().map(|f| f.size).sum();
    let mut buf = vec![0u8; (CHUNK_SIZE + TAG_LEN as u64) as usize];
    let mut counter: u64 = 2;
    let mut bytes_done: u64 = 0;
    // 已创建的输出文件,取消时逐一删除,不留半成品
    let mut created: Vec<PathBuf> = Vec::new();

    f.seek(SeekFrom::Start(OFF_META + meta_ct.len() as u64))?;
    for (idx, (target, mf)) in targets.iter().enumerate() {
        if should_stop() {
            cleanup_created(&created);
            return Err(Error::Cancelled);
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut out = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(target)
            .map_err(|e| match e.kind() {
                std::io::ErrorKind::AlreadyExists => {
                    Error::Conflict(format!(
                        "输出位置已有同名文件，为防覆盖已中止：{}",
                        mf.path
                    ))
                }
                _ => Error::Io(e),
            })?;
        created.push(target.clone());
        let mut remaining = mf.size;
        let mut chunk_index: u32 = 0;
        while remaining > 0 {
            if should_stop() {
                drop(out);
                cleanup_created(&created);
                return Err(Error::Cancelled);
            }
            let want = std::cmp::min(remaining, CHUNK_SIZE) as usize;
            let ct_len = want + TAG_LEN;
            f.read_exact(&mut buf[..ct_len])
                .map_err(|_| Error::Corrupt("数据区提前结束，保险箱可能被截断".into()))?;
            let (ct_full, _) = buf.split_at_mut(ct_len);
            let (ct, tag) = ct_full.split_at_mut(want);
            decrypt_piece(
                &key,
                &make_nonce(&nonce_prefix, counter),
                &build_aad(PieceKind::Data, idx as u32, chunk_index),
                ct,
                tag,
            )
            .map_err(|_| Error::Corrupt(format!("数据块校验失败：{}", mf.path)))?;
            counter += 1;
            chunk_index += 1;
            out.write_all(ct)?;
            remaining -= want as u64;
            bytes_done += want as u64;
            progress(Progress {
                current_file: mf.path.clone(),
                files_done: idx,
                files_total,
                bytes_done,
                bytes_total,
            });
        }
        progress(Progress {
            current_file: mf.path.clone(),
            files_done: idx + 1,
            files_total,
            bytes_done,
            bytes_total,
        });
    }

    // 防截断/损坏:数据区之后不应再有任何字节
    let mut extra = [0u8; 1];
    if f.read(&mut extra)? != 0 {
        return Err(Error::Corrupt("数据区之后存在多余数据".into()));
    }
    Ok(UnpackStats {
        files: files_total,
        bytes: bytes_total,
    })
}
