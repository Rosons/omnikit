import type { ComponentType, LazyExoticComponent } from "react";
import { lazy } from "react";

/**
 * 工具模块注册表 —— 未来新工具只需在 tools 数组里加一条,
 * 侧边栏与路由自动生成,无需改动 App。
 */
export interface ToolModule {
  id: string;
  name: string;
  desc: string;
  icon: ComponentType<{ size?: number }>;
  component: LazyExoticComponent<ComponentType>;
}

export const tools: ToolModule[] = [
  {
    id: "safebox",
    name: "文件保险箱",
    desc: "打包加密成 .box，凭密码还原",
    icon: LockIcon,
    component: lazy(() => import("./safebox/SafeBox")),
  },
  {
    id: "filemgr",
    name: "文件管理",
    desc: "加密与解密过的文件记录",
    icon: FolderToolIcon,
    component: lazy(() => import("./history/History")),
  },
  {
    id: "devtools",
    name: "开发小工具",
    desc: "JSON / 时间戳 / 编解码 / UUID / 哈希",
    icon: WrenchIcon,
    component: lazy(() => import("./devtools/DevTools")),
  },
];

function FolderToolIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2.5h7A2.5 2.5 0 0 1 21 10v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17V7.5Z"
        fill="#9fcdfb"
      />
      <path
        d="M3 10.2h18V17a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17v-6.8Z"
        fill="#06a7ff"
      />
    </svg>
  );
}

function WrenchIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
        stroke="#06a7ff"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LockIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="10" width="16" height="10.5" rx="3" fill="#06a7ff" />
      <path
        d="M8 10V7.5a4 4 0 0 1 8 0V10"
        stroke="#5f6672"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="12" cy="14.6" r="1.7" fill="#ffffff" />
      <path d="M12 15.5v2.4" stroke="#ffffff" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}
