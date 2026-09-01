---
name: web-access
license: MIT
github: https://github.com/eze-is/web-access
description:
  所有联网操作必须通过此 skill 处理，包括：搜索、网页抓取、登录后操作、网络交互等。
  触发场景：用户要求搜索信息、查看网页内容、访问需要登录的网站、操作网页界面、抓取社交媒体内容（小红书、微博、推特等）、读取动态渲染页面、以及任何需要真实浏览器环境的网络任务。
metadata:
  author: 一泽Eze
  version: "2.5.4"
---

# web-access Skill

## 前置检查

在开始联网操作前，先检查 CDP 模式可用性：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/check-deps.mjs"
```

**Node.js 22+** 必需（使用原生 WebSocket）。

按脚本输出处理：
- `exit 0` → 继续
- `exit 2` → 需询问用户偏好，写入 `${CLAUDE_SKILL_DIR}/config.env` 的 `WEB_ACCESS_BROWSER`
- `exit 1` → 按 stdout 错误信息处理。若提示包含「Agent 处理顺序」，按其步骤执行（如先用系统命令打开浏览器后重跑），自动可解则不打扰用户；仍失败再向用户求助

支持参数 `--browser <chrome|edge>` 表达本次临时覆盖（不写 config.env）。

切换浏览器时，proxy 是长驻进程，需先 `pkill -f cdp-proxy.mjs` 再重跑 check-deps。

检查通过后并必须在回复中向用户直接展示以下须知，再启动 CDP Proxy 执行操作：

```
温馨提示：部分站点对浏览器自动化操作检测严格，存在账号封禁风险。已内置防护措施但无法完全避免，Agent 继续操作即视为接受。
```

## 浏览哲学

**像人一样思考，兼顾高效与适应性的完成任务。**

执行任务时不会过度依赖固有印象所规划的步骤，而是带着目标进入，边看边判断，遇到阻碍就解决，发现内容不够就深入——全程围绕「我要达成什么」做决策。这个 skill 的所有行为都应遵循这个逻辑。

**① 拿到请求** — 先明确用户要做什么，定义成功标准：什么算完成了？需要获取什么信息、执行什么操作、达到什么结果？这是后续所有判断的锚点。

**② 选择起点** — 根据任务性质、平台特征、达成条件，选一个最可能直达的方式作为第一步去验证。一次成功当然最好；不成功则在③中调整。比如，需要操作页面、需要登录态、已知静态方式不可达的平台（小红书、微信公众号等）→ 直接 CDP

**③ 过程校验** — 每一步的结果都是证据，不只是成功或失败的二元信号。用结果对照①的成功标准，更新你对目标的判断：路径在推进吗？结果的整体面貌（质量、相关度、量级）是否指向目标可达？发现方向错了立即调整，不在同一个方式上反复重试——搜索没命中不等于"还没找对方法"，也可能是"目标不存在"；API 报错、页面缺少预期元素、重试无改善，都是在告诉你该重新评估方向。遇到弹窗、登录墙等障碍，判断它是否真的挡住了目标：挡住了就处理，没挡住就绕过——内容可能已在页面 DOM 中，交互只是展示手段。

**④ 完成判断** — 对照定义的任务成功标准，确认任务完成后才停止，但也不要过度操作，不为了"完整"而浪费代价。

## 联网工具选择

- **确保信息的真实性，一手信息优于二手信息**：搜索引擎和聚合平台是信息发现入口。当多次搜索尝试后没有质的改进时，升级到更根本的获取方式：定位一手来源（官网、官方平台、原始页面）。

| 场景 | 工具 |
|------|------|
| 搜索摘要或关键词结果，发现信息来源 | **WebSearch** |
| URL 已知，需要从页面定向提取特定信息 | **WebFetch**（拉取网页内容，由小模型根据 prompt 提取，返回处理后结果） |
| URL 已知，需要原始 HTML 源码（meta、JSON-LD 等结构化字段） | **curl** |
| 非公开内容，或已知静态层无效的平台（小红书、微信公众号等公开内容也被反爬限制） | **浏览器 CDP**（直接，跳过静态层） |
| 需要登录态、交互操作，或需要像人一样在浏览器内自由导航探索 | **浏览器 CDP** |

浏览器 CDP 不要求 URL 已知——可从任意入口出发，通过页面内搜索、点击、跳转等方式找到目标内容。WebSearch、WebFetch、curl 均不处理登录态。

**Jina**（可选预处理层，可与 WebFetch/curl 组合使用，由于其特性可节省 tokens 消耗，请积极在任务合适时组合使用）：第三方网络服务，可将网页转为 Markdown，大幅节省 token 但可能有信息损耗。调用方式为 `r.jina.ai/example.com`（URL 前加前缀，不保留原网址 http 前缀），限 20 RPM。适合文章、博客、文档、PDF 等以正文为核心的页面；对数据面板、商品页等非文章结构页面可能提取到错误区块。

进入浏览器层后，`/eval` 就是你的眼睛和手：

- **看**：用 `/eval` 查询 DOM，发现页面上的链接、按钮、表单、文本内容——相当于「看看这个页面有什么」
- **做**：用 `/click` 点击元素、`/scroll` 滚动加载、`/eval` 填表提交——像人一样在页面内自然导航
- **读**：用 `/eval` 提取文字内容，判断图片/视频是否承载核心信息——是则提取媒体 URL 定向读取或 `/screenshot` 视觉识别

浏览网页时，**先了解页面结构，再决定下一步动作**。不需要提前规划所有步骤。

### 页面就绪与完成判断

`/new` 或 `/navigate` 返回，只代表浏览器完成了当前文档的基础加载，不代表用户需要的内容已经出现。HTTP 200、`document.readyState === "complete"`、页面标题出现或导航调用成功，都不能单独作为任务完成标准。

导航后先用 `/eval` 检查目标内容。若目标内容尚未出现，而页面仍是空白、加载态、验证页、登录跳转或其它可能继续变化的中间状态，在默认 15 秒窗口内持续观察 URL、标题和 DOM；页面发生跳转或内容变化后重新判断。只有目标内容已经获取，或观察窗口结束后仍存在明确阻碍，才能继续提取或报告失败。

站点经验可以提供更精确的选择器、等待条件和已知中间状态，但只用于加速判断；即使没有站点经验，也必须遵循上述目标内容就绪规则。

### 补充：本地浏览器资源

用户指向**本人访问过的页面**（"我之前看的那个讲 X 的文章"、"上次打开过的 XX 面板"）或**组织内部系统**（"我们的 XX 平台"、"公司那个 YY 系统"等公网搜不到的目标）时，检索本地浏览器（Chrome / Edge）书签/历史：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/find-url.mjs" [关键词...] [--only bookmarks|history] [--browser chrome|edge] [--limit N] [--since 1d|7h|YYYY-MM-DD] [--sort recent|visits]
```

