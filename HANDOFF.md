# OmniKit 项目交接文档(原名 DevToolbox,2026-09-19 更名;项目目录名暂为 devtoolbox,其余已全部更名)

> 用途:在新会话中继续开发。本文档自包含全部上下文,无需原会话历史。
> 更新时间:2026-09-20(**v0.10.0 已修 MCP 400 根因/加旧版 SSE 传输/单实例锁/剪贴板加密落盘/应用内自动更新/vitest 测试门禁并出包**,见第四节「v0.10.0」)

## 一、项目是什么

**开发者个人工具箱（桌面应用）**，可插拔架构：侧边栏 + 工具注册表，后续新工具持续接入。

**第一个工具：「文件保险箱」**——把任意文件/文件夹批量加密成一个 `.box` 文件、输入密码解密还原。全程本地（AES-256-GCM + Argon2id）。

### 用户需求原话（约束）
1. 必须支持**文件夹和文件**（批量、递归）
2. **后续其他工具可以继续接入**这个桌面 app（所以骨架必须是注册表式插件架构）
3. Rust 环境安装在 **E 盘统一目录 `E:\DevEnv`** 下（用户 C 盘只剩 ~29G，不许撑爆）
4. 用户已授予完全权限，**不要反复询问**，直接干活
5. 用户目的："手痒想做"——小而快出成果，避免大而全

### 已否决的方向（不要再提）
- 在线工具箱类合集（用户认为红海，在线工具已覆盖）
- 本地知识库全文搜索（用户不需要，AI 时代用不上）
- RAG 知识库问答（现成产品 Cherry Studio/AnythingLLM 等太完善）
- LLM 用量统计/接口网关（需在每个 AI 应用里改 API 地址接入，用户嫌配置多，2026-09-18 否决；全局 MITM 抓取方案因要改系统代理+装根证书且抓不全，也不要再提）

## 二、技术栈与关键决策

- **Tauri 2 + React 19 + TypeScript + Vite 6**（前端）/ **Rust stable**（后端）
- cargo crates 走 **rsproxy 镜像**（已配置）；npm 已是 npmmirror
- 应用名 `OmniKit`，identifier `com.omnikit.desktop`，项目路径：
  `E:\projects\ai-projects\devtoolbox`
- 构建产物重定向：`src-tauri/.cargo/config.toml` → `E:\DevEnv\targets\omnikit`（保护 C 盘）
- 打包目标：NSIS（注意：首次 `tauri build` 会从 GitHub 下载 NSIS 工具，国内可能慢/失败；失败则改 bundle targets 为 `[]` 只出裸 exe）

## 三、环境状态（全部已装好，勿重装）

| 组件 | 位置/版本 | 备注 |
|---|---|---|
| Node / npm | v24.19.0 / 11.17.0 | registry=npmmirror |
| Rust | 1.98.1 stable-msvc | `RUSTUP_HOME=E:\DevEnv\rustup`，`CARGO_HOME=E:\DevEnv\cargo`，**装时用了 --no-modify-path，不在 PATH 里** |
| cargo 镜像 | `E:\DevEnv\cargo\config.toml` | rsproxy-sparse 已配置 |
| VS Build Tools 2022 | `E:\DevEnv\BuildTools` | MSVC 14.44.35207 + Win SDK 10.0.26100.0，vswhere 可检测到 |
| WebView2 运行时 | 153.0.4234.32 | 已存在 ✓ |

**每次新 Bash 调用都要先导出（shell 状态不跨调用保留）：**

```bash
export PATH="/e/DevEnv/cargo/bin:$PATH"
export RUSTUP_HOME='E:\DevEnv\rustup'
export CARGO_HOME='E:\DevEnv\cargo'
```

## 四、已完成的工作

### 已写入的文件（完整，无需重写）
```
omnikit/
├── package.json                  # react19/@tauri-apps/api2/plugin-dialog2/vite6/ts5，scripts: dev/build/tauri
├── tsconfig.json                 # strict、noEmit、react-jsx、moduleResolution bundler
├── vite.config.ts                # port 1420 strictPort、clearScreen false
├── index.html                    # zh-CN，#root
├── .gitignore
└── src-tauri/
    ├── Cargo.toml                # 依赖：tauri2、tauri-plugin-dialog 2、serde/serde_json、
    │                             #   aes-gcm 0.10、argon2 0.5、rand 0.8、walkdir 2、zeroize 1
    │                             #   [lib] name="omnikit_lib" crate-type=["rlib"]
    │                             #   release: lto+strip+opt-level=s
    ├── build.rs                  # tauri_build::build()
    ├── tauri.conf.json           # 窗口 1000x660 min860x560、dragDropEnabled、bundle nsis、
    │                             #   icons 引用 icon.ico/32x32/128x128/128x128@2x
    ├── .cargo/config.toml        # target-dir → E:\DevEnv\targets\omnikit
    └── capabilities/default.json # permissions: core:default, dialog:default
```

### 尚未创建(新会话的任务清单)
> ✅ 以下全部已于 2026-09-18 完成。

1. ~~Rust 源码~~ ✅(另加了 `error.rs` 错误模块;`unpack` 复用 `pack::Progress`;registry 因含 JSX 图标为 `registry.tsx`)
2. ~~应用图标~~ ✅ `scripts/make-icon.mjs`(纯 Node zlib 手绘)→ `npx tauri icon` 全套已生成
3. ~~前端~~ ✅(已按 `ui-design-system` 技能流程实现:深海军蓝×琥珀金、8pt 网格、系统字体栈)
4. ~~npm install~~ ✅
5. ~~cargo test~~ ✅ 3/3 通过(round-trip 含嵌套/空文件/非 1MiB 整数倍/错密码/冲突拒绝覆盖/非 .box 识别)
6. ~~npx tauri build~~ ✅ NSIS 下载成功,产物:
   - 裸 exe:`E:\DevEnv\targets\omnikit\release\omnikit.exe`(3.3 MB)
   - 安装包:`E:\DevEnv\targets\omnikit\release\bundle\nsis\OmniKit_0.1.0_x64-setup.exe`(1.2 MB)

### 实现偏差备忘(与原设计的差异)
- **meta_len 是明文 JSON 字节数**:磁盘上 meta 密文 = meta_len + 16B tag;unpack 须读 `meta_len+16` 字节,数据区起点 = `71 + meta_len + 16`(踩过的坑)
- pack 读取文件用 `read_exact` 严格按 1MiB 切块(与 unpack 的切块对齐,不能依赖 read 返回值)
- pack 结束先写 `<output>.part`,rename 前若 output 已存在则先删(Windows rename 不能覆盖)
- 进度 emit 在 commands 层做 100ms 节流;密码用 `Zeroizing<String>` 包裹
- 项目路径:**`E:\projects\ai-projects\devtoolbox`**(目录名保留旧名,待会话结束后由用户自行更名)

