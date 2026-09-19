/** 跨页面导航与解密预填(桌面单窗口:模块级变量 + 事件) */

export interface DecryptPrefill {
  /** 版本号:同一份预填不重复应用 */
  v: number;
  boxPath: string;
  outDir: string;
}

let seq = 0;
let pending: DecryptPrefill | null = null;

/** 从任意页面发起:切到「文件保险箱」解密 Tab 并预填 .box 路径 */
export function requestDecrypt(boxPath: string, outDir: string) {
  pending = { v: ++seq, boxPath, outDir };
  window.dispatchEvent(
    new CustomEvent("omnikit:navigate", { detail: { id: "safebox" } })
  );
}

/** SafeBox 挂载/激活时调用:返回还没应用过的预填(lastApplied 传入已应用版本) */
export function peekDecryptPrefill(lastApplied: number): DecryptPrefill | null {
  if (pending && pending.v !== lastApplied) return pending;
  return null;
}

/** 通用工具切换事件(供 App 侧边栏响应) */
export function requestNavigate(id: string) {
  window.dispatchEvent(
    new CustomEvent("omnikit:navigate", { detail: { id } })
  );
}
