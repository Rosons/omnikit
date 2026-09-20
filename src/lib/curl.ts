/**
 * cURL 命令解析：把常用 cURL 命令行转成 HTTP 测试工具的请求参数。
 * 支持单双引号、行尾续行符、常见旗标（含附加值写法 -XPOST 与 --flag=value）；
 * 不认识的旗标跳过并记入 warnings，不中断解析。
 */

export interface CurlRequest {
  method: string;
  url: string;
  headers: { k: string; v: string }[];
  body: string;
  warnings: string[];
}

/** 按 shell 规则切分参数：单双引号、反斜杠转义与续行 */
export function tokenize(input: string): string[] {
  const toks: string[] = [];
  let cur = "";
  let has = false;
  let quote: string | null = null;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quote) {
      if (c === quote) {
        quote = null;
      } else if (quote === '"' && c === "\\" && i + 1 < input.length) {
        const n = input[i + 1];
        // 双引号内只识别 \" \\ \$ \` 这几个转义，其余反斜杠保持原样
        if (n === '"' || n === "\\" || n === "$" || n === "`") {
          cur += n;
          i++;
        } else {
          cur += c;
        }
      } else {
        cur += c;
      }
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      has = true;
    } else if (c === "\\") {
      const n = input[i + 1];
      if (n === "\n") {
        i++; // 行尾续行
      } else if (n === "\r") {
        i += input[i + 2] === "\n" ? 2 : 1;
      } else if (n !== undefined) {
        cur += n; // \x 转义为 x（含 \| \& 等常见粘贴转义）
        i++;
        has = true;
      }
    } else if (/\s/.test(c)) {
      if (has || cur) {
        toks.push(cur);
        cur = "";
        has = false;
      }
    } else {
      cur += c;
      has = true;
    }
  }
  if (has || cur) toks.push(cur);
  return toks;
}

/** 需要消费一个参数值的旗标 */
const VALUE_FLAGS = new Set([
  "-X", "--request", "-H", "--header", "--url", "-d", "--data", "--data-raw",
  "--data-ascii", "--data-binary", "--data-urlencode", "-F", "--form", "-u",
  "--user", "-A", "--user-agent", "-e", "--referer", "-b", "--cookie", "-o",
  "--output", "-x", "--proxy", "-m", "--max-time", "--connect-timeout",
  "--retry", "--json",
]);

/** 不带值的开关旗标 */
const FLAG_FLAGS = new Set([
  "-G", "--get", "-I", "--head", "-L", "--location", "-s", "--silent", "-k",
  "--insecure", "-v", "--verbose", "--compressed", "-#", "--progress-bar",
  "-f", "--fail",
]);

function looksLikeUrl(s: string): boolean {
  return (
    /^https?:\/\//i.test(s) ||
    s.startsWith("{") || // curl 占位符写法 {-url}
    /^localhost(:\d+)?(\/|$)/i.test(s) ||
    /^[\w.-]+:\d+(\/|$)/.test(s)
  );
}