关键词空格分词、多词 AND，匹配 title + url（可省略）；默认遍历所有已安装的 Chromium 系浏览器（Chrome、Edge），`--browser` 限定单一来源；`--since` / `--sort` 仅作用于历史；默认按最近访问倒序，`--sort visits` 按访问次数排序（适合"高频访问的网站"这类场景）。

### 程序化操作与 GUI 交互

浏览器内操作页面有两种方式：

- **程序化方式**（构造 URL 直接导航、eval 操作 DOM）：成功时速度快、精确，但对网站来说不是正常用户行为，可能触发反爬机制。
- **GUI 交互**（点击按钮、填写输入框、滚动浏览）：GUI 是为人设计的，网站不会限制正常的 UI 操作，确定性最高，但步骤多、速度慢。

根据对目标平台的了解来灵活选择方式。GUI 交互也是程序化方式的有效探测——通过一次真实交互观察站点的实际行为（URL 模式、必需参数、页面跳转逻辑），为后续程序化操作提供依据；同时当程序化方式受阻时，GUI 交互是可靠的兜底。

**站点内交互产生的链接是可靠的**：通过用户视角中的可交互单元（卡片、条目、按钮）进行的站点内交互，自然到达的 URL 天然携带平台所需的完整上下文。而手动构造的 URL 可能缺失隐式必要参数，导致被拦截、返回错误页面、甚至触发反爬。

## 浏览器 CDP 模式

通过 CDP Proxy 直连用户日常浏览器（Chrome / Edge / Chromium 等 Chromium 系），天然携带登录态，无需启动独立浏览器。
若无用户明确要求，不主动操作用户已有 tab，所有操作都在自己创建的后台 tab 中进行，保持对用户环境的最小侵入。不关闭用户 tab 的前提下，完成任务后关闭自己创建的 tab，保持环境整洁。

