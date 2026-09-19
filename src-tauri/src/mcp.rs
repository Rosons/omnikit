//! MCP(Model Context Protocol)服务器调试:stdio 与 Streamable HTTP 两种传输
use serde::Serialize;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::commands::hidden_command;

const PROTOCOL_VERSION: &str = "2025-06-18";
const TIMEOUT: Duration = Duration::from_secs(30);
const LOG_CAP: usize = 200;

#[derive(Default)]
pub struct McpState(pub Mutex<Option<Arc<McpSession>>>);

struct StdioSession {
    child: Child,
    stdin: Mutex<ChildStdin>,
    rx: Mutex<Receiver<(Option<u64>, Value)>>,
    _tx: Sender<(Option<u64>, Value)>,
    log: Arc<Mutex<Vec<String>>>,
    next_id: AtomicU64,
}

impl Drop for StdioSession {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

struct HttpSession {
    url: String,
    headers: Vec<(String, String)>,
    session_id: Mutex<Option<String>>,
    log: Arc<Mutex<Vec<String>>>,
    next_id: AtomicU64,
}

pub enum McpSession {
    Stdio(StdioSession),
    Http(HttpSession),
}

fn push_log(log: &Mutex<Vec<String>>, mut line: String) {
    if line.len() > 2000 {
        let mut cut = 2000;
        while !line.is_char_boundary(cut) {
            cut -= 1;
        }
        line.truncate(cut);
        line.push('…');
    }
    let mut g = log.lock().unwrap();
    g.push(line);
    let n = g.len();
    if n > LOG_CAP {
        g.drain(0..n - LOG_CAP);
    }
}

impl McpSession {
    fn log(&self) -> &Arc<Mutex<Vec<String>>> {
        match self {
            McpSession::Stdio(s) => &s.log,
            McpSession::Http(s) => &s.log,
        }
    }

    fn log_msg(&self, dir: &str, v: &Value) {
        push_log(
            self.log(),
            format!("{} {}", dir, serde_json::to_string(v).unwrap_or_default()),
        );
    }

    fn next_id(&self) -> u64 {
        match self {
            McpSession::Stdio(s) => s.next_id.fetch_add(1, Ordering::Relaxed),
            McpSession::Http(s) => s.next_id.fetch_add(1, Ordering::Relaxed),
        }
    }

    fn check_rpc(&self, v: Value) -> Result<Value, String> {
        self.log_msg("←", &v);
        if let Some(err) = v.get("error") {
            let msg = err
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("未知错误");
            return Err(format!("服务端返回错误：{msg}"));
        }
        Ok(v.get("result").cloned().unwrap_or(Value::Null))
    }

    /// 顺序发起一次 JSON-RPC 请求并等待同 id 响应
    fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id();
        let msg = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        self.log_msg("→", &msg);
        match self {
            McpSession::Stdio(s) => {
                {
                    let mut sin = s.stdin.lock().unwrap();
                    writeln!(sin, "{msg}").map_err(|e| format!("进程输入写入失败：{e}"))?;
                    sin.flush().map_err(|e| format!("进程输入写入失败：{e}"))?;
                }
                let deadline = Instant::now() + TIMEOUT;
                let rx = s.rx.lock().unwrap();
                loop {
                    let remain = deadline.saturating_duration_since(Instant::now());
                    if remain.is_zero() {
                        return Err("等待响应超时，服务器可能未响应".into());
                    }
                    match rx.recv_timeout(remain) {
                        Ok((mid, v)) => {
                            if mid == Some(id) {
                                return self.check_rpc(v);
                            }
                            self.log_msg("←", &v);
                        }
                        Err(_) => return Err("等待响应超时，服务器可能未响应".into()),
                    }
                }
            }
            McpSession::Http(s) => {
                let v = http_post(s, &msg, true)?;
                if v.get("id").and_then(|x| x.as_u64()) == Some(id) {
                    self.check_rpc(v)
                } else {
                    Err("响应中没有匹配的 JSON-RPC 结果".into())
                }
            }
        }
    }

    fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        let msg = json!({ "jsonrpc": "2.0", "method": method, "params": params });
        self.log_msg("→", &msg);
        match self {
            McpSession::Stdio(s) => {
                let mut sin = s.stdin.lock().unwrap();
                writeln!(sin, "{msg}").map_err(|e| format!("进程输入写入失败：{e}"))?;
                sin.flush().map_err(|e| format!("进程输入写入失败：{e}"))
            }
            McpSession::Http(s) => http_post(s, &msg, false).map(|_| ()),
        }
    }
}

fn http_post(s: &HttpSession, msg: &Value, expect_reply: bool) -> Result<Value, String> {
    let mut req = ureq::post(&s.url)
        .set("Accept", "application/json, text/event-stream")
        .timeout(TIMEOUT);
    {
        let sid = s.session_id.lock().unwrap();
        if let Some(x) = sid.as_deref() {
            req = req.set("Mcp-Session-Id", x);
        }
    }
    for (k, v) in &s.headers {
        req = req.set(k, v);
    }
    let resp = match req.send_string(&msg.to_string()) {
        Ok(r) => r,
        Err(ureq::Error::Status(code, r)) => {
            let mut buf = Vec::new();
            let _ = r.into_reader().take(8192).read_to_end(&mut buf);
            let text = String::from_utf8_lossy(&buf);
            return Err(format!("HTTP {code}：{}", truncate_str(&text, 300)));
        }
        Err(e) => return Err(format!("请求失败：{e}")),
    };
    if let Some(sid) = resp.header("mcp-session-id") {
        *s.session_id.lock().unwrap() = Some(sid.to_string());
    }
    let ct = resp.header("content-type").unwrap_or("").to_lowercase();
    let mut body = String::new();
    resp.into_reader()
        .take(5 * 1024 * 1024)
        .read_to_string(&mut body)
        .map_err(|e| format!("读取响应失败：{e}"))?;
    if body.trim().is_empty() {
        return if expect_reply {
            Err("服务端返回空响应".into())
        } else {
            Ok(Value::Null)
        };
    }
    if ct.contains("text/event-stream") {
        for v in parse_sse(&body) {
            if v.get("id").is_some() {
                return Ok(v);
            }
        }
        return Err("事件流中没有 JSON-RPC 响应".into());
    }
    serde_json::from_str::<Value>(&body).map_err(|e| format!("响应不是合法 JSON：{e}"))
}

fn parse_sse(body: &str) -> Vec<Value> {
    let mut out = Vec::new();
    for block in body.split("\n\n") {
        let mut data = String::new();
        for line in block.lines() {
            if let Some(rest) = line.strip_prefix("data:") {
                if !data.is_empty() {
                    data.push('\n');
                }
                data.push_str(rest.trim_start());
            }
        }
        if !data.is_empty() {
            if let Ok(v) = serde_json::from_str::<Value>(&data) {
                out.push(v);
            }
        }
    }
    out
}

fn truncate_str(s: &str, n: usize) -> String {
    if s.len() <= n {
        return s.to_string();
    }
    let mut cut = n;
    while !s.is_char_boundary(cut) {
        cut -= 1;
    }
    format!("{}…", &s[..cut])
}

