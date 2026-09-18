import { useMemo, useState, type ReactNode } from "react";
import CopyButton from "../../components/CopyButton";

interface MatchInfo {
  index: number;
  text: string;
  groups: (string | null)[];
  named: [string, string][];
}

const FLAGS = [
  { k: "g", label: "全局" },
  { k: "i", label: "忽略大小写" },
  { k: "m", label: "多行 ^ $" },
  { k: "s", label: "点号含换行" },
] as const;

type FlagKey = (typeof FLAGS)[number]["k"];

export default function RegexTool() {
  const [pattern, setPattern] = useState("");
  const [text, setText] = useState("");
  const [flags, setFlags] = useState<Set<FlagKey>>(new Set(["g"]));

  const { error, matches } = useMemo(() => {
    const ms: MatchInfo[] = [];
    if (!pattern) return { error: "", matches: ms };
    try {
      const re = new RegExp(pattern, [...flags].join(""));
      const collect = (m: RegExpExecArray) => {
        const named: [string, string][] = m.groups
          ? Object.entries(m.groups).filter(([, v]) => v !== undefined) as [string, string][]
          : [];
        ms.push({ index: m.index, text: m[0], groups: m.slice(1), named });
      };
      if (flags.has("g")) {
        for (const m of text.matchAll(re)) {
          collect(m as RegExpExecArray);
          if (ms.length >= 1000) break;
        }
      } else {
        const m = re.exec(text);
        if (m) collect(m);
      }
      return { error: "", matches: ms };
    } catch (e) {
      return { error: String(e).replace(/^Invalid regular expression:?\s*/i, ""), matches: [] };
    }
  }, [pattern, text, flags]);

  function toggleFlag(k: FlagKey) {
    setFlags((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  }

  // 高亮视图:命中的片段标蓝
  let pos = 0;
  const parts: ReactNode[] = [];
  matches.forEach((m, i) => {
    if (m.index > pos) parts.push(<span key={`t${i}`}>{text.slice(pos, m.index)}</span>);
    if (m.text) {
      parts.push(
        <mark key={`m${i}`} className="re-hit">
          {m.text}
        </mark>,
      );
    }
    pos = m.index + m.text.length;
  });
  if (pos < text.length) parts.push(<span key="tail">{text.slice(pos)}</span>);

  return (
    <div className="stack">
      <div className="field">
        <span className="field-label">正则表达式</span>
        <input
          className={`input input-mono${error ? " input-error" : ""}`}
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="如 (?&lt;year&gt;\d{4})-(\d{2})"
          spellCheck={false}
        />
        <div className="diff-opts">
          {FLAGS.map((f) => (
            <button
              key={f.k}
              className={`opt-chip${flags.has(f.k) ? " on" : ""}`}
              onClick={() => toggleFlag(f.k)}
            >
              {f.k} · {f.label}
            </button>
          ))}
        </div>
        {error && <span className="hint hint-error">正则有误：{error}</span>}
      </div>

      <div className="field">
        <span className="field-label">测试文本</span>
        <textarea
          className="textarea"
          style={{ height: 110 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="粘贴要匹配的文本，边输入边匹配"
          spellCheck={false}
        />
      </div>

      {text && !error && (
        <>
          <div className="field">
            <span className="field-label">
              匹配预览
              <span className="hint">{matches.length > 0 ? `共 ${matches.length} 处匹配` : "无匹配"}</span>
            </span>
            <div className="regex-view">{parts}</div>
          </div>
          {matches.length > 0 && (
            <div className="field">
              <span className="field-label">匹配明细</span>
              <div className="re-list">
                {matches.map((m, i) => (
                  <div className="re-row" key={i}>
                    <span className="re-idx">#{i + 1}</span>
                    <span className="re-val">{m.text || "（空匹配）"}</span>
                    <span className="re-pos">位置 {m.index}</span>
                    {m.groups.map((g, gi) =>
                      g !== null && g !== undefined ? (
                        <span className="re-groups" key={gi}>
                          ${gi + 1}={g}
                        </span>
                      ) : null,
                    )}
                    {m.named.map(([name, v]) => (
                      <span className="re-groups" key={name}>
                        ${name}={v}
                      </span>
                    ))}
                    <CopyButton text={m.text} />
                  </div>
                ))}
                {matches.length >= 1000 && (
                  <div className="re-row">
                    <span className="hint">匹配过多，仅列出前 1000 处</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
