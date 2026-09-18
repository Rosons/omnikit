# DevToolbox 项目交接文档

> 用途:在新会话中继续开发。本文档自包含全部上下文,无需原会话历史。
> 更新时间:2026-09-18(**v0.1.2 已新增二维码/文本对比工具并出包**,见第四节「v0.1.2」)

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
- 应用名 `DevToolbox`，identifier `com.devtoolbox.desktop`，项目路径：
  `E:\projects\ai-projects\devtoolbox`
- 构建产物重定向：`src-tauri/.cargo/config.toml` → `E:\DevEnv\targets\devtoolbox`（保护 C 盘）
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
devtoolbox/
├── package.json                  # react19/@tauri-apps/api2/plugin-dialog2/vite6/ts5，scripts: dev/build/tauri
├── tsconfig.json                 # strict、noEmit、react-jsx、moduleResolution bundler
├── vite.config.ts                # port 1420 strictPort、clearScreen false
├── index.html                    # zh-CN，#root
├── .gitignore
└── src-tauri/
    ├── Cargo.toml                # 依赖：tauri2、tauri-plugin-dialog 2、serde/serde_json、
    │                             #   aes-gcm 0.10、argon2 0.5、rand 0.8、walkdir 2、zeroize 1
    │                             #   [lib] name="devtoolbox_lib" crate-type=["rlib"]
    │                             #   release: lto+strip+opt-level=s
    ├── build.rs                  # tauri_build::build()
    ├── tauri.conf.json           # 窗口 1000x660 min860x560、dragDropEnabled、bundle nsis、
    │                             #   icons 引用 icon.ico/32x32/128x128/128x128@2x
    ├── .cargo/config.toml        # target-dir → E:\DevEnv\targets\devtoolbox
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
   - 裸 exe:`E:\DevEnv\targets\devtoolbox\release\devtoolbox.exe`(3.3 MB)
   - 安装包:`E:\DevEnv\targets\devtoolbox\release\bundle\nsis\DevToolbox_0.1.0_x64-setup.exe`(1.2 MB)

### 实现偏差备忘(与原设计的差异)
- **meta_len 是明文 JSON 字节数**:磁盘上 meta 密文 = meta_len + 16B tag;unpack 须读 `meta_len+16` 字节,数据区起点 = `71 + meta_len + 16`(踩过的坑)
- pack 读取文件用 `read_exact` 严格按 1MiB 切块(与 unpack 的切块对齐,不能依赖 read 返回值)
- pack 结束先写 `<output>.part`,rename 前若 output 已存在则先删(Windows rename 不能覆盖)
- 进度 emit 在 commands 层做 100ms 节流;密码用 `Zeroizing<String>` 包裹
- 项目已从 `C:\Users\31288\.zcode\workspace\default\devtoolbox` 迁移到 **`E:\projects\ai-projects\devtoolbox`**

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
  - 后端 `history.rs`:记录存 `%APPDATA%\com.devtoolbox.desktop\history.json`(tmp+rename 原子写,上限 200 条);`sb_encrypt/sb_decrypt` 成功后自动记录(kind/name/boxPath/location/files/bytes/time),失败静默不影响主流程
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
- `main.rs`：`windows_subsystem` attr + 调 `devtoolbox_lib::run()`
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
cd /e/projects/ai-projects/devtoolbox
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
