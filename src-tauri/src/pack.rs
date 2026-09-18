use crate::crypto::{build_aad, derive_key, encrypt_piece, make_nonce, PieceKind};
use crate::error::{Error, Result};
use crate::format::*;
use rand::RngCore;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

#[derive(Debug, Clone)]
pub struct Progress {
    pub current_file: String,
    pub files_done: usize,
    pub files_total: usize,
    pub bytes_done: u64,
    pub bytes_total: u64,
}

#[derive(Debug, Clone)]
pub struct PackStats {
    pub files: usize,
    pub bytes: u64,
}

/// 收集结果:文件清单 + 选取阶段被跳过/改名的输入(供前端提示)
pub(crate) struct Collected {
    pub files: Vec<(PathBuf, String)>,
    /// 因已包含在其他所选文件夹中而被跳过的输入
    pub skipped_inputs: Vec<String>,
    /// 同名冲突自动改名的 (原名, 归档名)
    pub renamed_inputs: Vec<(String, String)>,
}

/// 收集待打包文件:目录递归、文件直取;返回 (绝对路径, 归档内相对路径)。
///
/// 选取规则:
/// - 目录输入的相对路径以其目录名开头,文件输入取文件名
/// - 某个输入若与已保留的输入相同或位于其内部,整个跳过(父目录吞并子目录)
/// - 顶层名称冲突(如同名文件夹、同名散文件)时,后者自动加 " (n)" 后缀
pub(crate) fn collect_files(inputs: &[PathBuf]) -> Result<Collected> {
    // 1) 规范化并区分类型;canon 只用于包含关系比较
    let mut items: Vec<(PathBuf, PathBuf, bool, usize)> = Vec::new();
    for (idx, input) in inputs.iter().enumerate() {
        let meta = fs::metadata(input)
            .map_err(|e| Error::BadInput(format!("无法读取 {}：{e}", input.display())))?;
        if !meta.is_dir() && !meta.is_file() {
            return Err(Error::BadInput(format!(
                "不支持的输入类型：{}",
                input.display()
            )));
        }
        let canon = fs::canonicalize(input)
            .map_err(|e| Error::BadInput(format!("无法解析路径 {}：{e}", input.display())))?;
        items.push((input.clone(), canon, meta.is_dir(), idx));
    }

    // 2) 包含关系去重:浅层(父目录)优先保留
    items.sort_by_key(|(_, canon, _, idx)| (canon.components().count(), *idx));
    let mut kept_idx: Vec<usize> = Vec::new();
    let mut kept_canon: Vec<PathBuf> = Vec::new();
    let mut skipped_inputs: Vec<String> = Vec::new();
    for (orig, canon, _, idx) in &items {
        if kept_canon.iter().any(|k| canon.starts_with(k)) {
            skipped_inputs.push(orig.to_string_lossy().into_owned());
            continue;
        }
        kept_canon.push(canon.clone());
        kept_idx.push(*idx);
    }
    kept_idx.sort_unstable(); // 恢复用户选择顺序
    let by_idx: HashMap<usize, &(PathBuf, PathBuf, bool, usize)> =
        items.iter().map(|it| (it.3, it)).collect();

    // 3) 分配顶层名称并逐个收集
    let mut files: Vec<(PathBuf, String)> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut renamed_inputs: Vec<(String, String)> = Vec::new();
    let mut used_top: HashMap<String, u32> = HashMap::new();

    for &idx in &kept_idx {
        let (orig, _, is_dir, _) = by_idx[&idx];
        let base = orig
            .file_name()
            .map(|s| s.to_string_lossy().replace('\\', "/"))
            .filter(|s| !s.is_empty())
            .ok_or_else(|| Error::BadInput(format!("路径缺少名称：{}", orig.display())))?;
        let counter = used_top.entry(base.clone()).or_insert(0);
        *counter += 1;
        let top = if *counter == 1 {
            base
        } else {
            let alt = suffixed_name(&base, *counter, *is_dir);
            renamed_inputs.push((base, alt.clone()));
            alt
        };
        if *is_dir {
            for entry in WalkDir::new(orig)
                .sort_by_file_name()
                .into_iter()
                .filter_map(|e| e.ok())
            {
                if !entry.file_type().is_file() {
                    continue;
                }
                let inner = entry
                    .path()
                    .strip_prefix(orig)
                    .map_err(|e| Error::BadInput(format!("{e}")))?;
                let inner = inner.to_string_lossy().replace('\\', "/");
                let rel = if inner.is_empty() {
                    top.clone()
                } else {
                    format!("{top}/{inner}")
                };
                if seen.insert(rel.clone()) {
                    files.push((entry.path().to_path_buf(), rel));
                }
            }
        } else if seen.insert(top.clone()) {
            files.push((orig.clone(), top));
        }
    }

    if files.is_empty() {
        return Err(Error::BadInput("没有找到可打包的文件".into()));
    }
    Ok(Collected {
        files,
        skipped_inputs,
        renamed_inputs,
    })
}

