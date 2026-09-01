# web-access · 专为 DeepSeek Harness 使用的联网 Skill

给 DeepSeek Harness（DSH）Agent 装上完整联网能力的 SKILL.md 技能：**搜索 / 网页抓取 / 登录后操作 / 浏览器自动化**。
核心是 **CDP Proxy 直连"工作区内独立配置的 Chrome"**，天然携带登录态、支持动态页面与交互操作。

> 基于 [eze-is/web-access](https://github.com/eze-is/web-access) 的 SKILL.md 体系（MIT），
> 针对 **DSH workspace-write 沙箱模式**做了工作区自包含改造：
> 浏览器、配置文件、运行产物全部位于工作区内，**不写系统目录、不弹授权**。

## ✨ 特性

| 能力 | 说明 |
|------|------|
| 联网工具自动选择 | WebSearch / WebFetch / curl / Jina / CDP，按场景自主判断 |
| **工作区 Chrome** | 自动下载 Chrome for Testing 到 `chrome/` 专用文件夹，独立配置 `chrome-profile/` 存登录态，与系统浏览器隔离 |
| CDP Proxy 浏览器操作 | 后台 tab 操作、点击/填表/滚动/截图/视频截帧，天然携带登录态 |
| 无授权弹窗 | flag 模式（`--remote-debugging-port=9222` + 独立配置）启动，Chromium 136+ 安全机制下默认配置会忽略调试 flag，独立配置才生效 |
| 站点经验积累 | 按域名存操作经验（`references/site-patterns/`），跨会话复用 |
| 一键脚本 | `bilibili-dynamics.mjs`（B 站动态第一条视频）等，按"开 tab → 提取 → 关 tab"模式可扩展 |
| 经验复盘 | `references/cdp-browser-modes.md`：调试模式对比、CDP eval 陷阱、排障步骤（实测沉淀） |

## 📦 安装

```bash
# 1) 把本 skill 目录放到 DSH 的技能根目录（或用 junction 指到工作区 .dsh/skills/web-access）
# 2) 准备 Chrome for Testing（约 150MB）——部署时会询问下载方式：
node scripts/setup-chrome.mjs --manual   # DSH 获取最新下载地址 → 你手动下载后放入 chrome/ 再重跑
node scripts/setup-chrome.mjs --auto     # DSH 全程自动下载
#    （交互终端直接运行则弹出菜单选择；若 chrome/ 已有 chrome.exe 或 zip 则直接复用）
```

**要求**：Node.js 22+（原生 fetch/WebSocket）。

## 🚀 使用

```bash
# 前置检查（工作区 Chrome 已运行时会直接连接）
node scripts/check-deps.mjs

# 启动工作区 Chrome（Chrome for Testing，独立配置；默认无头模式不弹窗口；未运行时需要）
node scripts/launch-chrome.mjs
#   --headed 显示可见窗口（登录站点/调试用）；config.env 可设 CHROME_HEADLESS=0

# 示例：B 站动态第一条视频
node scripts/bilibili-dynamics.mjs
```

首次使用需在 Chrome 窗口内登录需要的站点（如 B 站），登录态保存在工作区 `chrome-profile/`。

Agent 会话中直接下达联网任务即可（skill 自动接管）："帮我搜索 xxx"、"打开 B 站动态看第一条视频"…

> **DSH workspace-write 模式说明**：启动 Chrome 需要一次 full access 授权（沙箱会拦截 Chrome 进程；
> 启动参数含 `--no-sandbox --disable-gpu`，缺省时 Chromium 沙箱/GPU 初始化失败会自行退出）。
> **Chrome 启动后常驻，skill 后续操作只走 localhost、无需再授权**——即"一次授权"。

## 🔒 安全设计

- 全程使用工作区 Chrome + 独立配置，**不触碰系统默认浏览器**，不写系统目录
- flag 模式 = 命令行显式同意，**不再弹「是否允许远程调试」授权框**
- 运行产物（`chrome/`、`chrome-profile/`、日志、`config.env`）均被 `.gitignore` 排除，不进版本库
- 发布前有脱敏扫描；仓库不含任何密钥/机器专属路径

## 📁 目录结构

```
web-access/
├── SKILL.md                    # 技能说明（Agent 加载的主文档）
├── scripts/
│   ├── setup-chrome.mjs        # 下载 Chrome for Testing 到工作区
│   ├── launch-chrome.mjs       # flag 模式启动工作区 Chrome（独立配置）
│   ├── check-deps.mjs          # 前置检查 + 自动拉起浏览器/代理
│   ├── cdp-proxy.mjs           # CDP Proxy（HTTP API → 浏览器）
│   ├── browser-discovery.mjs   # 调试端口发现
│   ├── bilibili-dynamics.mjs   # 一键：B 站动态第一条视频
│   └── ...
├── references/
│   ├── cdp-api.md              # CDP API 参考
│   ├── cdp-browser-modes.md    # 调试模式实战复盘（坑与排障）
│   └── site-patterns/          # 站点经验（按域名）
└── templates/config.env.template
```

## License

MIT · 基于 [eze-is/web-access](https://github.com/eze-is/web-access)
