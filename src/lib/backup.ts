/**
 * 设置备份与迁移 —— 把所有 omnikit.* 本地配置聚合成一份 JSON,
 * 导出到文件或从文件恢复。只覆盖备份里出现的键,其余不动。
 */

const PREFIX = "omnikit.";

/** 历史版本废弃的键:功能已删,本地残留,不参与导出/导入 */
const LEGACY_KEYS = ["omnikit.update.proxy"];

/** 启动时清掉废弃键的残留,让本地存储保持干净 */
export function purgeLegacyKeys() {
  for (const k of LEGACY_KEYS) localStorage.removeItem(k);
}

export interface BackupFile {
  app: "omnikit";
  schema: 1;
  exportedAt: string;
  data: Record<string, string>;
}

export function collectBackup(now = new Date()): BackupFile {
  const data: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(PREFIX) && !LEGACY_KEYS.includes(key)) {
      const v = localStorage.getItem(key);
      if (v !== null) data[key] = v;
    }
  }
  return { app: "omnikit", schema: 1, exportedAt: now.toISOString(), data };
}

/** 校验并落回 localStorage,返回导入的键数量;格式不对时抛错 */
export function applyBackup(raw: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("文件不是合法的 JSON");
  }
  const obj = parsed as Partial<BackupFile> | null;
  if (
    !obj ||
    typeof obj !== "object" ||
    obj.app !== "omnikit" ||
    obj.schema !== 1 ||
    !obj.data ||
    typeof obj.data !== "object"
  ) {
    throw new Error("不是 OmniKit 的备份文件");
  }
  let applied = 0;
  for (const [key, value] of Object.entries(obj.data)) {
    if (!key.startsWith(PREFIX) || typeof value !== "string") continue;
    localStorage.setItem(key, value);
    applied++;
  }
  if (applied === 0) throw new Error("备份里没有可用的 OmniKit 配置");
  return applied;
}
