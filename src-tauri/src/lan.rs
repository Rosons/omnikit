//! 局域网设备扫描:并发 TCP 探测本机网段内的存活主机与常见端口,
//! 按开放端口推断设备类型。探测走 TCP 连接,不需要 ICMP 的管理员权限。
use serde::Serialize;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream, UdpSocket};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// 默认探测端口:覆盖常见系统服务与管理界面,并据此推断设备类型
const PORTS: &[u16] = &[22, 80, 443, 445, 3389, 5000, 5357, 7000, 8080, 9100];
/// 单次连接超时,局域网内 400ms 足够
const TIMEOUT: Duration = Duration::from_millis(400);
/// 并发工作线程数
const WORKERS: usize = 32;
/// 可扫描主机数上限,防止误填大网段造成全量扫描
const MAX_HOSTS: usize = 4096;
/// 主机名反查子进程的超时
const LOOKUP_TIMEOUT: Duration = Duration::from_millis(1200);

#[derive(Default)]
pub struct LanState {
    pub busy: AtomicBool,
    pub stop: AtomicBool,
}

#[derive(Serialize, Clone)]
pub struct LanDevice {
    pub ip: String,
    pub hostname: String,
    pub ports: Vec<u16>,
    pub guess: String,
}

/// 本机在局域网中的 IP:UDP connect 不真正发包,读路由出口地址。
/// 离线或无默认路由时失败,由前端提示手动填网段
#[tauri::command]
pub fn lan_local_ip() -> Result<String, String> {
    let s = UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    s.connect("223.5.5.5:53").map_err(|e| e.to_string())?;
    Ok(s.local_addr().map_err(|e| e.to_string())?.ip().to_string())
}

/// 解析 "a.b.c.d/前缀" 为可扫描主机列表(排除网络地址与广播地址)
fn hosts_of(cidr: &str) -> Result<Vec<Ipv4Addr>, String> {
    let (ip_s, prefix_s) = cidr
        .split_once('/')
        .ok_or("格式应为 a.b.c.d/前缀，如 192.168.1.0/24")?;
    let ip: Ipv4Addr = ip_s
        .trim()
        .parse()
        .map_err(|_| format!("IP 不合法：{ip_s}"))?;
    let prefix: u32 = prefix_s
        .trim()
        .parse()
        .map_err(|_| format!("前缀不合法：{prefix_s}"))?;
    if prefix > 32 {
        return Err(format!("前缀应在 0~32：{prefix}"));
    }
    let mask = if prefix == 0 {
        0
    } else {
        u32::MAX << (32 - prefix)
    };
    let net = u32::from(ip) & mask;
    let size: u64 = 1u64 << (32 - prefix);
    if size < 3 {
        return Err("网段没有可扫描的主机地址".into());
    }
    let usable = size - 2;
    if usable > MAX_HOSTS as u64 {
        return Err(format!(
            "网段共 {usable} 个主机地址，超出上限 {MAX_HOSTS}，请缩小前缀（如 /24）"
        ));
    }
    Ok((1..size - 1).map(|i| Ipv4Addr::from(net + i as u32)).collect())
}

/// 按开放端口推断设备类型(顺序即优先级)
fn guess_kind(ports: &[u16]) -> String {
    let has = |p: u16| ports.contains(&p);
    if has(9100) {
        return "打印机".into();
    }
    if has(8009) {
        return "投屏设备".into();
    }
    if has(7000) {
        return "Apple 设备".into();
    }
    if has(445) || has(3389) {
        return "Windows 电脑".into();
    }
    if has(5000) {
        return "NAS".into();
    }
    if has(22) && has(443) {
        return "服务器 / NAS".into();
    }
    if has(22) {
        return "Linux 设备".into();
    }
    "网络设备".into()
}

/// 反查主机名:nslookup 双平台自带,输出可能是中英文,宽容取名字行。
/// 局域网内常无反向记录,拿不到就留空,不阻塞扫描
fn hostname_of(ip: &str) -> String {
    let Ok(mut child) = crate::commands::hidden_command("nslookup").arg(ip).stdout(Stdio::piped()).stderr(Stdio::null()).spawn() else {
        return String::new();
    };
    let deadline = std::time::Instant::now() + LOOKUP_TIMEOUT;
    let stdout = loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                let _ = child.wait();
                break child.stdout.take();
            }
            Ok(None) if std::time::Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return String::new();
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(40)),
            Err(_) => return String::new(),
        }
    };
    let Some(mut out) = stdout else { return String::new() };
    let mut text = String::new();
    if std::io::Read::read_to_string(&mut out, &mut text).is_err() {
        return String::new();
    }
    for line in text.lines() {
        let t = line.trim();
        // 名字行前缀兼容中英文 nslookup 输出,剥掉前缀与冒号取名字
        for key in ["Name", "名称", "名字"] {
            if let Some(rest) = t.strip_prefix(key) {
                let name = rest.trim_start_matches(':').trim();
                if !name.is_empty() {
                    return name.to_string();
                }
            }
        }
    }
    String::new()
}