### 启动

```bash
node "${CLAUDE_SKILL_DIR}/scripts/check-deps.mjs"
```

脚本会依次检查 Node.js、浏览器调试端口，并确保 Proxy 已连接（未运行则自动启动并等待）。Proxy 启动后持续运行。

### 内置快捷脚本

skill 自带常用一键脚本（`scripts/` 下，Node 22+ 直接运行）：

| 脚本 | 用途 |
|------|------|
| `setup-chrome.mjs` | 准备工作区 Chrome for Testing（下载到本 skill 的 `chrome/` 专用文件夹）。**部署时先询问用户下载方式**：`--manual`（DSH 获取最新下载地址并打印，用户手动下载后把 zip 放入 `chrome/` 再重跑）或 `--auto`（DSH 全程自动下载，约 150MB）；交互终端无参数时会弹出选择菜单。若 `chrome/` 已有 `chrome.exe` 或 `chrome-win64.zip` 则直接复用/解压。 |
| `launch-chrome.mjs` | 用 `--remote-debugging-port=9222 --user-data-dir=<skill>/chrome-profile` 启动工作区 Chrome（独立配置，**不弹授权框**、与系统浏览器隔离）。**默认无头模式（`--headless=new`，不弹可见窗口）**；`--headed` 或 `config.env CHROME_HEADLESS=0` 显示窗口（登录站点/调试用）。Chrome 缺失时自动先跑 setup-chrome.mjs；check-deps 找不到浏览器时自动调用它。 |
| `bilibili-dynamics.mjs` | 打开 B 站「动态」取第一条视频动态：`node "${CLAUDE_SKILL_DIR}/scripts/bilibili-dynamics.mjs"`。自动开后台 tab → 打开 t.bilibili.com → 等动态加载 → 找第一条视频动态（标题/作者/链接/时长/时间）→ 关 tab，全程走 CDP Proxy。 |
| `bilibili-recommendations.mjs` | 一键获取 B 站主页推荐视频：`node "${CLAUDE_SKILL_DIR}/scripts/bilibili-recommendations.mjs" [--limit N]`。开后台 tab → 打开 www.bilibili.com → 等推荐卡片 → 遍历 `.bili-video-card` 提取（标题/作者/日期/链接）→ 关 tab。 |

按此模式可为其它站点编写一键脚本：开后台 tab → 定位目标 → 页面内同源 API / DOM 提取 → 核实 → 关 tab。脚本内 JS 表达式含中文时用 Unicode 转义（如 `\u7c89\u4e1d`），避免请求体编码损坏导致 `Runtime.evaluate` 报 "Uncaught"。

> **省 token 要点（后续调用务必遵守）**：① 重复性任务（B 站动态/推荐等）**直接运行内置脚本**，禁止手写 eval 反复调试；② 必须手写 eval 时，先写成 `.mjs` 文件用 `node --check` 校验语法再发送（能拦截 continue/break、括号错误等坑，一次到位）；③ 站点经验 `references/site-patterns/*.md` 已含验证过的选择器与表达式，先读再写，勿重复试错；④ 一次 eval 取全所需字段，减少往返。

**浏览器启动模式**：本 skill 用 `--remote-debugging-port=9222`（flag 模式）启动**工作区独立配置的 Chrome for Testing**（`chrome/` 二进制 + `chrome-profile/` 登录态，位置可由 `config.env` 的 `CHROME_DIR`/`CHROME_PROFILE_DIR` 覆盖）——不弹授权框、与系统浏览器隔离、运行产物全在工作区内（适配 DSH workspace-write）。为此 `config.env` 的 `WEB_ACCESS_BROWSER` 留空（走端口兜底探测 9222）。

> ⚠️ **启动 Chrome 需要一次 full access 授权**：DSH workspace-write 沙箱会拦截 Chrome 进程（即使带 `--no-sandbox`），需以 full access 运行 `launch-chrome.mjs` 或等效命令启动 Chrome。**启动后 Chrome 常驻（默认无头、无可见窗口），skill 后续操作仅走 localhost、无需再授权**（"一次授权"）。另需 `--no-sandbox --disable-gpu`（本机实测：缺省时 Chromium 沙箱/GPU 初始化失败，Chrome 数秒后自行退出）。首次使用需登录站点（如 B 站）：用 `--headed` 或桌面快捷方式「Chrome (DSH 工作区)」以可见窗口登录一次，之后无头模式复用登录态。

