//! DNS 查询:调系统自带 nslookup 查 A/AAAA/CNAME/MX/TXT/NS 记录,
//! 可指定服务器做多 DNS 对比。解析器按中英文输出宽容匹配,解析不出结构化
//! 记录时前端仍有原文兜底
use serde::Serialize;
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// 单次查询超时
const QUERY_TIMEOUT: Duration = Duration::from_secs(6);

#[derive(Serialize, Clone)]
pub struct DnsRecord {
    pub rtype: String,
    pub value: String,
}

#[derive(Serialize)]
pub struct DnsReply {
    pub server: String,
    pub records: Vec<DnsRecord>,
    /// nslookup 原始输出,解析不出时前端展示兜底
    pub raw: String,
}

/// 子进程输出解码:中文 Windows 的控制台程序输出 GBK,macOS 为 UTF-8
pub(crate) fn decode_child_output(buf: &[u8]) -> String {
    #[cfg(target_os = "windows")]
    {
        let (text, _, _) = encoding_rs::GBK.decode(buf);
        text.into_owned()
    }
    #[cfg(not(target_os = "windows"))]
    {
        String::from_utf8_lossy(buf).into_owned()
    }
}

/// 运行子进程并取解码后的 stdout。输出在独立线程读取(轮询等待期间
/// 管道持续有数据也不阻塞),超时 kill 后管道关闭、线程自然结束
pub(crate) fn run_gbk_output(mut cmd: Command, timeout: Duration) -> Option<String> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::null());
    let mut child = cmd.spawn().ok()?;
    let mut pipe = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = std::io::Read::read_to_end(&mut pipe, &mut buf);
        buf
    });
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(40)),
            Err(_) => return None,
        }
    }
    let buf = reader.join().ok()?;
    Some(decode_child_output(&buf))
}

/// 取一行 "键: 值" 中冒号后的部分(兼容全角冒号,按字符边界切)
fn after_colon(line: &str) -> Option<String> {
    let (idx, c) = line.char_indices().find(|(_, c)| *c == ':' || *c == '：')?;
    let rest = line[idx + c.len_utf8()..].trim();
    if rest.is_empty() {
        None
    } else {
        Some(rest.to_string())
    }
}

fn is_name_line(t: &str) -> bool {
    t.starts_with("名称") || t.starts_with("名字") || t.starts_with("Name")
}

fn is_addr_line(t: &str) -> bool {
    t.starts_with("Address") || t.starts_with("地址")
}

/// 解析 nslookup 输出为结构化记录。逐行宽容匹配:
/// 名称行之后出现的 Address 行都是应答记录(A/AAAA);
/// MX/TXT/CNAME/NS 各按 "=" 右侧取值
pub(crate) fn parse_nslookup(text: &str, qtype: &str) -> Vec<DnsRecord> {
    let mut out: Vec<DnsRecord> = Vec::new();
    let mut seen_answer = false;
    let mut lines = text.lines().peekable();
    while let Some(line) = lines.next() {
        let t = line.trim();
        if is_name_line(t) {
            seen_answer = true;
            continue;
        }
        if t.starts_with("***") {
            break;
        }
        if let Some(v) = after_colon(t) {
            if is_addr_line(t) && seen_answer {
                out.push(DnsRecord { rtype: qtype.to_string(), value: v });
                continue;
            }
        }
        // MX: "preference = 10, mail exchanger = mx1.qq.com"
        if let Some(p) = t.find("mail exchanger") {
            let host = after_eq(&t[p..]).unwrap_or_default();
            let pref = t
                .split("preference")
                .nth(1)
                .and_then(after_eq)
                .and_then(|s| s.split(',').next().map(|x| x.trim().to_string()))
                .unwrap_or_default();
            out.push(DnsRecord { rtype: "MX".into(), value: format!("{pref} {host}") });
            continue;
        }
        // CNAME
        if let Some(p) = t.find("canonical name") {
            if let Some(v) = after_eq(&t[p..]) {
                out.push(DnsRecord { rtype: "CNAME".into(), value: v });
            }
            continue;
        }
        // NS
        if let Some(p) = t.find("nameserver") {
            if let Some(v) = after_eq(&t[p..]) {
                out.push(DnsRecord { rtype: "NS".into(), value: v });
            }
            continue;
        }
        // TXT: "text =" 后同行或后续几行(可能隔空行)的引号内容
        if let Some(p) = t.find("text") {
            let same_line = after_eq(&t[p..]).unwrap_or_default();
            let mut val = same_line.trim_matches('"').to_string();
            if val.is_empty() {
                // 值可能隔了空行,向后最多看 4 行找引号行
                for next in lines.by_ref().take(4) {
                    let nt = next.trim();
                    if nt.is_empty() {
                        continue;
                    }
                    if nt.starts_with('"') {
                        val.push_str(nt.trim_matches('"'));
                    }
                    break;
                }
            }
            if !val.is_empty() {
                out.push(DnsRecord { rtype: "TXT".into(), value: val });
            }
            continue;
        }
    }
    out
}

