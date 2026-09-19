// 中文文案半角标点检查:扫描 src 与 src-tauri/src 的用户可见字符串,
// 命中"中文紧邻半角 , : ; ? ! ( )"即报错。代码注释行会先被剥离,不参与检查。
// 用法:node scripts/check-punct.mjs(有违规时退出码 1)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BAD = /[\u4e00-\u9fa5][,:;!?()]|[,:;!?()][\u4e00-\u9fa5]/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|rs)$/.test(name)) out.push(p);
  }
  return out;
}

const files = [...walk("src"), ...walk("src-tauri/src")];
let hits = 0;

for (const f of files) {
  let text = readFileSync(f, "utf8");
  // 整文件剥离块注释(支持跨行),再按行处理
  text = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    let t = line;
    if (f.endsWith(".rs")) {
      t = t.replace(/\/\/.*$/, "");
    } else {
      t = t.replace(/(^|\s)\/\/[^/].*$/, "$1");
    }
    if (BAD.test(t)) {
      hits++;
      console.log(`${f}:${i + 1}: ${t.trim().slice(0, 90)}`);
    }
  });
}

console.log(hits ? `发现 ${hits} 处疑似半角标点(中文文案应使用全角),见上` : "OK:未发现半角标点");
process.exit(hits ? 1 : 0);