export function parseCurl(input: string): CurlRequest {
  const toks = tokenize(input);
  const warnings: string[] = [];
  let method: string | null = null;
  let url: string | null = null;
  const headers: { k: string; v: string }[] = [];
  const dataParts: string[] = [];
  let user: string | null = null;
  let toQuery = false; // -G：把 -d 数据拼到 URL 查询串

  const addHeader = (k: string, v: string) => {
    headers.push({ k: k.trim(), v: v.trim() });
  };

  let i = 0;
  // 命令本体
  if (toks.length && /^curl(\.exe)?$/i.test(toks[0])) i = 1;

  for (; i < toks.length; i++) {
    let t = toks[i];

    // --flag=value 形式
    let attached: string | null = null;
    if (t.startsWith("--")) {
      const eq = t.indexOf("=");
      if (eq > 2) {
        const flag = t.slice(0, eq);
        if (VALUE_FLAGS.has(flag)) {
          attached = t.slice(eq + 1);
          t = flag;
        }
      }
    }
    // -XPOST 附加值形式
    if (!attached && t.length > 2 && t.startsWith("-") && !t.startsWith("--")) {
      const flag = t.slice(0, 2);
      if (["-X", "-H", "-d", "-u", "-A", "-e", "-b", "-o", "-F", "-m"].includes(flag)) {
        attached = t.slice(2);
        t = flag;
      }
    }

    let v = attached;
    if (v === null && VALUE_FLAGS.has(t)) {
      if (i + 1 >= toks.length) {
        warnings.push(`参数 ${t} 缺少值，已忽略`);
        break;
      }
      v = toks[++i];
    }

    switch (t) {
      case "-X":
      case "--request":
        if (v) method = v.toUpperCase();
        break;
      case "--url":
        url = v ?? url;
        break;
      case "-H":
      case "--header": {
        const idx = (v ?? "").indexOf(":");
        if (idx > 0) addHeader(v!.slice(0, idx), v!.slice(idx + 1));
        else if (v && v.trim()) warnings.push(`无法解析请求头「${v}」，已忽略`);
        break;
      }
      case "-d":
      case "--data":
      case "--data-raw":
      case "--data-ascii":
      case "--data-binary": {
        if (v?.startsWith("@")) {
          warnings.push("不支持从文件读取请求体，已跳过该参数");
        } else if (v !== null && v !== undefined) {
          dataParts.push(v);
        }
        break;
      }
      case "--data-urlencode": {
        if (!v) break;
        if (v.includes("=")) {
          const eq = v.indexOf("=");
          dataParts.push(
            `${encodeURIComponent(v.slice(0, eq))}=${encodeURIComponent(v.slice(eq + 1))}`,
          );
        } else {
          dataParts.push(encodeURIComponent(v));
        }
        break;
      }
      case "--json": {
        if (!method) method = "POST";
        addHeader("Content-Type", "application/json");
        addHeader("Accept", "application/json");
        if (v && v !== "@-") dataParts.push(v);
        break;
      }
      case "-F":
      case "--form":
        warnings.push("multipart 表单未完整转换，字段已原样放入请求体");
        if (v) dataParts.push(v);
        break;
      case "-u":
      case "--user":
        user = v ?? null;
        break;
      case "-A":
      case "--user-agent":
        if (v) addHeader("User-Agent", v);
        break;
      case "-e":
      case "--referer":
        if (v) addHeader("Referer", v);
        break;
      case "-b":
      case "--cookie":
        if (v?.includes("=")) addHeader("Cookie", v);
        else warnings.push("不支持从文件读取 Cookie，已跳过该参数");
        break;
      case "-G":
      case "--get":
        toQuery = true;
        break;
      case "-I":
      case "--head":
        if (!method) method = "HEAD";
        break;
      case "-x":
      case "--proxy":
        warnings.push("代理参数已忽略，请求将直连发送");
        break;
      default:
        if (t.startsWith("-")) {
          if (!FLAG_FLAGS.has(t) && !VALUE_FLAGS.has(t)) {
            warnings.push(`已忽略不认识的参数 ${t}`);
          }
        } else if (url === null) {
          url = t; // 第一个裸参数视为请求地址
        }
    }
  }

  if (user) {
    try {
      addHeader("Authorization", `Basic ${btoa(user)}`);
    } catch {
      warnings.push("用户名密码含非拉丁字符，无法生成 Basic 认证头");
    }
  }

  if (!url) throw new Error("未在命令中找到请求地址");

  if (toQuery && dataParts.length) {
    const q = dataParts.join("&");
    url += (url.includes("?") ? "&" : "?") + q;
  }
  // -G 时数据已并入查询串,不再视为请求体
  const body = toQuery ? "" : dataParts.join("&");
  if (!method) method = body ? "POST" : "GET";

  return { method, url, headers, body, warnings };
}