/// 取 "=" 后面的内容并清理
fn after_eq(s: &str) -> Option<String> {
    let idx = s.find('=')?;
    let rest = s[idx + 1..].trim();
    if rest.is_empty() {
        None
    } else {
        Some(rest.trim_matches('"').to_string())
    }
}

fn valid_token(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 255
        && s.bytes().all(|b| b.is_ascii_alphanumeric() || b".-_:".contains(&b))
}

/// 查询 DNS 记录。域名不存在等情况下 nslookup 退出码非 0 但输出有信息,
/// 因此按输出内容判定,records 为空时前端展示原文
#[tauri::command]
pub fn dns_query(domain: String, qtype: String, server: String) -> Result<DnsReply, String> {
    let qt = qtype.to_uppercase();
    if !matches!(qt.as_str(), "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "NS") {
        return Err(format!("不支持的记录类型：{qtype}"));
    }
    let d = domain.trim().trim_end_matches('.').to_string();
    if !valid_token(&d) {
        return Err(format!("域名不合法：{domain}"));
    }
    let srv = server.trim().to_string();
    if !valid_token(&srv) {
        return Err(format!("服务器地址不合法：{server}"));
    }
    let mut cmd = crate::commands::hidden_command("nslookup");
    cmd.arg(format!("-type={qt}")).arg(&d).arg(&srv);
    let out = run_gbk_output(cmd, QUERY_TIMEOUT)
        .ok_or_else(|| "查询超时或 nslookup 不可用".to_string())?;
    let records = parse_nslookup(&out, &qt);
    Ok(DnsReply { server: srv, records, raw: out })
}

#[cfg(test)]
mod tests {
    use super::{after_colon, parse_nslookup};

    const A_CN: &str = "非权威应答:\n服务器:  public1.alidns.com\nAddress:  223.5.5.5\n\n名称:    github.com\nAddress:  20.205.243.166\n";
    const MX_CN: &str = "非权威应答:\n服务器:  public1.alidns.com\nAddress:  223.5.5.5\n\nqq.com\tMX preference = 20, mail exchanger = mx2.qq.com\nqq.com\tMX preference = 10, mail exchanger = mx3.qq.com\n";
    const TXT_CN: &str = "非权威应答:\n服务器:  public1.alidns.com\nAddress:  223.5.5.5\n\nqq.com\ttext =\n\n\t\"v=spf1 include:spf.mail.qq.com ~all\"\n";
    const NS_CN: &str = "非权威应答:\n服务器:  public1.alidns.com\nAddress:  223.5.5.5\n\nqq.com\tnameserver = ns4.qq.com\nqq.com\tnameserver = ns3.qq.com\n";
    const NX_CN: &str = "*** public1.alidns.com 找不到 noexist-xyz.qq.com: Non-existent domain\n服务器:  public1.alidns.com\nAddress:  223.5.5.5\n\n";
    const CNAME_CN: &str = "非权威应答:\n服务器:  public1.alidns.com\nAddress:  223.5.5.5\n\nwww.baidu.com\tcanonical name = www.a.shifen.com\n";

    #[test]
    fn a记录_服务器地址不计入应答() {
        let r = parse_nslookup(A_CN, "A");
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].value, "20.205.243.166");
    }

    #[test]
    fn mx记录取优先级与主机() {
        let r = parse_nslookup(MX_CN, "MX");
        assert_eq!(r.len(), 2);
        assert_eq!(r[0].value, "20 mx2.qq.com");
        assert_eq!(r[1].value, "10 mx3.qq.com");
    }

    #[test]
    fn txt记录拼接换行值() {
        let r = parse_nslookup(TXT_CN, "TXT");
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].value, "v=spf1 include:spf.mail.qq.com ~all");
    }

    #[test]
    fn ns与cname记录() {
        let r = parse_nslookup(NS_CN, "NS");
        assert_eq!(r.len(), 2);
        assert_eq!(r[0].value, "ns4.qq.com");
        let c = parse_nslookup(CNAME_CN, "CNAME");
        assert_eq!(c[0].value, "www.a.shifen.com");
        assert_eq!(c[0].rtype, "CNAME");
    }

    #[test]
    fn 域名不存在时无记录() {
        let r = parse_nslookup(NX_CN, "A");
        assert!(r.is_empty());
    }

    #[test]
    fn 冒号后取值兼容全角() {
        assert_eq!(after_colon("名称：    github.com").as_deref(), Some("github.com"));
        assert_eq!(after_colon("Address:  1.2.3.4").as_deref(), Some("1.2.3.4"));
        assert_eq!(after_colon("无冒号"), None);
    }
}
