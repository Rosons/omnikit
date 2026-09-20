/** 主题:跟随系统或手动指定,写入 <html data-theme>,深浅两套变量在 styles.css */

export type ThemeMode = "system" | "light" | "dark";

const KEY = "omnikit.theme";

export function loadThemeMode(): ThemeMode {
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" ? v : "system";
}

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(mode: ThemeMode) {
  const dark = mode === "dark" || (mode === "system" && systemPrefersDark());
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  // 覆盖 index.html 预设的深色底(防白闪),浅色时清掉交还 CSS
  document.documentElement.style.background = dark ? "#12151b" : "";
}

let unwatch: (() => void) | null = null;

function watchSystem() {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const fn = () => applyTheme(loadThemeMode());
  mq.addEventListener("change", fn);
  return () => mq.removeEventListener("change", fn);
}

/** 切换主题模式:立即生效;跟随系统时注册系统配色监听 */
export function saveThemeMode(mode: ThemeMode) {
  localStorage.setItem(KEY, mode);
  applyTheme(mode);
  unwatch?.();
  unwatch = mode === "system" ? watchSystem() : null;
}

// 模块加载即应用,早于 React 渲染,避免主题跳变
unwatch = watchSystem();
applyTheme(loadThemeMode());