/// 启动网段扫描:后台 32 线程并发 TCP 探测,结果流式发事件——
/// 每发现一台发 lan://device(LanDevice),进度发 lan://progress(done,total),
/// 结束发 lan://done(发现台数);结果不落盘、不缓存,纯内存
#[tauri::command]
pub fn lan_probe_start(
    app: AppHandle,
    state: tauri::State<'_, LanState>,
    cidr: String,
) -> Result<(), String> {
    if state.busy.swap(true, Ordering::Relaxed) {
        return Err("已有扫描在进行，请先停止或等待完成".into());
    }
    let hosts = hosts_of(&cidr)?;
    state.stop.store(false, Ordering::Relaxed);
    std::thread::spawn(move || {
        let total = hosts.len();
        let done = std::sync::Arc::new(AtomicUsize::new(0));
        let found = std::sync::Arc::new(AtomicUsize::new(0));
        let chunk = total.div_ceil(WORKERS);
        std::thread::scope(|s| {
            for part in hosts.chunks(chunk) {
                let app = &app;
                let done = &done;
                let found = &found;
                s.spawn(move || {
                    for ip in part {
                        if app.state::<LanState>().stop.load(Ordering::Relaxed) {
                            return;
                        }
                        let mut open: Vec<u16> = Vec::new();
                        for &p in PORTS {
                            let addr = SocketAddr::new(IpAddr::from(*ip), p);
                            if TcpStream::connect_timeout(&addr, TIMEOUT).is_ok() {
                                open.push(p);
                            }
                        }
                        if !open.is_empty() {
                            let ip_str = ip.to_string();
                            let hostname = hostname_of(&ip_str);
                            let guess = guess_kind(&open);
                            found.fetch_add(1, Ordering::Relaxed);
                            app.emit(
                                "lan://device",
                                LanDevice { ip: ip_str, hostname, ports: open, guess },
                            )
                            .ok();
                        }
                        app.emit(
                            "lan://progress",
                            (done.fetch_add(1, Ordering::Relaxed) + 1, total),
                        )
                        .ok();
                    }
                });
            }
        });
        let n = found.load(Ordering::Relaxed);
        app.emit("lan://done", n).ok();
        app.state::<LanState>().busy.store(false, Ordering::Relaxed);    });
    Ok(())
}

/// 停止当前扫描:已发出的连接无法撤回,但剩余网段不再探测
#[tauri::command]
pub fn lan_probe_stop(state: tauri::State<'_, LanState>) -> Result<(), String> {
    state.stop.store(true, Ordering::Relaxed);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{guess_kind, hosts_of};

    #[test]
    fn 解析24网段() {
        let h = hosts_of("192.168.1.0/24").unwrap();
        assert_eq!(h.len(), 254);
        assert_eq!(h[0].to_string(), "192.168.1.1");
        assert_eq!(h[253].to_string(), "192.168.1.254");
    }

    #[test]
    fn 排除网络与广播地址() {
        let h = hosts_of("10.0.0.0/30").unwrap();
        // /30 只有 2 个可用地址:.1 与 .2
        assert_eq!(h.len(), 2);
        assert_eq!(h[0].to_string(), "10.0.0.1");
        assert_eq!(h[1].to_string(), "10.0.0.2");
    }

    #[test]
    fn 网络位对齐到掩码() {
        // 主机位非零时按网段起点计算
        let h = hosts_of("192.168.1.77/24").unwrap();
        assert_eq!(h[0].to_string(), "192.168.1.1");
        assert_eq!(h.len(), 254);
    }

    #[test]
    fn 规模超限拒绝() {
        assert!(hosts_of("10.0.0.0/8").is_err());
        assert!(hosts_of("192.168.0.0/16").is_err());
        assert!(hosts_of("192.168.1.0/22").is_ok());
    }

    #[test]
    fn 非法输入拒绝() {
        assert!(hosts_of("192.168.1.5").is_err());
        assert!(hosts_of("abc/24").is_err());
        assert!(hosts_of("192.168.1.0/33").is_err());
        assert!(hosts_of("192.168.1.0/32").is_err());
    }

    #[test]
    fn 设备类型推断() {
        assert_eq!(guess_kind(&[80, 9100]), "打印机");
        assert_eq!(guess_kind(&[445, 3389]), "Windows 电脑");
        assert_eq!(guess_kind(&[80, 443, 5000]), "NAS");
        assert_eq!(guess_kind(&[22, 443]), "服务器 / NAS");
        assert_eq!(guess_kind(&[22]), "Linux 设备");
        assert_eq!(guess_kind(&[80]), "网络设备");
    }
}
