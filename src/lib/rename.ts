/**
 * 批量重命名规则引擎 —— 纯字符串变换,预览与执行共用同一函数,
 * 所见即所得。规则按顺序应用:查找替换 → 前后缀 → 日期 → 序号。
 */

export interface RenameRule {
  /** 查找内容;useRegex 时为正则,否则为字面量替换 */
  find: string;
  replace: string;
  useRegex: boolean;
  prefix: string;
  suffix: string;
  /** 在扩展名前追加序号 */
  seqEnabled: boolean;
  seqStart: number;
  /** 序号补零位数(1~6) */
  seqPad: number;
  /** 序号连接符 */
  seqSep: string;
  /** 在扩展名前追加文件修改日期(yyyyMMdd) */
  dateEnabled: boolean;
  dateSep: string;
}

export const DEFAULT_RULE: RenameRule = {
  find: "",
  replace: "",
  useRegex: false,
  prefix: "",
  suffix: "",
  seqEnabled: false,
  seqStart: 1,
  seqPad: 3,
  seqSep: "-",
  dateEnabled: false,
  dateSep: "-",
};

/** Windows 文件名非法字符与保留名 */
const ILLEGAL = /[\\/:*?"<>|]/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function pad(n: number, width: number): string {
  return String(n).padStart(Math.max(1, width), "0");
}

/** 修改时间(Unix 秒)→ yyyyMMdd */
function fmtDate(secs: number): string {
  const d = new Date(secs * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/** 把一段内容插入"扩展名前"(ext 已分离,直接追加到 base) */
function insertBeforeExt(base: string, piece: string): string {
  return base + piece;
}

/** 按规则把旧名变成新名。mtimeSec 为文件修改时间(Unix 秒) */
export function buildNewName(name: string, index: number, mtimeSec: number, r: RenameRule): string {
  // 查找替换(在完整名字上替换,含扩展名),替换后重新分离扩展名
  let full = name;
  if (r.find) {
    if (r.useRegex) {
      try {
        full = full.replace(new RegExp(r.find, "gi"), r.replace);
      } catch {
        /* 正则非法时跳过替换,由预览的错误提示告知 */
      }
    } else {
      full = full.split(r.find).join(r.replace);
    }
  }
  // 分离扩展名:最后一个点且不在首位
  const dot = full.lastIndexOf(".");
  let base = dot > 0 ? full.slice(0, dot) : full;
  const ext = dot > 0 ? full.slice(dot) : "";

  // 前后缀:前缀加在最前,后缀与日期/序号依次插在扩展名前
  base = r.prefix + base;

  const pieces: string[] = [];
  if (r.dateEnabled) pieces.push(fmtDate(mtimeSec));
  if (r.seqEnabled) pieces.push(pad(r.seqStart + index, r.seqPad));
  for (const piece of pieces) {
    base = insertBeforeExt(base, piece ? r.seqSep + piece : piece);
  }
  base = insertBeforeExt(base, r.suffix);

  return base + ext;
}

/** 校验单条新名:返回错误文案,空串为通过 */
export function nameError(newName: string): string {
  if (!newName.trim()) return "新名字为空";
  if (ILLEGAL.test(newName)) return "含 Windows 不允许的字符 \\ / : * ? \" < > |";
  if (RESERVED.test(newName)) return "是 Windows 保留名";
  return "";
}

export interface RenamePlan {
  from: string;
  to: string;
  mtimeSec: number;
}

/** 对整批名字生成计划并标注冲突;返回每条 {from, to, err} */
export function buildPlans(
  files: { name: string; mtimeSec: number }[],
  r: RenameRule,
): { from: string; to: string; err: string }[] {
  const out = files.map((f, i) => ({
    from: f.name,
    to: buildNewName(f.name, i, f.mtimeSec, r),
    err: "",
  }));
  // 新名互撞
  const seen = new Map<string, number>();
  for (const p of out) {
    const n = seen.get(p.to);
    if (n === undefined) seen.set(p.to, 1);
    else seen.set(p.to, n + 1);
  }
  // 与本批之外不会撞(执行时后端还会校验目标存在),这里查批内重复与非法名
  const dupMarked = new Set<string>();
  for (const p of out) {
    if ((seen.get(p.to) ?? 0) > 1 && !dupMarked.has(p.to)) {
      for (const q of out) if (q.to === p.to) q.err = "批内重名";
      dupMarked.add(p.to);
    }
    const e = nameError(p.to);
    if (e && !p.err) p.err = e;
  }
  return out;
}