### 实战经验复盘

本机集成中实测验证的关键经验（详见 [`references/cdp-browser-modes.md`](references/cdp-browser-modes.md)）：

- **浏览器调试模式**：优先 flag 模式（`--remote-debugging-port=9222` + **工作区独立配置** `--user-data-dir`）。**Chromium 136+ 在默认配置下会忽略调试 flag**（安全机制），独立配置才生效且不弹授权框；需要登录的站点在独立配置里登录一次即可。`chrome://inspect` 开关模式每次会话连接都会弹授权框。
- **工作区 Chrome 启动**（CfT 实测）：启动 Chrome 需 `--no-sandbox --disable-gpu`（缺省时沙箱/GPU 初始化失败、数秒后自行退出）；DSH workspace-write 沙箱拦截 Chrome 进程，需**一次 full access 授权**启动，之后 Chrome 常驻、skill 操作仅走 localhost 无需再授权。
- **flag 模式连接**：不写 DevToolsActivePort → `WEB_ACCESS_BROWSER` 留空走端口兜底（9222）；代理兜底从 `/json/version` 取浏览器级 WS 路径（`/devtools/browser/<uuid>`）；删除默认配置残留的 DevToolsActivePort 避免误判。
- **切换浏览器/调试模式后重启代理**（清 pinnedBrowserId），否则报"浏览器不一致，不会自动切换"。
- **CDP eval 三坑**：① 表达式禁 `continue`/`break`（报 "Uncaught"，改用 `if(命中){...return...}`）；② 中文用 Unicode 转义防请求体编码损坏；③ SPA 导航后 eval 可能瞬时失败，等待用安全轮询、关键步骤加重试。
- **幂等脚本模式**：ensureProxy → `/new` 后台 tab → 轮询目标出现 → `/eval` 提取 → `/close`（finally 中执行）。

### Proxy API

所有操作通过 curl 调用 HTTP API：

```bash
# 列出用户已打开的 tab
curl -s http://localhost:3456/targets

# 创建新后台 tab（自动等待加载）— URL 走 POST body，避免目标 URL 含 query 时被切分
curl -s -X POST --data-raw 'https://example.com' http://localhost:3456/new

# 页面信息
curl -s "http://localhost:3456/info?target=ID"

# 执行任意 JS：可读写 DOM、提取数据、操控元素、触发状态变更、提交表单、调用内部方法
curl -s -X POST "http://localhost:3456/eval?target=ID" -d 'document.title'

# 捕获页面渲染状态（含视频当前帧）
curl -s "http://localhost:3456/screenshot?target=ID&file=/tmp/shot.png"

# 导航（URL 走 POST body，target 走 query）、后退
curl -s -X POST --data-raw 'https://example.com' "http://localhost:3456/navigate?target=ID"
curl -s "http://localhost:3456/back?target=ID"

# 点击（POST body 为 CSS 选择器）— JS el.click()，简单快速，覆盖大多数场景
curl -s -X POST "http://localhost:3456/click?target=ID" -d 'button.submit'

# 真实鼠标点击 — CDP Input.dispatchMouseEvent，算用户手势，能触发文件对话框
curl -s -X POST "http://localhost:3456/clickAt?target=ID" -d 'button.upload'

# 文件上传 — 直接设置 file input 的本地文件路径，绕过文件对话框
curl -s -X POST "http://localhost:3456/setFiles?target=ID" -d '{"selector":"input[type=file]","files":["/path/to/file.png"]}'

# 滚动（触发懒加载）
curl -s "http://localhost:3456/scroll?target=ID&y=3000"
curl -s "http://localhost:3456/scroll?target=ID&direction=bottom"

# 关闭 tab
curl -s "http://localhost:3456/close?target=ID"
```

### 页面内导航

两种方式打开页面内的链接：

- **`/click`**：在当前 tab 内直接点击用户视角中的可交互单元，简单直接，串行处理。适合需要在同一页面内连续操作的场景，如点击展开、翻页、进入详情等。
- **`/new` + 完整 URL**：使用目标链接的完整地址（包含所有URL参数），在新 tab 中打开。适合需要同时访问多个页面的场景。

