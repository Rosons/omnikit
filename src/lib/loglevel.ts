/** 日志行级别识别:兼容 [ERROR]、level=error、ERROR: 等常见写法 */

export type LogLevel = "err" | "warn" | "dbg" | "info";

export function levelOf(line: string): LogLevel {
  const m = /\b(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|CRITICAL)\b/i.exec(line);
  if (!m) return "info";
  const lv = m[1].toUpperCase();
  if (lv === "ERROR" || lv === "FATAL" || lv === "CRITICAL") return "err";
  if (lv === "WARN" || lv === "WARNING") return "warn";
  if (lv === "DEBUG" || lv === "TRACE") return "dbg";
  return "info";
}
