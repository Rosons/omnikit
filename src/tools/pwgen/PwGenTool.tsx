import { useEffect, useMemo, useState } from "react";
import CopyButton from "../../components/CopyButton";

const SETS = [
  { key: "lower", label: "小写字母", chars: "abcdefghijklmnopqrstuvwxyz" },
  { key: "upper", label: "大写字母", chars: "ABCDEFGHIJKLMNOPQRSTUVWXYZ" },
  { key: "digit", label: "数字", chars: "0123456789" },
  { key: "symbol", label: "符号", chars: "!@#$%^&*()-_=+[]{}<>?/~" },
] as const;

type SetKey = (typeof SETS)[number]["key"];
const SIMILAR = "0O1lI|`'\";,.";

function randInt(max: number): number {
  const buf = new Uint32Array(1);
  const limit = Math.floor(4294967296 / max) * max;
  let v = 0;
  do {
    crypto.getRandomValues(buf);
    v = buf[0];
  } while (v >= limit);
  return v % max;
}

function shuffle(arr: string[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export default function PwGenTool() {
  const [len, setLen] = useState(16);
  const [count, setCount] = useState(5);
  const [enabled, setEnabled] = useState<Record<SetKey, boolean>>({
    lower: true,
    upper: true,
    digit: true,
    symbol: true,
  });
  const [excludeSimilar, setExcludeSimilar] = useState(true);
  const [list, setList] = useState<string[]>([]);

  const activeSets = useMemo(
    () =>
      SETS.filter((s) => enabled[s.key]).map((s) => ({
        ...s,
        chars: excludeSimilar
          ? [...s.chars].filter((c) => !SIMILAR.includes(c)).join("")
          : s.chars,
      })),
    [enabled, excludeSimilar],
  );
  const pool = activeSets.map((s) => s.chars).join("");

  const bits = pool ? Math.round(len * Math.log2(pool.length)) : 0;
  const strengthKey = bits >= 90 ? "high" : bits >= 60 ? "mid" : "low";
  const strengthLabel = bits >= 90 ? "强" : bits >= 60 ? "中" : "弱";

  function generate() {
    if (!pool) return;
    const n = Math.min(20, Math.max(1, Math.floor(count) || 1));
    const l = Math.min(64, Math.max(activeSets.length, Math.floor(len) || 8));
    const out: string[] = [];
    for (let k = 0; k < n; k++) {
      const chars: string[] = activeSets.map((s) => s.chars[randInt(s.chars.length)]);
      while (chars.length < l) chars.push(pool[randInt(pool.length)]);
      shuffle(chars);
      out.push(chars.slice(0, l).join(""));
    }
    setList(out);
  }

  // 首次进入先生成一批,避免空页
  useEffect(() => {
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(k: SetKey) {
    setEnabled((s) => ({ ...s, [k]: !s[k] }));
  }

  return (
    <div className="stack">
      <div className="field">
        <span className="field-label">字符选项</span>
        <div className="diff-opts">
          {SETS.map((s) => (
            <button
              key={s.key}
              className={`opt-chip${enabled[s.key] ? " on" : ""}`}
              onClick={() => toggle(s.key)}
            >
              {s.label}
            </button>
          ))}
          <button
            className={`opt-chip${excludeSimilar ? " on" : ""}`}
            onClick={() => setExcludeSimilar((v) => !v)}
          >
            排除易混淆字符（0O1lI 等）
          </button>
        </div>
      </div>

      <div className="tool-actions">
        <label className="kv-k">
          长度
          <input
            className="input input-sm"
            style={{ width: 70 }}
            type="number"
            min={6}
            max={64}
            value={len}
            onChange={(e) => setLen(Number(e.target.value))}
          />
        </label>
        <label className="kv-k">
          数量
          <input
            className="input input-sm"
            style={{ width: 70 }}
            type="number"
            min={1}
            max={20}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </label>
        <button className="btn btn-primary btn-sm" onClick={generate} disabled={!pool}>
          生成密码
        </button>
        {list.length > 0 && <CopyButton text={list.join("\n")} label="复制全部" />}
        {pool && (
          <span className={`pw-strength s-${strengthKey}`}>
            约 {bits} 位熵 · {strengthLabel}
          </span>
        )}
      </div>
      {!pool && <span className="hint hint-error">请至少选择一类字符</span>}

      <div className="pw-list">
        {list.map((pw, i) => (
          <div className="pw-row" key={i}>
            <span className="pw-val">{pw}</span>
            <CopyButton text={pw} />
          </div>
        ))}
      </div>
      <div className="hint">使用系统安全随机数生成；每类选中的字符至少包含一个</div>
    </div>
  );
}
