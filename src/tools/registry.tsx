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
  {
    id: "qr",
    name: "二维码",
    desc: "生成与识别二维码，全程本机处理",
    icon: QrIcon,
    component: lazy(() => import("./qr/QrTool")),
  },
  {
    id: "diff",
    name: "文本对比",
    desc: "两段文本或文件逐行差异",
    icon: DiffIcon,
    component: lazy(() => import("./diff/DiffTool")),
  },
  {
    id: "port",
    name: "端口占用",
    desc: "查看监听端口并结束进程",
    icon: PortIcon,
    component: lazy(() => import("./port/PortTool")),
  },
  {
    id: "regex",
    name: "正则测试",
    desc: "实时匹配高亮与分组解析",
    icon: RegexIcon,
    component: lazy(() => import("./regex/RegexTool")),
  },
  {
    id: "cron",
    name: "Cron 表达式",
    desc: "定时表达式解析与生成",
    icon: ClockIcon,
    component: lazy(() => import("./cron/CronTool")),
  },
  {
    id: "pwgen",
    name: "密码生成",
    desc: "随机强密码批量生成",
    icon: KeyIcon,
    component: lazy(() => import("./pwgen/PwGenTool")),
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
        d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"
        fill="#06a7ff"
      />
    </svg>
  );
}

function QrIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      {[
        [3, 3],
        [14, 3],
        [3, 14],
      ].map(([x, y]) => (
        <path
          key={`${x}-${y}`}
          transform={`translate(${x - 3} ${y - 3})`}
          fillRule="evenodd"
          fill="#06a7ff"
          d="M3 3h7v7H3zM4 4h5v5H4zM5 5h3v3H5z"
        />
      ))}
      <rect x="12" y="14" width="2" height="2" fill="#06a7ff" />
      <rect x="16" y="14" width="2" height="2" fill="#06a7ff" />
      <rect x="20" y="14" width="2" height="2" fill="#06a7ff" />
      <rect x="12" y="18" width="2" height="2" fill="#06a7ff" />
      <rect x="16" y="18" width="2" height="2" fill="#06a7ff" />
      <rect x="20" y="18" width="2" height="2" fill="#06a7ff" />
      <rect x="14" y="12" width="2" height="2" fill="#9fcdfb" />
      <rect x="18" y="12" width="2" height="2" fill="#9fcdfb" />
    </svg>
  );
}

function DiffIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="8" height="14" rx="2" fill="#9fcdfb" />
      <rect x="13" y="5" width="8" height="14" rx="2" fill="#06a7ff" />
      <path
        d="M5.8 12h2.4"
        stroke="#ffffff"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M17 10.8v2.4M15.8 12h2.4"
        stroke="#ffffff"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PortIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="3" fill="#9fcdfb" />
      <rect x="6" y="10.5" width="12" height="6.5" rx="1.5" fill="#06a7ff" />
      <rect x="8" y="7" width="2" height="5" rx="1" fill="#06a7ff" />
      <rect x="11" y="7" width="2" height="5" rx="1" fill="#06a7ff" />
      <rect x="14" y="7" width="2" height="5" rx="1" fill="#06a7ff" />
    </svg>
  );
}

function RegexIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="5.5" cy="17.5" r="2.6" fill="#9fcdfb" />
      <g stroke="#06a7ff" strokeWidth="2.4" strokeLinecap="round">
        <path d="M16.5 3.5v10" />
        <path d="M12.3 6l8.4 5" />
        <path d="M20.7 6l-8.4 5" />
      </g>
    </svg>
  );
}

function ClockIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" fill="#9fcdfb" />
      <circle cx="12" cy="12" r="9" stroke="#06a7ff" strokeWidth="2" />
      <path
        d="M12 7.2V12l3.4 2.5"
        stroke="#06a7ff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function KeyIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="7.5" cy="12" r="4.5" fill="#06a7ff" />
      <circle cx="7.5" cy="12" r="1.8" fill="#ffffff" />
      <rect x="11" y="10.8" width="10" height="2.4" rx="1.2" fill="#9fcdfb" />
      <rect x="16" y="12.4" width="2" height="3.4" rx="1" fill="#06a7ff" />
      <rect x="19.5" y="12.4" width="2" height="3.4" rx="1" fill="#06a7ff" />
    </svg>
  );
}

function LockIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8 10V7.5a4 4 0 0 1 8 0V10"
        stroke="#9fcdfb"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <rect x="4" y="10" width="16" height="10.5" rx="3" fill="#06a7ff" />
      <circle cx="12" cy="14.6" r="1.7" fill="#ffffff" />
      <path d="M12 15.5v2.4" stroke="#ffffff" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}