/// 冲突改名:目录直接加后缀;文件插在扩展名前(readme.txt → readme (2).txt)
fn suffixed_name(name: &str, n: u32, is_dir: bool) -> String {
    if is_dir {
        return format!("{name} ({n})");
    }
    match name.rfind('.') {
        Some(i) if i > 0 => format!("{} ({n}){}", &name[..i], &name[i..]),
        _ => format!("{name} ({n})"),
    }
}

/// 把明文块加密后写入 `密文||tag`,counter 显式传入(meta=0,verify=1,数据从 2 起)
fn write_encrypted(
    w: &mut impl Write,
    key: &[u8; 32],
    prefix: &[u8; 4],
    counter: u64,
    kind: PieceKind,
    file_index: u32,
    chunk_index: u32,
    plaintext: &mut [u8],
) -> Result<()> {
    let nonce = make_nonce(prefix, counter);
    let aad = build_aad(kind, file_index, chunk_index);
    let tag = encrypt_piece(key, &nonce, &aad, plaintext)?;
    w.write_all(plaintext)?;
    w.write_all(&tag)?;
    Ok(())
}

pub fn pack(
    inputs: &[PathBuf],
    password: &str,
    output: &Path,
    should_stop: impl Fn() -> bool,
    mut progress: impl FnMut(Progress),
) -> Result<PackStats> {
    let files = collect_files(inputs)?.files;

    let mut sizes: Vec<u64> = Vec::with_capacity(files.len());
    let mut bytes_total: u64 = 0;
    for (abs, _) in &files {
        let size = fs::metadata(abs)?.len();
        sizes.push(size);
        bytes_total += size;
    }

    let mut salt = [0u8; 16];
    let mut nonce_prefix = [0u8; 4];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    rand::rngs::OsRng.fill_bytes(&mut nonce_prefix);
    let key = derive_key(password, &salt, ARGON_M_KIB, ARGON_T, ARGON_P)?;

    let meta = BoxMeta {
        v: META_VERSION,
        created_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
        files: files
            .iter()
            .zip(&sizes)
            .map(|((_, rel), size)| MetaFile {
                path: rel.clone(),
                size: *size,
            })
            .collect(),
    };
    let meta_json =
        serde_json::to_vec(&meta).map_err(|e| Error::Corrupt(format!("元数据序列化失败：{e}")))?;
    let meta_len = meta_json.len() as u32;
    if meta_len > META_LEN_MAX {
        return Err(Error::BadInput("元数据过大".into()));
    }

    if let Some(parent) = output.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    // 先写 .part,全部成功后再改名成最终 .box
    let part_path = PathBuf::from(format!("{}.part", output.to_string_lossy()));
    let file = fs::File::create(&part_path)?;
    let mut w = BufWriter::new(file);

    w.write_all(MAGIC)?;
    w.write_all(&salt)?;
    w.write_all(&ARGON_M_KIB.to_le_bytes())?;
    w.write_all(&ARGON_T.to_le_bytes())?;
    w.write_all(&ARGON_P.to_le_bytes())?;
    w.write_all(&nonce_prefix)?;

    let mut verify = VERIFY_PLAINTEXT.to_vec();
    write_encrypted(&mut w, &key, &nonce_prefix, 1, PieceKind::Verify, 0, 0, &mut verify)?;
    w.write_all(&meta_len.to_le_bytes())?;
    let mut meta_ct = meta_json;
    write_encrypted(&mut w, &key, &nonce_prefix, 0, PieceKind::Meta, 0, 0, &mut meta_ct)?;

    let files_total = files.len();
    let mut counter: u64 = 2;
    let mut buf = vec![0u8; CHUNK_SIZE as usize];
    let mut bytes_done: u64 = 0;
    let mut result = Ok(());
    'outer: for (idx, (abs, rel)) in files.iter().enumerate() {
        if should_stop() {
            result = Err(Error::Cancelled);
            break 'outer;
        }
        let mut f = match fs::File::open(abs) {
            Ok(f) => f,
            Err(e) => {
                result = Err(Error::from(e));
                break 'outer;
            }
        };
        let mut remaining = sizes[idx];
        let mut chunk_index: u32 = 0;
        while remaining > 0 {
            if should_stop() {
                result = Err(Error::Cancelled);
                break 'outer;
            }
            // 与 unpack 的切块方式严格对齐:除最后一块外必须读满 CHUNK_SIZE
            let want = std::cmp::min(remaining, CHUNK_SIZE) as usize;
            if let Err(e) = f.read_exact(&mut buf[..want]) {
                result = Err(Error::BadInput(format!(
                    "读取 {} 失败（文件在打包期间被改动？）：{e}",
                    rel
                )));
                break 'outer;
            }
            let mut chunk = &mut buf[..want];
            if let Err(e) = write_encrypted(
                &mut w,
                &key,
                &nonce_prefix,
                counter,
                PieceKind::Data,
                idx as u32,
                chunk_index,
                &mut chunk,
            ) {
                result = Err(e);
                break 'outer;
            }
            counter += 1;
            chunk_index += 1;
            remaining -= want as u64;
            bytes_done += want as u64;
            progress(Progress {
                current_file: rel.clone(),
                files_done: idx,
                files_total,
                bytes_done,
                bytes_total,
            });
        }
        // 文件比收集时变大:多出的尾部不进包,直接报错而不是静默丢弃
        if f.read(&mut buf[..1]).map(|n| n != 0).unwrap_or(false) {
            result = Err(Error::BadInput(format!("文件在打包期间发生了变化：{rel}")));
            break 'outer;
        }
        progress(Progress {
            current_file: rel.clone(),
            files_done: idx + 1,
            files_total,
            bytes_done,
            bytes_total,
        });
    }

    if let Err(e) = result {
        drop(w);
        let _ = fs::remove_file(&part_path);
        return Err(e);
    }
    if let Err(e) = w.flush() {
        let _ = fs::remove_file(&part_path);
        return Err(Error::from(e));
    }
    if let Err(e) = w.get_ref().sync_all() {
        let _ = fs::remove_file(&part_path);
        return Err(Error::from(e));
    }
    drop(w);
    // Windows 上 rename 不能覆盖已有文件:输出由命令层/用户确认后才走到这里
    if output.exists() {
        fs::remove_file(output)?;
    }
    fs::rename(&part_path, output)?;

    Ok(PackStats {
        files: files_total,
        bytes: bytes_total,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::unpack;
    use std::sync::atomic::{AtomicU64, Ordering};

    static SEQ: AtomicU64 = AtomicU64::new(0);

    fn tmp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "devtoolbox-test-{}-{}-{}",
            std::process::id(),
            tag,
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn write_file(path: &Path, data: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, data).unwrap();
    }

    /// 确定性伪随机内容,能暴露块错位/偏移类 bug
    fn pattern(len: usize) -> Vec<u8> {
        (0..len).map(|i| (i % 251) as u8).collect()
    }

    fn walk_files(dir: &Path) -> Vec<PathBuf> {
        let mut v: Vec<PathBuf> = WalkDir::new(dir)
            .sort_by_file_name()
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .map(|e| e.path().to_path_buf())
            .collect();
        v.sort();
        v
    }

    fn compare_trees(src: &Path, dst: &Path) {
        let a = walk_files(src);
        let b: Vec<PathBuf> = walk_files(dst)
            .iter()
            .map(|p| src.join(p.strip_prefix(dst).unwrap()))
            .collect();
        assert_eq!(a, b, "还原后的文件树与原始不一致");
        for rel in &a {
            let left = fs::read(rel).unwrap();
            let right = fs::read(dst.join(rel.strip_prefix(src).unwrap())).unwrap();
            assert_eq!(left, right, "内容不一致:{}", rel.display());
        }
    }

    #[test]
    fn round_trip() {
        let base = tmp_dir("base");
        let src = base.join("资料库");
        write_file(&src.join("a.txt"), b"hello devtoolbox");
        write_file(&src.join("empty.bin"), b"");
        write_file(&src.join("odd.bin"), &pattern(1_500_001));
        write_file(&src.join("sub/nested.txt"), b"deep file");
        write_file(&src.join("sub/sub2/deep.bin"), &pattern(2 * 1024 * 1024));
        write_file(&src.join("sub/empty2.bin"), b"");

        let box_path = base.join("test.box");
        let stats = pack(&[src.clone()], "pw123", &box_path, || false, |_| {}).unwrap();
        assert_eq!(stats.files, 6);
        assert_eq!(
            stats.bytes,
            16 + 0 + 1_500_001 + 9 + 2 * 1024 * 1024 + 0
        );

        // 头部:MAGIC
        let mut f = fs::File::open(&box_path).unwrap();
        let mut magic = [0u8; 8];
        f.read_exact(&mut magic).unwrap();
        assert_eq!(&magic, MAGIC);

        // 解密还原
        let dst = base.join("out");
        let ustats = unpack::unpack(&box_path, "pw123", &dst, || false, |_| {}).unwrap();
        assert_eq!(ustats.files, 6);
        compare_trees(&src, &dst.join("资料库"));

        // 错密码必须快速失败(verify 块)
        let dst2 = base.join("out2");
        let err = unpack::unpack(&box_path, "wrong-password", &dst2, || false, |_| {}).unwrap_err();
        assert!(matches!(err, Error::WrongPassword));

        // 目标已有同名文件 → 拒绝覆盖
        let err = unpack::unpack(&box_path, "pw123", &dst, || false, |_| {}).unwrap_err();
        assert!(matches!(err, Error::Conflict(_)));

        // 非 .box 文件
        let junk = base.join("junk.bin");
        fs::write(&junk, b"not a box at all..............").unwrap();
        let err = unpack::unpack(&junk, "pw123", &base.join("out3"), || false, |_| {}).unwrap_err();
        assert!(matches!(err, Error::Corrupt(_)));

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn multi_input_mixed_files_and_dirs() {
        let base = tmp_dir("multi");
        let dir_a = base.join("dirA");
        write_file(&dir_a.join("x/y.txt"), b"xyz");
        write_file(&base.join("loose.txt"), b"loose");
        write_file(&base.join("loose2.txt"), b"loose2");

        let box_path = base.join("m.box");
        let stats = pack(
            &[base.join("loose.txt"), dir_a.clone(), base.join("loose2.txt")],
            "k",
            &box_path,
            || false,
            |_| {},
        )
        .unwrap();
        assert_eq!(stats.files, 3);

        let dst = base.join("out");
        unpack::unpack(&box_path, "k", &dst, || false, |_| {}).unwrap();
        assert_eq!(fs::read(dst.join("loose.txt")).unwrap(), b"loose");
        assert_eq!(fs::read(dst.join("loose2.txt")).unwrap(), b"loose2");
        assert_eq!(fs::read(dst.join("dirA/x/y.txt")).unwrap(), b"xyz");

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn empty_input_and_missing_input() {
        let base = tmp_dir("edge");
        let box_path = base.join("e.box");
        // 没有文件
        let err = pack(&[base.join("不存在.txt")], "k", &box_path, || false, |_| {}).unwrap_err();
        assert!(matches!(err, Error::BadInput(_)));
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    #[ignore] // 手动性能基准:cargo test --release bench_throughput -- --ignored --nocapture
    fn bench_throughput() {
        let base = tmp_dir("bench");
        let big = base.join("big.bin");
        // 固定总量 ≈ 1 GiB,块数随 CHUNK_SIZE 自动折算
        let blocks = (1024 * 1024 * 1024 + CHUNK_SIZE - 1) / CHUNK_SIZE;
        {
            use std::io::Write;
            let mut f = fs::File::create(&big).unwrap();
            let mut b = vec![0xA5u8; CHUNK_SIZE as usize];
            for i in 0..blocks {
                b[0] = i as u8;
                f.write_all(&b).unwrap();
            }
            f.sync_all().unwrap();
        }
        let total = CHUNK_SIZE * blocks;

        let box_path = base.join("bench.box");
        let t0 = std::time::Instant::now();
        pack(&[big.clone()], "bench-pw", &box_path, || false, |_| {}).unwrap();
        let pack_secs = t0.elapsed().as_secs_f64();

        let dst = base.join("out");
        let t1 = std::time::Instant::now();
        unpack::unpack(&box_path, "bench-pw", &dst, || false, |_| {}).unwrap();
        let unpack_secs = t1.elapsed().as_secs_f64();

        println!(
            "\n[bench] 数据 {:.2} GiB | CHUNK {} KiB | 打包 {:.2}s ({:.0} MB/s) | 解包 {:.2}s ({:.0} MB/s)",
            total as f64 / 1073741824.0,
            CHUNK_SIZE / 1024,
            pack_secs,
            total as f64 / 1048576.0 / pack_secs,
            unpack_secs,
            total as f64 / 1048576.0 / unpack_secs,
        );
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn nested_selection_and_name_conflicts() {
        let base = tmp_dir("nest");
        let outer = base.join("data");
        write_file(&outer.join("inner/x.txt"), b"x");
        write_file(&outer.join("top.txt"), b"top");
        let inner = outer.join("inner"); // 被外层包含,应被跳过
        let same_name = base.join("other/data"); // 与 outer 顶层同名,应改名 data (2)
        write_file(&same_name.join("y.txt"), b"y");
        let a = base.join("a");
        let b = base.join("b");
        write_file(&a.join("readme.txt"), b"a");
        write_file(&b.join("readme.txt"), b"b"); // 同名散文件,应改名 readme (2).txt

        let collected = collect_files(&[
            outer,
            inner,
            base.join("other/data"),
            a.join("readme.txt"),
            b.join("readme.txt"),
        ])
        .unwrap();
        let rels: Vec<&str> = collected
            .files
            .iter()
            .map(|(_, r)| r.as_str())
            .collect();
        assert_eq!(
            rels,
            vec![
                "data/inner/x.txt",
                "data/top.txt",
                "data (2)/y.txt",
                "readme.txt",
                "readme (2).txt"
            ]
        );
        assert_eq!(collected.skipped_inputs.len(), 1);
        assert_eq!(collected.renamed_inputs.len(), 2);

        // 端到端:嵌套选择不再产生重复内容
        let box_path = base.join("n.box");
        let stats = pack(
            &[base.join("data"), base.join("data/inner")],
            "k",
            &box_path,
            || false,
            |_| {},
        )
        .unwrap();
        assert_eq!(stats.files, 2);

        let _ = fs::remove_dir_all(&base);
    }
}