很多网站的链接包含会话相关的参数（如 token），这些参数是正常访问所必需的。提取 URL 时应保留完整地址，不要裁剪或省略参数。URL 通过 POST body 原样传入 `/new` 或 `/navigate`。

> **v2.5.3 迁移提示**：若引用的站点经验文件（`references/site-patterns/*.md`）或其它脚本中仍含 `GET /new?url=...` 或 `/navigate?target=...&url=...` 的旧写法，调用会收到迁移指引。按 [`references/migration-2.5.3.md`](references/migration-2.5.3.md) 就地改写为 POST body 后再使用，并顺手把该站点经验文件更新掉。

### 媒体资源提取

判断内容在图片里时，用 `/eval` 从 DOM 直接拿图片 URL，再定向读取——比全页截图精准得多。

### 技术事实
- 页面中存在大量已加载但未展示的内容——轮播中非当前帧的图片、折叠区块的文字、懒加载占位元素等，它们存在于 DOM 中但对用户不可见。以数据结构（容器、属性、节点关系）为单位思考，可以直接触达这些内容。
- DOM 中存在选择器不可跨越的边界（Shadow DOM 的 `shadowRoot`、iframe 的 `contentDocument`等）。eval 递归遍历可一次穿透所有层级，返回带标签的结构化内容，适合快速了解未知页面的完整结构。
- `/scroll` 到底部会触发懒加载，使未进入视口的图片完成加载。提取图片 URL 前若未滚动，部分图片可能尚未加载。
- 拿到媒体资源 URL 后，公开资源可直接下载到本地后用读取；需要登录态才可获取的资源才需要在浏览器内 navigate + screenshot。
- 短时间内密集打开大量页面（如批量 `/new`）可能触发网站的反爬风控。
- 平台返回的"内容不存在""页面不见了"等提示不一定反映真实状态，也可能是访问方式的问题（如 URL 缺失必要参数、触发反爬）而非内容本身的问题。

### 视频内容获取

用户浏览器真实渲染，截图可捕获当前视频帧。核心能力：通过 `/eval` 操控 `<video>` 元素（获取时长、seek 到任意时间点、播放/暂停/全屏），配合 `/screenshot` 采帧，可对视频内容进行离散采样分析。

### 登录判断

用户日常浏览器天然携带登录态，大多数常用网站已登录。

登录判断的核心问题只有一个：**目标内容拿到了吗？**

打开页面后先尝试获取目标内容。只有当确认**目标内容无法获取**且判断登录能解决时，才告知用户：
> "当前页面在未登录状态下无法获取[具体内容]，请在你的浏览器中登录 [网站名]，完成后告诉我继续。"

登录完成后无需重启任何东西，直接刷新页面继续。

### 任务结束

用 `/close` 关闭自己创建的 tab，必须保留用户原有的 tab 不受影响。

Proxy 持续运行，不建议主动停止——重启后需要在浏览器中重新授权 CDP 连接。

## 并行调研：子 Agent 分治策略

任务包含多个**独立**调研目标时（如同时调研 N 个项目、N 个来源），鼓励合理分治给子 Agent 并行执行，而非主 Agent 串行处理。

**好处：**
- **速度**：多子 Agent 并行，总耗时约等于单个子任务时长
- **上下文保护**：抓取内容不进入主 Agent 上下文，主 Agent 只接收摘要，节省 token

**并行 CDP 操作**：每个子 Agent 在当前用户浏览器实例中，自行创建所需的后台 tab（`/new`），自行操作，任务结束自行关闭（`/close`）。所有子 Agent 共享一个浏览器、一个 Proxy，通过不同 targetId 操作不同 tab，无竞态风险。

**子 Agent Prompt 写法：目标导向，而非步骤指令**
- 必须在子 Agent prompt 中写 `必须加载 web-access skill 并遵循指引` ，子 Agent 会自动加载 skill，无需在 prompt 中复制 skill 内容或指定路径。
- 子 Agent 有自主判断能力。主 Agent 的职责是说清楚**要什么**，仅在必要与确信时限定**怎么做**。过度指定步骤会剥夺子 Agent 的判断空间，反而引入主 Agent 的假设错误。**避免 prompt 用词对子 Agent 行为的暗示**：「搜索xx」会把子 Agent 锚定到 WebSearch，而实际上有些反爬站点需要 CDP 直接访问主站才能有效获取内容。主 Agent 写 prompt 时应描述目标（「获取」「调研」「了解」），避免用暗示具体手段的动词（「搜索」「抓取」「爬取」）。

