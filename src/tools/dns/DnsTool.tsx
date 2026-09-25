import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { showToast } from "../../components/Toast";
import Dropdown from "../../components/Dropdown";

interface DnsRecord {
  rtype: string;
  value: string;
}

interface DnsReply {
  server: string;
  records: DnsRecord[];
  raw: string;
}

const TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS"] as const;

const SERVER_PRESETS = [
  { label: "阿里 223.5.5.5", value: "223.5.5.5" },
  { label: "腾讯 119.29.29.29", value: "119.29.29.29" },
  { label: "114 114.114.114.114", value: "114.114.114.114" },
  { label: "谷歌 8.8.8.8", value: "8.8.8.8" },
];

interface ServerResult {
  server: string;
  reply?: DnsReply;
  err?: string;
}

export default function DnsTool() {
  const [domain, setDomain] = useState("github.com");
  const [qtype, setQtype] = useState("A");
  const [servers, setServers] = useState<string[]>(["223.5.5.5", "8.8.8.8"]);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ServerResult[] | null>(null);

  function toggleServer(s: string) {
    setServers((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  function addCustom() {
    const s = custom.trim();
    if (!s) return;
    if (!servers.includes(s)) setServers((prev) => [...prev, s]);
    setCustom("");
  }

  async function query() {
    const d = domain.trim();
    if (!d || servers.length === 0) {
      showToast("填入域名并至少选择一个 DNS 服务器", "info");
      return;
    }
    setBusy(true);
    setResults(null);
    // 多服务器并行查询,互不阻塞
    const rs = await Promise.all(
      servers.map(async (server): Promise<ServerResult> => {
        try {
          return { server, reply: await invoke<DnsReply>("dns_query", { domain: d, qtype, server }) };
        } catch (e) {
          return { server, err: String(e) };
        }
      }),
    );
    setResults(rs);
    setBusy(false);
  }

  return (
    <div className="stack">
      <div className="field dns-flex-none">
        <span className="field-label">查询</span>
        <div className="dns-row">
          <input
            className="input input-sm input-mono dns-domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="域名，如 example.com"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) query();
            }}
          />
          <Dropdown
            width={96}
            value={qtype}
            onChange={setQtype}
            options={TYPES.map((t) => ({ value: t, label: t }))}
          />
          <button className="btn btn-sm btn-primary" onClick={query} disabled={busy}>
            {busy ? "查询中…" : "查询"}
          </button>
        </div>
      </div>

      <div className="field dns-flex-none">
        <span className="field-label">DNS 服务器（选中几个就并行查几个，方便对比劫持与生效差异）</span>
        <div className="dns-servers">
          {SERVER_PRESETS.map((s) => (
            <button
              key={s.value}
              className={`opt-chip${servers.includes(s.value) ? " on" : ""}`}
              onClick={() => toggleServer(s.value)}
            >
              {s.label}
            </button>
          ))}
          {servers
            .filter((s) => !SERVER_PRESETS.some((p) => p.value === s))
            .map((s) => (
              <button key={s} className="opt-chip on" onClick={() => toggleServer(s)}>
                {s}
              </button>
            ))}
          <input
            className="input input-sm input-mono dns-custom"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="自定义 IP 回车添加"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === "Enter") addCustom();
            }}
          />
        </div>
      </div>

      {busy && (
        <div className="empty-state">
          <div className="empty-title">查询中，正在向 {servers.length} 个服务器发起解析…</div>
          <div className="hint">一般 1～3 秒返回；境外服务器在部分网络下可能较慢或超时</div>
        </div>
      )}

      {results && !busy && (
        <div className="dns-results">
          {results.map((r) => (
            <div className="field" key={r.server}>
              <span className="field-label">
                {r.server}
                {r.reply && ` · ${r.reply.records.length} 条记录`}
              </span>
              {r.err && <span className="hint hint-error">{r.err}</span>}
              {r.reply && r.reply.records.length === 0 && (
                <span className="hint">无记录（可能该类型无解析或域名不存在），见原文</span>
              )}
              {r.reply && r.reply.records.length > 0 && (
                <div className="kv-list">
                  {r.reply.records.map((rec, i) => (
                    <div className="kv-row" key={i}>
                      <span className="kv-k" style={{ minWidth: 52 }}>
                        {rec.rtype}
                      </span>
                      <span className="kv-v kv-mono">{rec.value}</span>
                    </div>
                  ))}
                </div>
              )}
              {r.reply && (
                <details className="dns-raw">
                  <summary>原始输出</summary>
                  <pre className="dns-raw-pre">{r.reply.raw}</pre>
                </details>
              )}
            </div>
          ))}
        </div>
      )}

      {!results && !busy && (
        <div className="empty-state">
          <div className="empty-title">输入域名开始查询</div>
          <div className="hint">同一域名在多家 DNS 的结果并排对比，一眼看出劫持或未生效</div>
        </div>
      )}
    </div>
  );
}