### v0.1.1 UI 改版(2026-09-18,用户反馈"AI 风格太重、布局丑")
- **整体换浅色网盘风**(百度网盘式清爽):白卡片 + 蓝主色 `#06A7FF`、1px 边框、扁平无渐变发光;`src/styles.css` 全量重写
- **新增 `sb_scan` 命令**(commands.rs,复用 pack::collect_files):选文件夹后前端展示完整文件清单表格(文件名+按扩展名着色的类型徽标+大小+合计),`--` 前端 `addItems` 追加去重
- 进度改"传输任务"卡片:百分比、字节、前端估算速度、当前文件
- **选取去重规则**(pack.rs `collect_files`,pack 与 sb_scan 共用):① 输入位于已保留输入内部(或重复)时整项跳过(父吞子,浅层优先);② 顶层同名冲突自动加 " (n)" 后缀(文件插在扩展名前);`sb_scan` 返回 `skippedInputs`/`renamedInputs`,前端表格上方展示提示
- 应用图标同步改版:**品牌图形是"工具箱"**(蓝色渐变圆角底 + 白色箱子),锁图标只属于文件保险箱单个工具(`scripts/make-icon.mjs` 已更新,重新 `tauri icon` 全套)
- 结果态改横条式(图标+统计+操作按钮),更紧凑
- 大文件夹扫描加 loading(表格内 spinner + `scanSeqRef` 序号防竞态;`clearAll` 作废进行中的扫描)
- 文案产品化:删掉算法参数 badges、"密码错误会立即提示"等讨论式说明;仅保留"密码丢失后无法找回"和"本地处理,数据不出设备"两条关键信息
- **新增「文件管理」工具**(v0.1.0 第二个工具,验证了插件架构):
  - 后端 `history.rs`:记录存 `%APPDATA%\com.omnikit.desktop\history.json`(tmp+rename 原子写,上限 200 条);`sb_encrypt/sb_decrypt` 成功后自动记录(kind/name/boxPath/location/files/bytes/time),失败静默不影响主流程
  - 命令:`sb_history_list / sb_history_remove / sb_history_clear`
  - 前端 `src/tools/history/History.tsx`:类型徽标(加密蓝/解密绿)+ 名称/位置双行 + 时间 + 内容统计 + 打开/删除,二次确认式清空;工具在 `registry.tsx` 注册为 `filemgr`
- placeholder 统一:`.input::placeholder` 强制正文字体(输出位置输入框是等宽字体,之前 placeholder 跟随导致与密码框不一致)
- 全角标点:29 处用户可见中文文案的半角 `,:` 改全角(含 Rust 错误消息)
- **加解密可取消**:pack/unpack 加 `should_stop` 闭包(块间检查);`AppState.cancel_slot` 槽位(Arc<AtomicBool>,ptr_eq 防误清)+ `sb_cancel` 命令;解密取消会删除已解出的半成品文件;打包取消删除 .part
- **页面联动**:`src/lib/bus.ts`(requestDecrypt/peekDecryptPrefill 版本戳防重放),文件管理加密记录点「解密」→ 切到保险箱预填 .box 路径
- **第三个工具「开发小工具」**(registry id `devtools`):JSON 格式化/压缩、时间戳双向转换(10/13 位自动识别)、Base64/URL 编解码(UTF-8 安全)、UUID v4 批量生成、哈希(MD5 纯 JS 实现 + SHA-1/256/512 WebCrypto);MD5 实现已过标准向量验证
- 项目已 git 化(2026-09-18 首次提交),历史性能基准:`cargo test --release bench_throughput -- --ignored --nocapture`(1MiB vs 16MiB 块实测无差异,瓶颈在磁盘)

### v0.1.2 新工具(2026-09-18)
- **哈希页拆分「文件校验/文本哈希」两个子 Tab**(`.seg seg-sm`,display:none 不适用——哈希用条件渲染):文件校验走后端 `sb_hash_file`(流式一次读取喂 MD5/SHA-1/256/512 四个 hasher,RustCrypto md-5/sha1/sha2;进度事件 `hashfile://progress`,复用取消槽);交互与文本一致:**选文件与计算解耦**,「开始计算/取消/清空」按钮前置,拖入仅选中不自动计算且仅文件校验子页激活时响应
- **第四个工具「二维码」**(registry id `qr`,`src/tools/qr/QrTool.tsx`,生成/识别子 Tab):
  - 生成:npm `qrcode` 库画到 528px canvas(CSS 显示 264px),「保存图片」走系统保存对话框(plugin-dialog `save` + 新 Rust 命令 `save_data_file`),提示 toast 报文件名
  - 识别:npm `jsqr` 纯前端解码;图片来源三种——拖入(onDragDropEvent,仅识别子页激活时响应)、点击选择(Rust `qr_read_image` 读文件→魔数嗅探 png/jpeg/gif/bmp/webp→base64 回前端)、**Ctrl+V 粘贴截图**(clipboard File 直接解);超大图等比缩到 ≤1600px 再识别;结果带复制按钮
- **第五个工具「文本对比」**(registry id `diff`,`src/tools/diff/DiffTool.tsx`):
  - 算法用 npm `diff`(jsdiff,Myers,纯 JS 零依赖,Jest 同款,稳定);行级 unified 视图:双行号槽、行首 +/− 标记、`+N −M` 统计、红绿底色、自动换行不出横向滚动
  - 两侧均可「载入文件」(Rust `read_text_file`:UTF-8 优先,失败尝试 GBK);任一侧超 2MB toast 提示;超 4000 行截断显示;有左右交换/清空;完全一致时提示
- 共享重构:`CopyButton` 抽到 `src/components/CopyButton.tsx`(DevTools 改为引用);`baseName` 移入 `src/lib/format.ts`
- Rust 新命令(commands.rs):`qr_read_image`(>32MB 拒绝)、`save_data_file`、`read_text_file`(>4MB 拒绝);Cargo 新依赖 `base64 0.22`、`encoding_rs 0.8`;capabilities 加 `dialog:allow-save`(显式,防 default 不含 save)
- 侧边栏现为 5 个工具;图标继续蓝色双色实心风(QrIcon=三个定位角+点阵、DiffIcon=浅/深双面板加减号,均在 registry.tsx)

### v0.1.3 展示优化(2026-09-18,用户反馈)
- **二维码改弹窗展示**:点「生成二维码」弹出全屏居中 modal(`.modal-mask`+`.qr-modal`,fixed inset-0 遮罩,点遮罩/关闭按钮/Esc 均可关),内部 640px 生成、CSS 320px 展示;保存图片按钮移入弹窗;modal 样式做成通用类,后续工具可复用
- **文本对比改左右分栏对比视图**(不再有下方结果区):
  - 内容区撑满剩余高度(`.diff-panes` height calc(100vh-210px) min 360),**按钮移到最下面**(开始对比/返回编辑、左右交换、清空、+N −M 统计)
  - 编辑/对比同一区域切换:编辑模式=两个大 textarea;点「开始对比」→ 同区域变成**左右对齐的分栏 diff**(jsdiff 结果按 del/add 块配对成 Pair{l,r},空侧灰底补位,单一 grid 滚动容器天然行对齐,左列右边框做分隔线);点「返回编辑」回 textarea
  - 对比模式实时:载入文件/左右交换后 200ms 防抖自动重算(`useEffect [left,right,mode]`)
  - 每行=行号槽(42px 右对齐)+ +/− 标记 + 内容(pre-wrap 自动换行,不出横向滚动);完全一致显示「两段内容完全一致」;超 4000 行截断
  - `.diff-no/.diff-mark/.diff-line` 类名保留但语义变为 cell 内元素,旧的 `.diff-out/.diff-row/.diff-grid` 已删