**分治判断标准：**

| 适合分治 | 不适合分治 |
|----------|-----------|
| 目标相互独立，结果互不依赖 | 目标有依赖关系，下一个需要上一个的结果 |
| 每个子任务量足够大（多页抓取、多轮搜索） | 简单单页查询，分治开销大于收益 |
| 需要 CDP 浏览器或长时间运行的任务 | 几次 WebSearch / Jina 就能完成的轻量查询 |

## 信息核实类任务

核实的目标是**一手来源**，而非更多的二手报道。多个媒体引用同一个错误会造成循环印证假象。

搜索引擎和聚合平台是信息发现入口，是**定位**信息的工具，不可用于直接**证明**真伪。找到来源后，直接访问读取原文。同一原则适用于工具能力/用法的调研——官方文档是一手来源，不确定时先查文档或源码，不猜测。

| 信息类型 | 一手来源 |
|----------|---------|
| 政策/法规 | 发布机构官网 |
| 企业公告 | 公司官方新闻页 |
| 学术声明 | 原始论文/机构官网 |
| 工具能力/用法 | 官方文档、源码 |

**找不到官网时**：权威媒体的原创报道（非转载）可作为次级依据，但需向用户说明："未找到官方原文，以下核实来自[媒体名]报道，存在转述误差可能。"单一来源时同样向用户声明。

## 站点经验

操作中积累的特定网站经验，按域名存储在 `references/site-patterns/` 下。

**自动采集（本 skill 已内置）**：CDP 代理在**首次访问新域名**（`/new` 打开页面）时，自动生成
`references/site-patterns/<host>.md` 草稿——含标题结构、URL 模式、页面结构（链接/视频/表单/图片数量）、
登录痕迹等**已验证事实**，并标注"自动采集 · 首次访问"。二次访问不覆盖。
Agent 操作完成后，只需在该文件补全「有效模式」「已知陷阱」（只写验证过的事实）。

确定目标网站后，如果前置检查输出的 site-patterns 列表中有匹配的站点，必须读取对应文件获取先验知识（平台特征、有效模式、已知陷阱）。经验内容标注了发现日期，当作可能有效的提示而非保证——如果按经验操作失败，回退通用模式并更新经验文件。

CDP 操作成功完成后，如果发现了有必要记录经验的新站点或新模式（URL 结构、平台特征、操作策略），主动写入对应的站点经验文件。只写经过验证的事实，不写未确认的猜测。

文件格式：
```markdown
---
domain: example.com
aliases: [示例, Example]
updated: 2026-03-19
---
## 平台特征
架构、反爬行为、登录需求、内容加载方式等事实

## 有效模式
已验证的 URL 模式、操作策略、选择器

## 已知陷阱
什么会失败以及为什么
```
经验/陷阱内容标注发现日期，当作"可能有效的提示"而非"保证正确的事实"。

## References 索引

| 文件 | 何时加载 |
|------|---------|
| `references/cdp-api.md` | 需要 CDP API 详细参考、JS 提取模式、错误处理时 |
| `references/cdp-browser-modes.md` | 遇到浏览器连接/调试模式问题、CDP eval 报 Uncaught、切换浏览器后代理异常时读取 |
| `references/site-patterns/{domain}.md` | 确定目标网站后，读取对应站点经验 |
| `references/site-patterns/bilibili.com.md` | 目标为 bilibili.com 时读取（主页推荐/动态选择器、提取表达式、编码与括号陷阱） |
| `scripts/bilibili-dynamics.mjs` | 用户要看 B 站动态第一条视频时，直接运行该脚本 |
| `scripts/bilibili-recommendations.mjs` | 用户要看 B 站主页推荐视频时，直接运行该脚本 |
| `scripts/launch-chrome.mjs` | 需要用浏览器打开页面（flag 模式、工作区独立配置、不弹授权框）时使用；check-deps 自动调用 |
| `scripts/setup-chrome.mjs` | Chrome 缺失时下载 Chrome for Testing 到工作区（launch-chrome 自动调用） |