fn split_command_line(cmd: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    for c in cmd.chars() {
        if let Some(q) = quote {
            if c == q {
                quote = None;
            } else {
                cur.push(c);
            }
        } else if c == '"' || c == '\'' {
            quote = Some(c);
        } else if c.is_whitespace() {
            if !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
        } else {
            cur.push(c);
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/* ---------- 数据结构 ---------- */

#[derive(Serialize, Clone)]
pub struct McpInfo {
    pub protocol_version: String,
    pub server_name: String,
    pub server_version: String,
    pub capabilities: Vec<String>,
    pub instructions: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct McpTool {
    pub name: String,
    pub description: Option<String>,
    pub schema: Value,
}

#[derive(Serialize, Clone)]
pub struct McpResource {
    pub uri: String,
    pub name: Option<String>,
    pub description: Option<String>,
    #[serde(rename = "mimeType")]
    pub mime_type: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct McpPrompt {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Serialize)]
pub struct McpCallResult {
    pub is_error: bool,
    pub text: String,
    pub raw: Value,
    pub elapsed_ms: u64,
}

fn cap_label(k: &str) -> String {
    match k {
        "tools" => "工具".into(),
        "resources" => "资源".into(),
        "prompts" => "提示".into(),
        "sampling" => "采样".into(),
        "roots" => "根目录".into(),
        "logging" => "日志".into(),
        other => other.to_string(),
    }
}

fn extract_info(result: &Value) -> McpInfo {
    let capabilities = result
        .pointer("/capabilities")
        .and_then(|v| v.as_object())
        .map(|m| m.keys().map(|k| cap_label(k)).collect())
        .unwrap_or_default();
    McpInfo {
        protocol_version: result
            .pointer("/protocolVersion")
            .and_then(|v| v.as_str())
            .unwrap_or("未知")
            .to_string(),
        server_name: result
            .pointer("/serverInfo/name")
            .and_then(|v| v.as_str())
            .unwrap_or("未知")
            .to_string(),
        server_version: result
            .pointer("/serverInfo/version")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        capabilities,
        instructions: result
            .pointer("/instructions")
            .and_then(|v| v.as_str())
            .map(String::from),
    }
}

fn do_initialize(sess: &McpSession) -> Result<McpInfo, String> {
    let result = sess.request(
        "initialize",
        json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": { "name": "OmniKit", "version": "0.8" }
        }),
    )?;
    sess.notify("notifications/initialized", json!({}))?;
    Ok(extract_info(&result))
}

fn spawn_stdio(target: &str) -> Result<McpSession, String> {
    let parts = split_command_line(target);
    if parts.is_empty() {
        return Err("请输入启动命令".into());
    }
    let mut cmd = hidden_command(&parts[0]);
    cmd.args(&parts[1..])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("启动命令失败：{e}"))?;
    let stdin = child.stdin.take().ok_or("无法获取进程输入流")?;
    let stdout = child.stdout.take().ok_or("无法获取进程输出流")?;
    let stderr = child.stderr.take().ok_or("无法获取进程错误流")?;
    let log: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    {
        let log = log.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().flatten() {
                push_log(&log, format!("[stderr] {line}"));
            }
        });
    }
    let (tx, rx) = channel::<(Option<u64>, Value)>();
    {
        let tx = tx.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                let t = line.trim();
                if t.is_empty() {
                    continue;
                }
                let Ok(v) = serde_json::from_str::<Value>(t) else {
                    continue;
                };
                let id = v.get("id").and_then(|x| x.as_u64());
                if tx.send((id, v)).is_err() {
                    break;
                }
            }
        });
    }
    Ok(McpSession::Stdio(StdioSession {
        child,
        stdin: Mutex::new(stdin),
        rx: Mutex::new(rx),
        _tx: tx,
        log,
        next_id: AtomicU64::new(1),
    }))
}

fn get_session(state: &McpState) -> Result<Arc<McpSession>, String> {
    state
        .0
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "尚未连接 MCP 服务器".into())
}

/* ---------- 命令 ---------- */

#[tauri::command]
pub async fn mcp_connect(
    state: tauri::State<'_, McpState>,
    kind: String,
    target: String,
    headers: Vec<(String, String)>,
) -> Result<McpInfo, String> {
    let target = target.trim().to_string();
    if target.is_empty() {
        return Err(if kind == "http" {
            "请输入服务器地址".into()
        } else {
            "请输入启动命令".into()
        });
    }
    let built = tauri::async_runtime::spawn_blocking(move || -> Result<(McpSession, McpInfo), String> {
        let session: McpSession = if kind == "http" {
            McpSession::Http(HttpSession {
                url: target,
                headers,
                session_id: Mutex::new(None),
                log: Arc::new(Mutex::new(Vec::new())),
                next_id: AtomicU64::new(1),
            })
        } else {
            spawn_stdio(&target)?
        };
        let info = do_initialize(&session)?;
        Ok((session, info))
    })
    .await
    .map_err(|e| format!("任务执行失败：{e}"))??;
    *state.0.lock().unwrap() = Some(Arc::new(built.0));
    Ok(built.1)
}