### v0.1.4 对比展示进阶(2026-09-19,用户确认后实现)
- **词级高亮**:配对的删除/新增行再做 `diffWords`(任一侧含 CJK 改用 `diffChars`)行内比对,变化片段用 `<mark class="w-del|w-add">` 加深(红 #ffc9c7/绿 #b4ecc9),未变部分保持行底色;行超过 400 字符跳过词级(防卡)
- **相同段落折叠**:连续上下文行 >10 时留头尾各 3 行,中间折叠为「展开中间相同的 N 行」按钮(`.diff-fold`,虚线上下框);展开状态存 `expanded: Set<foldId>`(id=折叠首行 key,重算后自然失效);两段完全一致时不折叠
- **差异导航+滚动条标记**:连续增删块为一「差异组」,组首行带 `data-chg=组号`;渲染后 `useLayoutEffect` 量测各组 `offsetTop/scrollHeight` 百分比 → 右缘 `.diff-rail` 上放 `.diff-marker`(mod 橙/del 红/add 绿,点击跳转);右上角 `.diff-nav` 圆胶囊「▲ n/N ▼」上下跳转,当前组行左缘蓝色竖条(`.chg-cur` inset box-shadow);进入对比视图自动定位到第一处差异
- 跳转定位 `el.offsetTop - 72`(露出上文);`.diff-scroll` 加 `position:relative` 作 offsetParent;外层 `.diff-wrap`(relative)承载 nav/rail 浮层
- 已修过的坑:① 对比结果未就绪时渲染空指针白屏 → 点击即算+空值守卫;② qrcode 库 `toCanvas` 会写内联 `style.width=640px` 顶掉 CSS → 绘制后 JS 显式设回 320px

### v0.1.5 对比选项(2026-09-19,用户要求可勾选忽略项)
- 内容区顶部加选项 chips(`.opt-chip`,勾选态蓝底):**忽略换行符差异(CR/LF,默认开)、忽略空行、忽略行首尾空白、忽略空白字符、忽略大小写**;勾选变化在对比模式下 200ms 防抖自动重算(effect deps 加 opts)
- 实现从 `diffLines` 换成**自切行 + `diffArrays`**:`toLines` 用 `split(/(\r\n|\r|\n)/)` 带分隔符切行,每行存 `{no: 原始行号(含被忽略行,行号可对照原文件), text, key}`;key 按 opts 处理(不忽略 CR 时用 \x01-\x03 后缀区分三种行尾;空白/大小写归一化),`comparator: a.key === b.key`;忽略空行在编号之后过滤
- 忽略空行+忽略空白字符联动:开了忽略空白字符时,纯空白行也视作空行
- 重算会重置折叠状态(`setExpanded(new Set())`,因为 foldId 基于 key 从 0 重排,不重置会串)
- **ctx 行左右各自取原文**:相同块 diffArrays 只回传一侧数组,原实现把同一 item 填给 l/r → 忽略大小写时右侧被左侧文字覆盖;已改为 lp/rp 双游标分别索引 L/R 原数组(忽略规则只影响比较,不影响显示)
- 折叠行样式改版:去掉整条虚线带,改为两侧 1px 细线 + 居中小胶囊按钮(`.diff-fold` 容器 + `.diff-fold-line` + `.diff-fold-btn`,hover 变主色);展开后区域末尾出现同款「收起 ⌃」胶囊,点击可折叠回去(expanded Set 删除该 id)

### v0.2.0 四个新工具(2026-09-19,用户指定批次:端口→正则→JWT·Cron→密码)
侧边栏现为 **9 个工具**。新增:
- **端口占用**(id `port`,`src/tools/port/PortTool.tsx` + Rust):
  - Rust(commands.rs):`net_list_ports`(spawn_blocking 跑 `netstat -ano`,`run_gbk_cmd` 用 encoding_rs 解 GBK 输出,只留 TCP LISTENING+UDP,`process_names()` 用 `tasklist /fo csv /nh` 建 PID→进程名表,按端口排序)与 `net_kill`(`taskkill /F /PID`,失败透传 GBK 错误消息);`parse_netstat` 有中文样例单测
  - 前端:过滤框(端口号/PID/进程名/地址实时过滤)、协议徽标(TCP 蓝/UDP 绿)、结束按钮走 `confirm()` 原生确认框,PID 0 禁用;页首自动加载
- **正则测试**(id `regex`,`src/tools/regex/RegexTool.tsx`):纯前端 JS RegExp;flags 胶囊(g/i/m/s)、实时匹配(matchAll,g 关时只匹配第一处,上限 1000 处)、预览高亮 `<mark class="re-hit">`、明细列表(序号/内容/位置/编号组$1/命名组$name/复制);正则错误红字内联(`.input-error` 红边框)
- **JWT·Cron**(id `expr`,`src/tools/expr/ExprTool.tsx`,两个子 Tab):
  - JWT:支持 Bearer 前缀;base64url→UTF-8 解码(`decodeB64Url`);header/payload pretty JSON+复制;alg 徽标、exp/nbf/iat 时间声明行(fmtTime),有效/已过期/未生效 chip(剩余时长 fmtDuration);签名原样保留,不校验签名
  - Cron:标准 5 字段;`parseField` 支持 * 、a-b、a-b/n、列表(日/周同时受限按 Vixie 语义 OR);字段含义中文描述(`stepText` 识别等差→"每 N 分钟",`listVals` 顿号列举≤6 个);**未来 5 次执行时间**逐分钟扫描(≤1 年);生成器:每 N 分钟/每小时/每天/每周(周几多选)/每月/自定义 六种模式,改动直接写入表达式输入框(input 变更自动切 custom 防回写打架)
- **密码生成**(id `pwgen`,`src/tools/pwgen/PwGenTool.tsx`):长度 6-64/数量 1-20/四类字符集/排除易混淆(0O1lI 等);`crypto.getRandomValues` 拒绝采样取无偏随机(`randInt`),每类至少一个再 Fisher-Yates 洗牌;熵位显示+强中弱分级(≥90/≥60);进页自动生成一批
- 新样式:port-head/port-row(与表头同网格)、regex-view/re-list、kv-list/kv-row(通用键值行)、jwt-chip、cron-table、pw-list/pw-row、input-error;新图标(PortIcon 网口三针/RegexIcon 点+星号/ClockIcon 时钟/KeyIcon 钥匙,均双色实心,registry.tsx)
- **工具布局调整(用户反馈)**:「JWT·Cron」合并菜单被否 → **Cron 独立成工具**(id `cron`,`src/tools/cron/CronTool.tsx`,内含解析/生成子页);**JWT 并入「开发小工具」第六个子 Tab**(DevTools.tsx 内 JwtTool,以后的小工具也加在这里);netstat/tasklist/taskkill 加 `CREATE_NO_WINDOW`(`hidden_command` 辅助)消除黑窗闪烁
- 端口页曾因「数据未加载时 filtered 为 null 直接 .map」白屏一次(diff 页同类问题第二次出现)——**教训:渲染列表永远不要用 `!` 非空断言,一律 `xxx &&` 守卫**
- **端口行可展开进程详情**(用户要求):`process_details()` 改用 **sysinfo 0.33** 一次读取全部进程(name/exe/cmd/memory/start_time,替代 tasklist 文本解析),PortEntry 扩展 name/path/cmd/mem/start 字段;前端点击行展开 `.port-detail`(进程/路径/命令行/启动时间/内存/打开所在文件夹——复用 sb_reveal),行点击与内部按钮 stopPropagation;系统进程路径可能取不到(权限),显示「不可获取」

### v0.3.0 第三批工具(2026-09-19,用户挑了 HTTP/颜色/TCP 连通/重复查找/大小分析)
侧边栏现为 **12 个工具**。新增:
- **端口占用拆两个子页**:端口监听(原功能,ListenView)/**连通测试**(ProbeView:`net_probe_tcp` Rust TCP connect_timeout,多解析地址逐个尝试,3 秒超时;结果 chip 可连接·耗时/失败原因+实际地址;回车触发)
- **HTTP 测试**(id `http`,`src/tools/http/HttpTool.tsx` + Rust `http_request` 用 **ureq 2**,30s 超时,4xx/5xx 按正常响应返回不算错误;响应体上限 2MB,GBK 页面按 charset 用 encoding_rs 解码;请求头名合法性校验防 panic):方法 seg(GET/POST/PUT/PATCH/DELETE)+URL 回车发送+动态请求头行+请求体;结果:状态 chip(2xx 绿/3xx 蓝/4xx5xx 红)+耗时+大小+响应头列表+响应体(JSON 自动格式化)
- **颜色工具**(id `color`,`src/tools/color/ColorTool.tsx`,纯前端):HEX(#rgb/#rrggbb/#rrggbbaa)/rgb()/hsl() 自动识别互转,系统取色器 input[type=color] 联动,大色块预览+三种格式复制行
- **磁盘分析**(id `disk`,`src/tools/disk/DiskTool.tsx`,重复文件/大小分析子页):
  - 重复查找:`disk_find_dupes` 四步流水(递归收集非空文件→按大小分组→首 4KB MD5 抽样预筛→全量 MD5 确认),进度事件 `dup://progress`(scan/part/hash 三阶段),复用 cancel_slot 取消;结果按可释放空间降序最多 500 组;每组内文件可「位置」(sb_reveal)/「删除」(`disk_trash` 用 **trash 3** 进回收站),组级「保留第一个其余删除」
  - 大小分析:`disk_dir_sizes` 递归累计一级子项(字节+文件数),进度事件 `dirsz://progress`,Top20 大文件原地维护;前端占比条形图+「进入」下钻(重新扫子目录)
- 新增依赖:ureq 2、trash 3;新命令 6 个;新图标 HttpIcon 地球/ColorIcon 水滴/DiskIcon 饼图
- **确认弹窗应用内化**(用户反馈原生框风格突兀):`src/components/ConfirmDialog.tsx` 提供 `showConfirm(opts)`(Promise 布尔)+ `<ConfirmHost />` 挂在 App;应用风格遮罩弹窗,支持 danger 红色确认按钮(删除/结束进程用)、回车确认、Esc/点遮罩取消;替换了端口结束进程与磁盘两处原生 confirm
- **控件高度体系**:标准 36(input/btn)、紧凑 28(input-sm/btn-sm/btn-chip/工具栏内 opt-chip);铁律是**同一行内控件必须同高**——磁盘分析工具栏用户嫌扁改回全尺寸 36,端口/HTTP/连通测试工具栏保持 28 紧凑;新增工具栏行时任选一档但行内统一

### v0.3.1 侧边栏分组(2026-09-19,方案 B)
- 12 个工具已到单列侧边栏上限,按用户确认的**方案 B(侧边栏分组,非顶部模块)**改造:
  - `registry.tsx`:`ToolModule` 增加 `group: ToolGroup`(file/dev/misc),导出 `GROUPS`(文件工具/开发工具/常用工具);**新工具注册时必须填 group**
  - App.tsx:侧边栏按组渲染,组头可点击折叠(chevron 旋转);折叠状态存 localStorage(`omnikit.sidebar.collapsed`);切换到某工具时自动展开其所在分组
  - 样式:`.tool-group/.group-head`;`.tool-list` 改为可滚动(flex:1 + overflow-y)
  - 后续工具超约 18 个时,可升级为方案 A(顶部模块 + 每模块左侧菜单),分组数据同一套,迁移无废功

### v0.4.0 系统监控/哈希比对/SQL 格式化/JSON 互转(2026-09-19)
- **系统监控**(id `monitor`,新分组「系统工具」的第 2 个成员,端口占用也挪入该组):Rust `sys_overview`(sysinfo:CPU 两次采样间隔 250ms 取使用率、逐核使用率、内存、Disks 挂载点/总量/剩余、OS 名+版本、uptime、进程数);前端 2 秒轮询,CPU 卡片(总使用率大数字+逐核小柱状图)、内存卡片、磁盘列表(使用超 90% 条形变红)、系统信息行;样式 `.mon-*`
- **文件哈希期望值比对**(文件校验子页):期望哈希输入框,忽略大小写空白后与 MD5/SHA-1/256/512 比对,命中显示绿色「✓ 与 XX 一致」,否则红色「✗ 与期望值不一致」;清空时重置
- **SQL 格式化**(开发小工具第 7 个子 Tab):npm `sql-formatter`,方言胶囊(标准 SQL/PostgreSQL/MySQL/SQLite)+关键字大写+2 空格缩进;解析失败红字提示
- **JSON 字符串↔对象互转**(JSON 子页新增两个按钮):「字符串转对象」=JSON.parse 输入,结果为字符串则再 parse 并格式化(兜底:手工去转义 `\\`→`\`、`\"`→`"` 后解析);「对象转字符串」=JSON.stringify(JSON.stringify(parsed)) 输出转义串字面量
- 侧边栏现为 4 组 13 个工具;新图标 GaugeIcon 仪表盘
- **SQL 语法高亮**(用户要求):prismjs(仅引入 SQL 语法组件)对格式化结果高亮展示——关键词蓝加粗/字符串绿/函数紫/数字橙/注释灰斜体(`.sql-out .token.*`);复制按钮复制的仍是纯文本;结果区从 textarea 改为可滚动 pre 容器

### v0.5.0 MCP 测试(2026-09-19)
- **新工具「MCP 测试」**(id `mcp`,开发工具组,`src/tools/mcp/McpTool.tsx` + `src-tauri/src/mcp.rs` 独立模块,侧边栏现为 4 组 14 个工具):
  - **双传输**:stdio(本地命令,支持引号分词 `split_command_line`,CREATE_NO_WINDOW 隐藏窗口,后台线程读 stdout 按行解析 JSON-RPC、stderr 进日志)与 Streamable HTTP(POST JSON-RPC,Accept 同时带 json 与 event-stream,自动维护 `Mcp-Session-Id`,响应可为 JSON 或 SSE,自定义请求头给鉴权);旧版 HTTP+SSE(2024-11-05 GET /sse)传输未做
  - JSON-RPC 手写实现(顺序请求+id 匹配+30s 超时):initialize(协议版本 2025-06-18,clientInfo OmniKit)→ notifications/initialized → tools/list、tools/call、resources/list、prompts/list;收发消息全记日志(上限 200 条,单条截断 2000 字)
  - Rust:`McpState(Mutex<Option<Arc<McpSession>>>)` 独立 manage;stdio 会话 Drop 杀子进程;**lib.rs 从 `.run(ctx)` 改为 `.build(ctx).run(callback)`,RunEvent::Exit 时清掉 McpState 结束残留子进程**;hidden_command 改 pub(crate) 供 mcp.rs 复用
  - 前端:连接卡片(stdio/http 切换+目标输入+http 请求头行)→ 连接后服务器信息 chips(名称版本/协议版本/能力中文标签)+ instructions 提示条 → 工具列表(名称/描述/调用按钮,选中高亮)→ 调用区(Schema 可折叠 pre、**按 JSON Schema 自动生成参数模板**——只填必填项无必填填全部、enum 取第一个、default 优先)→ 结果(成功/失败 chip+耗时、文本内容、原始 JSON 切换、复制);资源/提示列表;JSON-RPC 日志折叠面板;断开/退出清理
- 已知边界:tools/resources 分页游标未处理(取第一页);服务端主动请求(采样/根目录)仅记日志不响应;子进程孙进程(如 npx→node)不保证级联结束

### v0.6.0 进程管理/域名解析/日志查看(2026-09-19,用户挑的 1+2+3)
- **进程管理**(id `proc`,系统工具组):Rust `proc_list`(sysinfo 全进程,双刷新间隔 300ms 取 CPU 使用率,按内存降序返回);前端表格(进程名含启动时间悬停/路径/PID/CPU≥10% 标红/内存/位置+结束),搜索(名称/PID/路径)、排序胶囊(内存/CPU/名称)、**自动刷新每 3 秒可关**、合计内存统计;结束进程复用 net_kill+showConfirm 红色确认,位置复用 sb_reveal
- **域名解析**(端口占用第三个子页):`net_resolve` 系统解析(自动剥协议前缀/路径/端口,IPv6 保留),去重保序,IPv4/IPv6 徽标+复制
- **日志查看**(id `logtail`,开发工具组):Rust `log_tail_start/log_tail_stop` + TailState(独立 manage):后台线程每 500ms 增量读(seek 追读),初始加载文件末尾 200KB(丢弃首残行),单批最多 2000 行,文件变小(轮转)发 reset 事件自动重收;事件 `logtail://lines` {reset, lines}
  - 前端:缓冲上限 5000 行;关键字过滤(不区分大小写)+命中高亮(.re-hit 黄底);自动滚动开关(跟底);清屏;监视中/已停止状态 chip
- 侧边栏现为 **4 组 16 个工具**;新图标 ProcIcon 心电波纹/LogIcon 文档行;教训:python 批量改 registry 时注意数组逗号与 SVG 属性引号(曾产生数组空洞 undefined 与属性缺引号,tsc 拦截)
- **破坏性操作确认全覆盖**(用户要求):文件管理记录删除/清空改用 showConfirm(替换原两步内联确认);**新增 `path_exists` 命令**,保险箱加密时若输出位置已有同名 .box,先弹红色「覆盖确认」再执行;端口/进程/磁盘删除此前已接 showConfirm
- **修复进程管理 CPU/内存恒为 0**:sysinfo `ProcessRefreshKind::nothing()` 的 cpu/memory 开关默认关闭,需显式 `.with_memory().with_cpu()`;侧边栏不可滚动:grid 行高需 `grid-template-rows: minmax(0,1fr)` 锁定,否则内容把行撑出视口

### v0.7.0 托盘/设置页 + 数据工具箱 4 子页(2026-09-19)
- **系统托盘**:tauri 加 `tray-icon` feature;setup 里构建托盘(默认窗口图标+tooltip),左键单击恢复窗口,右键菜单(显示/退出);`tauri.conf.json` 主窗口 `visible: false`,setup 恢复几何后再 show
- **设置页**(侧边栏底部固定入口,齿轮图标,非注册表工具;`src/tools/settings/Settings.tsx`):
  - 关闭时最小化到托盘:`on_window_event` CloseRequested 拦截 hide;设置持久化在 **`settings.rs`**(`%APPDATA%/settings.json`,tmp+rename;`SettingsState(Mutex<AppSettings>)` setup 时 manage;`settings_get/settings_set` 命令)
  - 记住窗口大小和位置:RunEvent::Exit 保存 outer_position+inner_size+maximized;setup 恢复(Physical 单位)
  - 开机自启:**tauri-plugin-autostart**(写 HKCU Run 注册表),capabilities 加 allow-enable/disable/is-enabled
  - 启动页:localStorage(`omnikit.startPage`=last 或工具 id;`omnikit.lastPage` 每次切换记录),App.tsx 初始化时读取
- **数据工具箱扩到 11 个子 Tab**(新增 URL/批处理/进制/Base64;组件在 `src/tools/devtools/more.tsx` 独立模块,DevTools.tsx 引入):URL 解析(new URL+searchParams 自动解码,组成部分与查询参数逐项复制)、文本批处理(去重/排序/反转/去空行/Trim/大小写/全角转半角,点按即生效+20 步撤销)、进制换算(BigInt,2/8/10/16 互转,合法字符校验)、文件转 Base64(Rust `read_file_base64` 上限 16MB,输出纯 Base64 与 data URI,按扩展名映射 MIME)
- `.seg` 加 flex-wrap(11 个子 Tab 需换行);**教训:长内容严禁 bash heredoc 直写文件(两次被截断损坏,改用 Write 工具或脚本文件)**
- **新功能必须有用途说明**(用户要求):四个新子页(URL/批处理/进制/Base64)标题下补了 `.hint` 用途一句话;数据工具箱 desc 更新为列全部子项;**今后新增工具/子页,输入区上方或下方必须有一句「这是干啥的」**

### v0.8.0 剪贴板历史/全盘搜索/全局快捷键/错误边界/配置转换(2026-09-19)
- **错误边界**:`src/components/ErrorBoundary.tsx`(class 组件),App.tsx 里 `key={activeId}` 包裹懒加载工具页——单页崩溃只降级当前页(提示+重试),不再整站白屏;此前文本对比/端口页各白屏过一次
- **剪贴板历史**(id `clip`,常用工具组):Rust `clip.rs` + **arboard 3** 后台线程每秒轮询;文本(≤1MB)与图片(RGBA→**png 0.17** 编码,≤16MP)都记录;fnv 哈希去重+回贴自抑制(clip_write 后主动更新 last_hash);**只存内存(500 条)不落盘**;前端轮询 1.5s,搜索过滤,图片缩略图,「回贴」写回剪贴板;暂停 Switch;清空带确认;hint 提示隐私(含密码也会记录)
- **全局快捷键**:**tauri-plugin-global-shortcut**(Rust 侧注册,无需 capability);`register_hotkey` Alt+Q 显示/隐藏主窗口;settings 加 `hotkey_enabled`(默认开),设置页 Switch 动态注册/注销;lib.rs 插件初始化用 `Builder::new().build()`
- **文件搜索**(id `fsearch`,文件工具组,Everything 式):`search.rs` 后台线程 walkdir 遍历选定磁盘(`filter_entry` 按排除关键字剪枝,默认 node_modules 等,可编辑存 localStorage),进度事件 `idx://progress`;索引存内存 `Arc<Vec<Box<str>>>`(读写锁换 Arc 零成本读),完成后 **flate2 gz 压缩缓存**到 appdata,下次启动工具页自动加载;查询小写子串匹配、300 条截断;结果行复制+「位置」;磁盘选择胶囊(sys_overview 的挂载点)
- **配置转换**(数据工具箱子 Tab「配置」,js-yaml):YAML→JSON、JSON→YAML、properties→YAML、YAML→properties 四向;properties 点号键按层级拆解/合并(unflatten/flatten),注释(# !)与 =/: 分隔符支持
- **应用更名 OmniKit**(用户提出「不只是开发工具箱」):productName/窗口标题/托盘/侧栏品牌(> _ 标识)/设置关于全部同步;**identifier 保持 com.omnikit.desktop 不变**(保住设置/历史/索引缓存);Crate 内部名 omnikit 不变;图标源改为 **assets/app-icon.svg**(矢量,`npx tauri icon assets/app-icon.svg -o src-tauri/icons` 出全套;make-icon.mjs 已删);候选预览在 assets/preview-a|b|c
- **产品文案去掉「个人」说辞**(用户要求):副标题「百宝工具箱」、关于「v0.8.0 · 百宝工具箱 · …」;侧栏品牌标识底色改蓝色渐变(原 primary-dim 太浅,白色 >_ 看不清)
- **内部命名统一 omnikit**:mainBinaryName=OmniKit(免安装 exe 更名)、localStorage 键 omnikit.*、bus 事件 omnikit:navigate、快捷键提示文字;**identifier 与数据目录 com.omnikit.desktop 故意不改**(保用户数据);localStorage 键改名会重置侧栏折叠/启动页一次(已告知用户,开发阶段可接受)
- **修复「打开软件啥也没有」**:退出钩子曾把**最小化窗口**的 -32000,0 几何存进 settings.json,下次启动恢复到屏幕外。双重防护:Exit 保存时 is_minimized/width==0 跳过;启动恢复时校验尺寸≥400x300 且中心在主屏内,否则放弃恢复
- **macOS 适配 + CI 云构建**(用户拍板「两个都要,mac 走 CI」):
  - 代码双实现:sb_reveal 原有三分支;`collect_port_rows()` Windows=netstat 解析、**macOS=lsof**(`-iTCP -sTCP:LISTEN`/`-iUDP`),split_addr 抽共用;net_kill Windows=taskkill、macOS=kill -9;search 盘符根跳过加 #[cfg(windows)];磁盘分析面包屑分隔符按 UA 检测
  - **`.github/workflows/build.yml`**:workflow_dispatch + v* tag 触发;windows-latest 出 NSIS、macos-latest 出 app+dmg;**CI 必须设 `CARGO_TARGET_DIR=./target`**(本地 .cargo/config.toml 把 target-dir 指到 E:\DevEnv,CI 无效);npm ci + dtolnay/rust-toolchain@stable;产物 upload-artifact
  - 注意:mac 包未签名,Gatekeeper 需右键打开;mac cfg 分支本地无法编译验证,以 CI 为准
- **CI 发布链路补全**:build.yml 增加 release 任务(双平台构建成功后自动创建 GitHub Release 附 exe/dmg;发布过滤只留安装包本体);首轮构建曾因标点检查误报失败——**根因:Windows CI 检出为 CRLF,检查脚本按 
 切行致注释剥离正则失配**;已修复脚本(split /?
/)并新增 **.gitattributes 统一 eol=lf** 根治
- 侧边栏现为 **4 组 18 个工具**;新图标 SearchIcon/ClipboardIcon;教训:python 补丁里 `\\n` 经 heredoc 传递会变真换行(已两次),转义类内容一律 Write 脚本文件;registry 补丁注意 anchor 自带尾逗号导致的数组空洞
- **文件搜索排除规则移入设置页**(用户建议):settings.json 加 `search_excludes`(路径关键字,内置 node_modules/.git/.venv/__pycache__/$recycle.bin/system volume information/pagefile.sys/hiberfil.sys/swapfile.sys)与 `search_exclude_exts`(后缀,内置 tmp/temp/lnk)两个字段,serde(default=函数)保证老配置文件也拿到内置默认;设置页「文件搜索·排除规则」区(关键字/后缀两个 textarea,失焦保存);索引时目录关键字用 filter_entry 整枝剪枝、后缀只跳过文件;search_start 不再从前端收 excludes
- **文件搜索索引范围可视化**(用户反馈):索引完成时写元数据 `search-index.meta.json`(roots/files/time),缓存加载时一并读回;status 返回 roots;进入页面自动勾选**上次索引的范围**(用户手动改动后不再覆盖),状态行显示「范围 C:\、D:\」;勾选范围与已建索引不一致时红字提示「重新索引将按新范围重建」
- **文件搜索路线 A 改造**(用户对比 Everything 后拍板):
  - **并行索引**:walkdir 换 **jwalk 0.8**(rayon 并行遍历),process_read_dir 四参数闭包剪枝;完成后 sort_by_cached_key 按小写路径排序
  - **实时更新**:**notify 6** 递归监听各索引根,Create/Remove/Rename(From/To/Both)按小写序二分插入/删除(目录删除按前缀连续区间 drain);watcher 存在 SearchState,重建索引自动重启监听;路径写入前过排除规则;与 Everything 的 USN 方案不同但效果接近
  - **搜索**:空格分隔多关键字 AND;`*` `?` 通配符(手写 glob 递归匹配,不引 regex 库);仍为子串扫描,百万级约 0.2-0.4s/次
  - **UI 精简**:只剩搜索框 + 结果列表 + 底部一行状态;磁盘勾选/索引按钮只在「无索引/索引中/范围不一致/手动点重建」时出现,平时藏起,状态栏有「重建索引」入口
  - **查询防抖**(用户反馈输入卡顿):后端 search_query 改**队列化异步**——每次请求分配递增代数(query_seq),spawn_blocking 扫描,完成回填 query_result;等待循环里若结果代数落后最新请求则返回 stale,前端防抖 350ms、stale 时保持旧结果不闪烁;避免快速输入时扫描请求堆积互相阻塞
  - **索引进度条**(用户要求):`idx://progress` 事件带 phase(scanning/done/stopped)与 estimate(上次索引的文件数);有基准时百分比=min(95, files/estimate),无基准显示流动动画条+实时计数;`.idx-progress/.idx-bar/.flowing` 样式;修复 btn-sm 双重定义(30/28)统一 28
- 设置页开关用 `Switch` 组件(`src/components/Switch.tsx`),下拉用 `Dropdown` 组件(`src/components/Dropdown.tsx`,菜单 fixed 定位防 kv-list overflow 裁剪,菜单内滚动不关闭、页面滚动才收起、贴底自动上弹)

### v0.9.0 体验升级批次(2026-09-19,用户在功能盘点里指定:新工具只要 cURL 导入,其余做现有工具优化与工程项)
- **cURL 导入 HTTP 测试**:解析器 `src/lib/curl.ts`(`tokenize` 按 shell 规则切参:单双引号/反斜杠续行与转义;`parseCurl` 支持 -X/-H/-d 家族/--data-urlencode/--json/-F(转 body+提醒)/-u(Basic 认证)/-A/-e/-b/-G(-d 拼到 query)/-I/-x(忽略+提醒),兼容 `-XPOST` 附加值与 `--flag=value`,未知旗标记 warnings 不中断;无 URL 抛错)。HttpTool 加「导入 cURL」面板,解析成功自动填方法/地址/头/体并提示提醒条数;**METHODS 增加 HEAD**(请求体隐藏条件同步改)
- **HTTP 请求历史**(localStorage `omnikit.http.history`,50 条:时间/方法/URL/状态/耗时/请求快照,点击恢复,单条删除+清空带确认)与**环境变量**(`omnikit.http.env`,键值对;发送时把 URL/头值/请求体中的 `{{名称}}` 替换,未定义保持原样);工具栏三个 `btn btn-sm` 开关按钮(面板式,`btn-selected` 高亮)
- **Ctrl+K 命令面板**(App.tsx `CommandPalette`):全局 keydown Ctrl/Cmd+K 开关,输入按名称+描述+id 过滤,↑↓/Enter/Esc 键盘导航,空查询时常用置前;条目行内可标 ★;主区标题栏加「快速打开 Ctrl K」按钮(`.kbd` 键帽样式)
- **常用收藏**:侧栏每个工具行悬停出现星标(`.fav-star` 默认 opacity:0),存 localStorage `omnikit.favs`;侧栏顶部新增「常用」组(收藏非空才显示),条目与正式组复用同一 renderToolItem
- **文件搜索增强**:结果扩展名分布 chips(取前 8 类,`.ts · 12` 计数,可多选筛选+「清除筛选」,新查询自动重置);**行内预览**:行尾「预览/收起」,新命令 `file_snippet` 读文件头 4KB——NUL 字节判二进制,UTF-8 失败按 GBK 兜底(同 read_text_file 策略),返回首个非空行(≤200 字),`.fs-preview` 展示;命中计数在筛选时显示「命中 N 条 · 筛选显示 M 条」
- **剪贴板置顶**:按内容指纹(文本 djb2 哈希/图片宽高字节组合)存 `omnikit.clip.pins`(≤50 条),「置顶/已置顶」按钮,置顶排前且排序稳定(重启后内容重复制仍保持置顶语义);**托盘右键新增「剪贴板历史」**:恢复窗口并 `emit("omnikit://goto","clip")`,App.tsx listen 后切页
- **日志级别着色**:logtail `levelOf` 正则识别 ERROR/FATAL/CRITICAL(红)/WARN/WARNING(黄)/DEBUG/TRACE(灰),兼容 [XX] 与 level=xx 写法;`.log-lv-*` 用新变量 `--log-err/--log-warn`(深浅主题各一套)
- **检查更新**:Rust `update_check`(GitHub API `repos/Rosons/omnikit/releases/latest`,ureq 10s 超时,UA 随包版本 `concat!("OmniKit/",env!("CARGO_PKG_VERSION"))`;`version_gt` 逐段数字比较,有单测)+新命令 `open_url`(仅 http/https,Windows cmd start/macOS open)。设置页「更新」区:启动检查 Switch(`omnikit.update.auto`,默认开)+每天最多一次(`omnikit.update.last`),「立即检查」显示已最新/发现 vX,发现新版附「前往下载页」;App 启动静默检查(有新版才 toast)
- **深浅色主题**:`:root` 浅色为基(补 `color-scheme: light`),`:root[data-theme="dark"]` 全套深色变量+对 30 余处硬编码色的覆盖(chip/徽标/滚动条/toast/开关/diff 词高亮/SQL prism 配色等);`src/lib/theme.ts`(模式存 localStorage `omnikit.theme`=system/light/dark,matchMedia 监听系统切换实时生效;main.tsx 引入即应用);**index.html 头部预置脚本在渲染前定主题+设深色底,防白闪**(applyTheme 同时维护 documentElement 背景内联样式);设置页新增「外观」区(跟随系统/浅色/深色 Dropdown)
- **版本显示动态化**:侧栏 footer 与设置「关于」改用 `getVersion()`(来自 @tauri-apps/api/app,core:default 已放行),今后升版本不用改这两处文案
- **错误日志落盘**:Rust `log_append`(追加 `%APPDATA%/logs/app.log`,超 512KB 轮转 .old;UTC 时间 civil_from_days 手写格式化,消息压成单行;级别白名单 error/warn/info)+ `open_log_dir`;ErrorBoundary `componentDidCatch` 上报 UI 崩溃栈,main.tsx 挂 window error/unhandledrejection 全局捕获(每次运行上限 50 条防刷屏);设置「关于」加「打开日志文件夹」
- **v0.8.0 Release 多余文件根因与清理**:首轮 release 任务把 macOS `*.app` 目录当产物上传(upload-artifact 递归目录),`Info.plist`/`OmniKit`(Mach-O 主程序)/`OmniKit.icns` 混进 Release;d7255f1 改过滤 `dist/*.exe`、`dist/*.dmg`,**存量 3 个资产已通过 GitHub REST API 删除**(本机无 gh CLI,用 `git credential fill` 取已存令牌调 releases/assets DELETE,需走代理 127.0.0.1:7890)
- **CI 发布链路的真正修复(v0.9.0 首跑才发现)**:upload-artifact 多路径上传时以**公共父目录为 artifact 根**——上传 `bundle/dmg/*.dmg`+`bundle/macos/*.app` 会存成 `dmg/xx.dmg` 与 `macos/OmniKit.app/...`,download merge-multiple 到 dist 后是 `dist/dmg/xx.dmg`,导致旧的 `dist/*.dmg` glob 匹配不到、`fail_on_unmatched_files` 直接失败(v0.8.0 当时能发成功是因为那次跑的还是修复前的"全量上传"配置,过滤版从未真正跑过)。修复:mac 只上传 dmg 本体(去掉 .app),发布 glob 改 `dist/**/*.exe`、`dist/**/*.dmg`;修复在 tag 上重跑需**强推标签**(`git tag -f && git push -f`,re-run 失败任务只会用旧提交的工作流)
- 新命令 5 个:file_snippet/update_check/open_url/open_log_dir/log_append(全部注册进 lib.rs invoke_handler);工具数量仍为 4 组 18 个
- 教训:node(Windows)读不了 git-bash 的 /tmp 路径(curl -o /tmp/x 后 node require 失败),临时文件放项目目录;package.json 是 `"type": "module"`,tsc 编译出的 .js 会被 node 当 ESM(require 返回空 {}),一次性验证要复制成 .cjs 再跑

### v0.10.0 稳定性批次(2026-09-20,用户 7 项指定:MCP 修复+持久化/单实例/HTTP 记录开关/剪贴板落盘/应用内更新/前端测试/日志策略)
- **MCP HTTP 400 根因修复**:`http_post` 用 ureq `send_string` 时**从未设 Content-Type,默认发 text/plain**,规范严格的服务端(公司网关)必拒——已显式 `Content-Type: application/json`;补 `MCP-Protocol-Version: 2025-06-18` 头(initialize 之后,以 session_id 已发为标志);clientInfo 版本改随包版本;4xx/5xx 响应体透出(300 字,`HTTP {code}：{body}`),sse_post 同样处理
- **MCP 新增旧版 HTTP+SSE 传输**(kind `sse`,2024-11-05 老网关):GET 常驻事件流(AgentBuilder 挂 timeout_connect 10s + timeout_read 300s,**ureq 2 的 Request 没有连接超时方法**,整体超时不能设否则长连接被掐),`event: endpoint` 的 data 相对路径拼回绝对地址(resolve_endpoint),消息 POST 到 endpoint,响应从事件流收(rx channel 与 stdio 同构);sse_post 前 endpoint 未到会等最多 10s;断开=Drop 置 stop 标志(阻塞读要等读超时才退,可接受);前端 KINDS 三项,占位提示区分
- **MCP 服务器配置持久化**:连接成功自动记住(localStorage `omnikit.mcp.servers`,kind+target 去重,≤20 条含请求头),进页自动填最近一条,Dropdown「已保存的服务器」一键填入+清空记录;连接失败/调用失败写应用日志
- **单实例锁**:tauri-plugin-single-instance,**必须是 Builder 第一个注册的插件**,二次启动唤起已有窗口、新进程退出
- **剪贴板加密落盘**(默认开,`clip_persist` 入 AppSettings):AES-256-GCM 加密存 `appdata/clipboard/history.bin`(tmp+rename),**密钥存系统凭据库**(keyring 3,features windows-native/apple-native,服务 omnikit/用户 clipboard-history,base64 存储,首用生成);文件超 32MB 从最旧丢 10%;脏标记+3 秒节流写盘,RunEvent::Exit 兜底强写(clip_force_save);clip_init 启动恢复并续 id;**关闭开关即删除文件**,清空也删文件;32MB 内图片都在,超限丢最旧;keyring 拿不到密钥时本次运行不落盘(eprintln)
- **应用内自动更新**(完整链路):tauri-plugin-updater + capability `updater:default`;**签名密钥对已生成**——私钥 `E:\DevEnv\secrets\omnikit-updater.key`(空密码,**不进仓库、不进聊天记录**),公钥已写进 tauri.conf.json `plugins.updater.pubkey`,端点 `github.com/Rosons/omnikit/releases/latest/download/latest.json`;**`tauri.updater.conf.json` overlay(createUpdaterArtifacts:true)只在 CI 配了 secrets 时用**(`--config` 参数),本地与无 secrets 的 CI 构建不受影响;CI 双平台条件生成签名产物(exe.sig/app.tar.gz+sig),release 任务有 sig 时 node 组装 latest.json(平台 windows-x86_64/darwin-aarch64),发布文件清单用 find 动态生成(exe/dmg/tar.gz/sig/latest.json);前端设置页:check() 成功→「下载并安装」(Progress 事件显示 MB)+restart_app 命令重启;**插件 404/失败自动退回** update_check(GitHub API)比较版本+跳转下载页
- **前端测试门禁**:vitest(devDep),`npm test`;`src/lib/curl.test.ts`(13 用例)/`loglevel.test.ts`/`format.test.ts`,共 22 用例;levelOf 从 LogTailTool 抽到 `src/lib/loglevel.ts`;CI 双平台 npm ci 后先 `npm test` 再 build;**教训:测试断言写漏第一个 token(-d)会误报解析器错;`-G` 时 body 已并入 URL,方法判定不能再按 body 有无判 POST**
- **HTTP 请求历史开关**:工具栏「记录历史」Switch(localStorage `omnikit.http.record`,默认开),关闭后发送不落任何历史(带 Token 的头/体不再明文进 localStorage)
- **日志策略**(写 %APPDATA%\logs\app.log,512KB 轮转):启动 info(版本+UA);HTTP 请求网络层失败 warn(方法+URL,不含体);MCP 连接失败 error/调用失败 warn;更新检查失败 warn、下载安装失败 error;window 全局异常 error(50 条/次上限);ErrorBoundary 崩溃栈 error——错误必记、关键路径 info、其余不记
- 版本 0.10.0;**教训:bash 工作目录跨调用漂移(cd src-tauri 后下一条相对路径全挂),关键命令一律 cd 绝对路径;keyring 3 需要 windows-native/apple-native feature;GitHub secrets 在 step if 里可用 `${{ secrets.X != '' }}`**
- **修正:上一条的「secrets 在 step if 可用」是错的——`${{ secrets.X != '' }}` 写进任何 if 会让 GitHub 判整个工作流文件无效**(运行名显示为文件路径、标签不触发、push 显示 placeholder 失败);改用「脚本内 ls 判断 .sig 是否存在 + upload-artifact if-no-files-found: ignore」
- **v0.10.0 补充(用户反馈)**:剪贴板单条删除(`clip_remove` 命令,开启落盘时立即同步写盘)与图片预览弹窗(点缩略图开 `.clip-modal` 大图,白底衬透明 PNG,可回贴);`clip_remove`/`clip_write` 等已注册进 lib.rs
- 剩余:用户往 GitHub 仓库 Secrets 填 `TAURI_SIGNING_PRIVATE_KEY`(E:\DevEnv\secrets\omnikit-updater.key 内容)与 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`(空)后,下个 tag 自动带签名产物与 latest.json,应用内更新生效;未填也不影响常规构建发布
- **v0.10.1(2026-09-21)**:用户已填私钥 Secrets,发此版本首跑签名链路——CI 应产出 exe.sig/app.tar.gz+sig 并在 Release 附 latest.json;装着 v0.10.0 的机器在设置页「立即检查」应能发现 v0.10.1 并应用内「下载并安装」

### 剩余手动验收(需真人操作)
拖入文件夹 → 加密出 .box → 删除原文件 → 解密还原内容一致(加密引擎已被单测覆盖,此项主要验 UI 拖拽交互)

## 五、加密引擎设计规格（照此实现，不要改协议）

### .box 容器格式 v1
```
偏移  大小  字段
0     8    MAGIC = b"DBOXv001"
8     16   argon2 salt（随机）
24    4    m_kib  u32 LE = 65536（64 MiB）
28    4    t      u32 LE = 3
32    4    p      u32 LE = 1
36    4    nonce_prefix（随机 4 字节）
40    27   verify 块密文 = 11B 明文 b"DBOX-VERIFY" + 16B GCM tag
67    4    meta_len u32 LE（明文 JSON 字节数，≤512MB 校验）
71    N    meta 密文 = JSON + 16B tag
...        数据区：逐文件逐 chunk，每块 = 密文(明文+16B tag)，明文 chunk = 1 MiB（每文件最后一块可短）
```
- **Nonce**：`nonce_prefix(4B) || counter(u64 LE)`；counter 分配：meta=0，verify=1，数据块从 2 起全局递增
- **AAD**（每块必绑）：`MAGIC || kind_tag || file_index(u32 LE) || chunk_index(u32 LE)`，kind_tag：meta=`b"meta"`、verify=`b"vrfy"`、data=`b"data"`
- **元数据 JSON**：`{"v":1,"created_at":unix秒,"files":[{"path":"相对路径(正斜杠)","size":字节数}]}`
- 密钥：Argon2id(password, salt, m=65536KiB, t=3, p=1) → 32 字节 AES-256 key
- **pack**：walkdir 递归收集（排序、相对路径用 `/`、去重）；先写 `<output>.part` 全部完成后再 rename 成 `.box`；进度按 chunk 上报
- **unpack**：先解 verify 块校验密码（错密码快速失败）；路径清洗防 zip-slip（拒绝绝对路径、`..`、非 Normal 组件）；解密前先预检输出目录冲突（存在同名文件则整体报错不覆盖）；解完后读 1 字节须 EOF（防截断/损坏）
- 密码用完 `zeroize`

### Rust 模块划分（src-tauri/src/）
- `main.rs`：`windows_subsystem` attr + 调 `omnikit_lib::run()`
- `lib.rs`：Builder + `.plugin(tauri_plugin_dialog::init())` + `generate_handler![sb_encrypt, sb_decrypt, sb_reveal]`
- `crypto.rs`：derive_key / encrypt_piece / decrypt_piece / make_nonce / PieceKind / build_aad
- `format.rs`：MAGIC、CHUNK_SIZE=1MiB、header 偏移常量、BoxMeta/MetaFile(serde)
- `pack.rs`：`pack(inputs,&password,output,progress: impl Fn(Progress))`——核心函数收进度闭包，方便单测传 no-op
- `unpack.rs`：`unpack(box_path,&password,out_dir,progress)` 同上
- `commands.rs`：`sb_encrypt(paths, password, output)` / `sb_decrypt(box_path, password, output_dir)` / `sb_reveal(path)`（explorer /select）；重活丢 `tauri::async_runtime::spawn_blocking`，AppHandle clone 进闭包 emit 进度；返回 `SbSummary{output,files,bytes,elapsed_ms}`
- 进度事件：`app.emit("safebox://progress", {phase:"pack"|"unpack", current_file, files_done, files_total, bytes_done, bytes_total})`（v2 记得 `use tauri::Emitter;`）

### 前端架构（可插拔核心）
- `src/tools/registry.ts`：`ToolModule { id, name, desc, icon, component(lazy) }` + `tools` 数组——**未来工具只需在这里注册**
- `src/App.tsx`：侧边栏（工具列表）+ 主区渲染当前工具
- 第一个工具 `src/tools/safebox/`：加密/解密两个 Tab；拖拽（`getCurrentWebview().onDragDropEvent` 的 drop 事件拿 `payload.paths`）+ 对话框选择（`@tauri-apps/plugin-dialog` 的 `save`/`open`）；密码+确认密码；进度条监听事件；完成态「打开所在文件夹」（invoke sb_reveal）+ 重置
- `listen` 来自 `@tauri-apps/api/event`，`invoke` 来自 `@tauri-apps/api/core`

## 六、推荐执行顺序

```bash
cd /e/projects/ai-projects/omnikit
export PATH="/e/DevEnv/cargo/bin:$PATH"; export RUSTUP_HOME='E:\DevEnv\rustup'; export CARGO_HOME='E:\DevEnv\cargo'
npm install                                  # npmmirror，快
node scripts/make-icon.mjs && npx tauri icon assets/icon.png -o src-tauri/icons
cargo test                                   # 首次拉取+编译全部依赖（rsproxy），约 5-15 分钟
# → 写前端（先触发 ui-design-system 技能）
npx tauri build                              # 首次会下载 NSIS，失败就把 bundle.targets 改 []
```

## 七、验收标准

1. `cargo test`：加密→解密 round-trip 通过（含子文件夹嵌套、空文件、非 1MiB 整数倍文件、错密码报错）
2. `npx tauri build` 成功产出 exe/NSIS 安装包
3. 手动验证：拖入文件夹 → 加密出 .box → 删除原文件 → 解密还原内容一致
