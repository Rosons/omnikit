import type { ComponentType, LazyExoticComponent } from "react";
import { lazy } from "react";

/**
 * 工具模块注册表 —— 未来新工具只需在 tools 数组里加一条,
 * 侧边栏与路由自动生成,无需改动 App。
 */
export type ToolGroup = "file" | "dev" | "system" | "misc";

export const GROUPS: { id: ToolGroup; name: string }[] = [
  { id: "file", name: "文件工具" },
  { id: "dev", name: "开发工具" },
  { id: "system", name: "系统工具" },
  { id: "misc", name: "常用工具" },
];

export interface ToolModule {
  id: string;
  name: string;
  desc: string;
  group: ToolGroup;
  icon: ComponentType<{ size?: number }>;
  component: LazyExoticComponent<ComponentType>;
}

export const tools: ToolModule[] = [
  {
    id: "safebox",
    group: "file" as ToolGroup,
    name: "文件保险箱",
    desc: "打包加密成 .box，凭密码还原",
    icon: LockIcon,
    component: lazy(() => import("./safebox/SafeBox")),
  },
  {
    id: "filemgr",
    group: "file" as ToolGroup,
    name: "文件管理",
    desc: "加密与解密过的文件记录",
    icon: FolderToolIcon,
    component: lazy(() => import("./history/History")),
  },
  {
    id: "devtools",
    group: "dev" as ToolGroup,
    name: "数据工具箱",
    desc: "JSON、编解码、哈希、JWT、SQL、URL 解析、批处理、进制、Base64 等 11 项小功能",
    icon: WrenchIcon,
    component: lazy(() => import("./devtools/DevTools")),
  },
  {
    id: "qr",
    group: "misc" as ToolGroup,
    name: "二维码",
    desc: "生成与识别二维码，全程本机处理",
    icon: QrIcon,
    component: lazy(() => import("./qr/QrTool")),
  },
  {
    id: "diff",
    group: "dev" as ToolGroup,
    name: "文本对比",
    desc: "两段文本或文件逐行差异",
    icon: DiffIcon,
    component: lazy(() => import("./diff/DiffTool")),
  },
  {
    id: "port",
    group: "system" as ToolGroup,
    name: "端口占用",
    desc: "查看监听端口并结束进程",
    icon: PortIcon,
    component: lazy(() => import("./port/PortTool")),
  },
  {
    id: "http",
    group: "dev" as ToolGroup,
    name: "HTTP 测试",
    desc: "本地发起请求，查看响应",
    icon: HttpIcon,
    component: lazy(() => import("./http/HttpTool")),
  },
  {
    id: "mcp",
    group: "dev" as ToolGroup,
    name: "MCP 测试",
    desc: "连接 MCP 服务器，调试工具调用",
    icon: PlugIcon,
    component: lazy(() => import("./mcp/McpTool")),
  },
  {
    id: "logtail",
    group: "dev" as ToolGroup,
    name: "日志查看",
    desc: "实时跟踪日志文件与关键字过滤",
    icon: LogIcon,
    component: lazy(() => import("./logtail/LogTailTool")),
  },
  {
    id: "regex",
    group: "dev" as ToolGroup,
    name: "正则测试",
    desc: "实时匹配高亮与分组解析",
    icon: RegexIcon,
    component: lazy(() => import("./regex/RegexTool")),
  },
  {
    id: "cron",
    group: "dev" as ToolGroup,
    name: "Cron 表达式",
    desc: "定时表达式解析与生成",
    icon: ClockIcon,
    component: lazy(() => import("./cron/CronTool")),
  },
  {
    id: "pwgen",
    group: "misc" as ToolGroup,
    name: "密码生成",
    desc: "随机强密码批量生成",
    icon: KeyIcon,
    component: lazy(() => import("./pwgen/PwGenTool")),
  },
  {
    id: "color",
    group: "misc" as ToolGroup,
    name: "颜色工具",
    desc: "HEX 与 RGB、HSL 互转",
    icon: ColorIcon,
    component: lazy(() => import("./color/ColorTool")),
  },
  {
    id: "clip",
    group: "misc" as ToolGroup,
    name: "剪贴板",
    desc: "复制历史与一键回贴",
    icon: ClipboardIcon,
    component: lazy(() => import("./clip/ClipTool")),
  },
  {
    id: "disk",
    group: "file" as ToolGroup,
    name: "磁盘分析",
    desc: "重复文件查找与目录大小",
    icon: DiskIcon,
    component: lazy(() => import("./disk/DiskTool")),
  },
  {
    id: "rename",
    group: "file" as ToolGroup,
    name: "批量重命名",
    desc: "规则批量改名，预览确认后执行",
    icon: RenameIcon,
    component: lazy(() => import("./rename/RenameTool")),
  },
  {
    id: "fsearch",
    group: "file" as ToolGroup,
    name: "文件搜索",
    desc: "全盘索引，文件名秒搜",
    icon: SearchIcon,
    component: lazy(() => import("./fsearch/FileSearchTool")),
  },
  {
    id: "lan",
    group: "system" as ToolGroup,
    name: "局域网扫描",
    desc: "网段内存活主机与开放端口",
    icon: LanIcon,
    component: lazy(() => import("./lan/LanTool")),
  },
  {
    id: "dns",
    group: "system" as ToolGroup,
    name: "DNS 查询",
    desc: "多 DNS 服务器解析结果对比",
    icon: DnsIcon,
    component: lazy(() => import("./dns/DnsTool")),
  },
  {
    id: "monitor",
    group: "system" as ToolGroup,
    name: "系统监控",
    desc: "CPU、内存与磁盘实时状态",
    icon: GaugeIcon,
    component: lazy(() => import("./monitor/MonitorTool")),
  },
  {
    id: "proc",
    group: "system" as ToolGroup,
    name: "进程管理",
    desc: "全部进程、资源占用与结束",
    icon: ProcIcon,
    component: lazy(() => import("./proc/ProcTool")),
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

function HttpIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" fill="#9fcdfb" />
      <ellipse
        cx="12"
        cy="12"
        rx="4.2"
        ry="9"
        stroke="#06a7ff"
        strokeWidth="1.7"
        fill="none"
      />
      <path d="M3.6 9h16.8M3.6 15h16.8" stroke="#06a7ff" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="9" stroke="#06a7ff" strokeWidth="2" fill="none" />
    </svg>
  );
}

function ColorIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3.2C15.5 7.6 18 11 18 14a6 6 0 1 1-12 0c0-3 2.5-6.4 6-10.8z"
        fill="#9fcdfb"
      />
      <path
        d="M12 8.4c1.8 2.4 3 4.3 3 5.8a3 3 0 0 1-6 0c0-1.5 1.2-3.4 3-5.8z"
        fill="#06a7ff"
      />
    </svg>
  );
}

function DiskIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" fill="#9fcdfb" />
      <path d="M12 3a9 9 0 0 1 9 9h-9z" fill="#06a7ff" />
      <circle cx="12" cy="12" r="9" stroke="#06a7ff" strokeWidth="2" fill="none" />
    </svg>
  );
}

function GaugeIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3.5 15.5a8.5 8.5 0 1 1 17 0z"
        fill="#9fcdfb"
      />
      <path d="M3.5 15.5a8.5 8.5 0 1 1 17 0" stroke="#06a7ff" strokeWidth="2" fill="none" />
      <path d="M12 15.5L16 9.5" stroke="#06a7ff" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="12" cy="15.5" r="1.8" fill="#06a7ff" />
      <rect x="3" y="17.5" width="18" height="2.4" rx="1.2" fill="#06a7ff" />
    </svg>
  );
}

function PlugIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="8.6" y="2.5" width="2.4" height="6" rx="1.2" fill="#9fcdfb" />
      <rect x="13" y="2.5" width="2.4" height="6" rx="1.2" fill="#9fcdfb" />
      <path d="M7 7.5h10v4a5 5 0 0 1-5 5 5 5 0 0 1-5-5z" fill="#06a7ff" />
      <rect x="10.8" y="14" width="2.4" height="7.5" rx="1.2" fill="#06a7ff" />
    </svg>
  );
}

function ProcIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" fill="#9fcdfb" />
      <path
        d="M5 12.5h3.2L10 8l3.4 8 2-3.5H19"
        stroke="#06a7ff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function LogIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 2.5h9l4 4V21.5H6z" fill="#9fcdfb" />
      <path d="M15 2.5l4 4h-4z" fill="#06a7ff" />
      <g stroke="#06a7ff" strokeWidth="1.7" strokeLinecap="round">
        <path d="M9 10h7" />
        <path d="M9 13.5h7" />
        <path d="M9 17h4.5" />
      </g>
    </svg>
  );
}

function SearchIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="10.5" cy="10.5" r="6.5" fill="#9fcdfb" />
      <circle cx="10.5" cy="10.5" r="6.5" stroke="#06a7ff" strokeWidth="2" fill="none" />
      <path d="M15.5 15.5L20.5 20.5" stroke="#06a7ff" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function ClipboardIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="4" width="14" height="18" rx="2.5" fill="#9fcdfb" />
      <rect x="8.5" y="2.5" width="7" height="4" rx="1.5" fill="#06a7ff" />
      <g stroke="#06a7ff" strokeWidth="1.7" strokeLinecap="round">
        <path d="M8.5 11h7" />
        <path d="M8.5 14.5h7" />
        <path d="M8.5 18h4.5" />
      </g>
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

function LanIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0"
        fill="#06a7ff"
      />
      <g stroke="#06a7ff" strokeWidth="1.8" strokeLinecap="round" fill="none">
        <path d="M8.5 15.5a5 5 0 0 1 0-7" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      </g>
      <g stroke="#9fcdfb" strokeWidth="1.8" strokeLinecap="round" fill="none">
        <path d="M5.6 18.4a9 9 0 0 1 0-12.8" />
        <path d="M18.4 5.6a9 9 0 0 1 0 12.8" />
      </g>
    </svg>
  );
}

function RenameIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="12" height="14" rx="2" fill="#9fcdfb" />
      <path d="M15 9.5h5.5a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H15z" fill="#06a7ff" />
      <g stroke="#ffffff" strokeWidth="1.7" strokeLinecap="round">
        <path d="M6.5 9.5h5" />
        <path d="M6.5 12.5h5" />
        <path d="M6.5 15.5h3.5" />
      </g>
      <path d="M13 6l4.5 12" stroke="#06a7ff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function DnsIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" fill="#9fcdfb" />
      <path d="M12 3a9 9 0 0 1 9 9h-9z" fill="#06a7ff" />
      <circle cx="12" cy="12" r="9" stroke="#06a7ff" strokeWidth="2" fill="none" />
      <ellipse cx="12" cy="12" rx="4" ry="9" stroke="#06a7ff" strokeWidth="1.6" fill="none" />
      <path d="M3.5 9.5h17M3.5 14.5h17" stroke="#06a7ff" strokeWidth="1.6" />
    </svg>
  );
}