#[tauri::command]
pub async fn mcp_disconnect(state: tauri::State<'_, McpState>) -> Result<(), String> {
    *state.0.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
pub async fn mcp_list_tools(state: tauri::State<'_, McpState>) -> Result<Vec<McpTool>, String> {
    let sess = get_session(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let result = sess.request("tools/list", json!({}))?;
        let arr = result
            .get("tools")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        Ok(arr
            .into_iter()
            .map(|t| McpTool {
                name: t
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                description: t.get("description").and_then(|v| v.as_str()).map(String::from),
                schema: t.get("inputSchema").cloned().unwrap_or(Value::Null),
            })
            .collect())
    })
    .await
    .map_err(|e| format!("任务执行失败：{e}"))?
}

#[tauri::command]
pub async fn mcp_list_resources(
    state: tauri::State<'_, McpState>,
) -> Result<Vec<McpResource>, String> {
    let sess = get_session(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let result = sess.request("resources/list", json!({}))?;
        let arr = result
            .get("resources")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        Ok(arr
            .into_iter()
            .map(|t| McpResource {
                uri: t
                    .get("uri")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                name: t.get("name").and_then(|v| v.as_str()).map(String::from),
                description: t.get("description").and_then(|v| v.as_str()).map(String::from),
                mime_type: t.get("mimeType").and_then(|v| v.as_str()).map(String::from),
            })
            .collect())
    })
    .await
    .map_err(|e| format!("任务执行失败：{e}"))?
}

#[tauri::command]
pub async fn mcp_list_prompts(
    state: tauri::State<'_, McpState>,
) -> Result<Vec<McpPrompt>, String> {
    let sess = get_session(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let result = sess.request("prompts/list", json!({}))?;
        let arr = result
            .get("prompts")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        Ok(arr
            .into_iter()
            .map(|t| McpPrompt {
                name: t
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                description: t.get("description").and_then(|v| v.as_str()).map(String::from),
            })
            .collect())
    })
    .await
    .map_err(|e| format!("任务执行失败：{e}"))?
}

#[tauri::command]
pub async fn mcp_call_tool(
    state: tauri::State<'_, McpState>,
    name: String,
    args_json: String,
) -> Result<McpCallResult, String> {
    let args: Value =
        serde_json::from_str(&args_json).map_err(|_| "参数不是合法 JSON".to_string())?;
    let sess = get_session(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let start = Instant::now();
        let result = sess.request("tools/call", json!({ "name": name, "arguments": args }))?;
        let elapsed = start.elapsed().as_millis() as u64;
        let is_error = result
            .get("isError")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let mut parts: Vec<String> = Vec::new();
        if let Some(items) = result.get("content").and_then(|v| v.as_array()) {
            for item in items {
                match item.get("type").and_then(|v| v.as_str()) {
                    Some("text") => {
                        if let Some(t) = item.get("text").and_then(|v| v.as_str()) {
                            parts.push(t.to_string());
                        }
                    }
                    Some("image") => parts.push("（图片内容，见原始 JSON）".into()),
                    Some("resource") => parts.push("（资源内容，见原始 JSON）".into()),
                    Some(other) => parts.push(format!("（未知内容类型：{other}）")),
                    None => {}
                }
            }
        }
        Ok(McpCallResult {
            is_error,
            text: parts.join("\n\n"),
            raw: result,
            elapsed_ms: elapsed,
        })
    })
    .await
    .map_err(|e| format!("任务执行失败：{e}"))?
}

#[tauri::command]
pub fn mcp_log(state: tauri::State<'_, McpState>) -> Result<Vec<String>, String> {
    let sess = get_session(&state)?;
    let log = sess.log().lock().unwrap().clone();
    Ok(log)
}
