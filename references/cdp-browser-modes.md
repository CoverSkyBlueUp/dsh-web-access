---
topic: cdp-browser-modes
updated: 2026-08-31
---

# CDP 浏览器调试模式 · 实战复盘

> 本文记录 web-access skill 集成过程中**实测验证**的事实与踩坑（Chromium 系：Chrome/Edge 通用），
> 用于快速定位浏览器连接问题。所有结论均来自本机实测（2026-08-31，Chrome/Edge 152/153），版本差异时以实测为准。

## 一、两种调试模式

### A. 交互式开关模式（chrome://inspect / edge://inspect）
- 开启方式：浏览器地址栏访问 `chrome://inspect/#remote-debugging`（或 Edge 的 `edge://inspect/#remote-debugging`），勾选 "Allow remote debugging for this browser instance"。
- 行为：写 `DevToolsActivePort` 文件到**默认配置目录**（Chrome：`%LOCALAPPDATA%\Google\Chrome\User Data\DevToolsActivePort`；Edge：`...\Microsoft\Edge\User Data\...`）。
  第一行=端口（本机为 9222），第二行=浏览器级 WS 路径（`/devtools/browser/<uuid>`）。
- **每次新会话，外部进程（CDP Proxy）连接时都会弹「是否允许远程调试」授权框**，需人工点【允许】；无法可靠地程序化豁免。
- 奇怪点（实测）：该模式下 `GET /json/version` 返回 **404 属正常**（HTTP 端点不可用），但浏览器级 WS 可用。
- 开关状态跨重启保留；浏览器重启后正常启动即可恢复调试服务并重写 DevToolsActivePort。

### B. 命令行 flag 模式（--remote-debugging-port=9222）
- 启动：`chrome.exe --remote-debugging-port=9222`。
- **Chromium 136+ 安全机制：在【默认配置】下会忽略该 flag**（防恶意网页用真实配置开调试偷 Cookie）。
  表现：进程参数带 flag、但端口完全不监听、也不写 DevToolsActivePort（实测 Edge 153 确认）。
- **必须配合独立配置才生效**：`--user-data-dir=<独立目录>`（本 skill 用工作区内 `<skill>/chrome-profile`）。
  独立配置登录态为空——需要登录的站点在该配置窗口里重新登录一次即可，登录态存于该目录（工作区内）。
- flag 模式**不写 DevToolsActivePort**；`GET /json/version` 正常返回（含 `webSocketDebuggerUrl`）。
- **不弹授权框**（flag 即显式同意）。

**结论（推荐）**：默认用 flag 模式 + 工作区独立配置（`scripts/launch-chrome.mjs`，Chrome 缺失时 `scripts/setup-chrome.mjs` 自动下载），
不弹框、与系统浏览器隔离、运行产物全在工作区内（适配 DSH workspace-write）；需要登录的站点在独立配置里登录一次。

## 二、flag 模式的连接要点

- skill 的浏览器发现（browser-discovery.mjs）默认读 DevToolsActivePort；flag 模式下读不到 →
  走 `findFallbackPort()`（探测 9222 / 9229 / 9333）。
- **浏览器级 WS 地址必须带 uuid 路径**：`ws://127.0.0.1:9222/devtools/browser/<uuid>`；
  裸 `/devtools/browser` 握手失败。`cdp-proxy.mjs` 的兜底分支已改为从 `/json/version` 的
  `webSocketDebuggerUrl` 提取该路径。
- `config.env` 的 `WEB_ACCESS_BROWSER` 在 flag 模式下**留空**：若设偏好（如 `edge`）而 detectAll 为空
  （无 DevToolsActivePort）→ 硬报错 "edge 未连接"。
- **默认配置残留的 DevToolsActivePort 文件**会让 detectAll 误判（读到旧文件+端口 9222 存活 →
  出现 "ambiguous 需询问用户"）。切换方案后删除该残留文件即可走干净的空→兜底路径。

## 三、代理注意事项

- cdp-proxy 长驻；**切换浏览器/调试模式后必须重启代理**（杀 3456 端口的进程或 `pkill -f cdp-proxy.mjs`），
  否则 `pinnedBrowserId` 会拒绝新浏览器（报"本次连接的浏览器是 X，不会自动切换"）。
- 代理自动关闭闲置 15 分钟的托管 tab（`/new` 创建的）；`GET /health` 可查连接状态与浏览器 id。

## 四、CDP Runtime.evaluate 通用陷阱（本机实测）

1. **表达式里不能用 `continue` / `break`** —— 报 `{"error":"Uncaught"}`（解析层怪癖）。
   对策：用 `if(命中){ ...return...; }` 的写法，不要 `if(不命中)continue;`。
2. **多余右括号**：`out.push({...});` 后多写一个 `}` 会让 IIFE 提前闭合、`return` 掉到函数外 → 报 "Uncaught"
   （本次实测的"组合表达式必挂"根因，与 CDP 无关）。对策：按嵌套层数数清楚闭合括号；
   复杂表达式先写成本地 `.mjs` 文件用 `node --check` 校验再发送（一票否决，避免反复调试）。
3. **非 ASCII（中文）进表达式**：请求体若非 UTF-8 传输会损坏 → 报 "Uncaught"。
   对策：JS 里用 Unicode 转义（如 `\u7c89\u4e1d`）或确保请求体 UTF-8。
4. **SPA 持续重渲染**：旧 DOM 引用/`closest()` 结果可能失效，eval 间歇报错。
   对策：直接遍历**已知稳定的卡片容器**（如 `.bili-video-card`）而非猜测祖先结构；
   等待场景用安全轮询（失败返回 null 继续等）、关键提取加重试（3 次、间隔 1.5s）。
3. **SPA 上下文切换 / 页面刚导航时** eval 可能瞬时失败（"Uncaught"）：
   等待轮询用安全版（失败返回 null 继续等），关键提取加重试（如 3 次、间隔 1.5s）。
4. 页面 `readyState=complete` ≠ 目标内容就绪：SPA 需要轮询目标选择器出现后再提取。

## 五、一键脚本模式（推荐模板）

```
ensureProxy（未运行则拉起 cdp-proxy.mjs）
→ /new 开后台 tab（URL 走 POST body）
→ 轮询目标元素出现（容错 eval，超时则报"未登录/页面异常"）
→ /eval 提取（单一 eval 一次拿全，减少往返）
→ （可选）/navigate 到详情页核实
→ /close 关闭自己创建的 tab（finally 中确保执行）
```

- 脚本要能独立运行：不依赖外部状态，失败给出可操作提示（如"请运行 node scripts/launch-chrome.mjs 打开浏览器"）。
- 平台接口限流（如 B 站 -799）→ 退避重试（如 3 次、4s/8s/12s），次要接口可降级（用 DOM 兜底）。

## 六、工作区 Chrome for Testing（DSH workspace-write 实测）

- CfT 官方定位：专为自动化/测试的 Chrome（无自动更新、版本化二进制），JSON API 端点见
  https://googlechromelabs.github.io/chrome-for-testing/ （`last-known-good-versions-with-downloads.json` 取最新 win64 下载）。
- **启动参数**：`--remote-debugging-port=9222 --user-data-dir=<独立配置> --no-sandbox --disable-gpu`。
  实测：缺 `--no-sandbox --disable-gpu` 时 Chromium 沙箱/GPU 初始化失败，Chrome 数秒后自行退出
  （无崩溃事件日志，属静默退出）；加上后稳定运行（约 10+ 进程，9222 正常服务）。
- **DSH workspace-write 沙箱会拦截 Chrome 进程**（即使带 --no-sandbox，crashpad OpenProcess/命名管道被拒）：
  启动 Chrome 需以 full access 运行一次（一次授权）。**启动后 Chrome 常驻，skill 脚本只连 localhost
  （代理 3456 / 调试 9222，沙箱放行回环），后续操作无需再授权**——这是"一次授权"的关键。
- Chrome 二进制/配置位置可用 `config.env` 的 `CHROME_DIR` / `CHROME_PROFILE_DIR` 覆盖（默认 `<skill>/chrome`、`<skill>/chrome-profile`），
  便于放在工作区专用文件夹、与 skill 其它文件分离。
- **DSH workspace-write 下，由 Agent 命令拉起的子进程（代理/浏览器）会在命令结束时被杀**（job 对象清树）：
  代理与 Chrome 都必须用 **full access 一次性启动**（或依赖登录时计划任务）才能常驻；常驻后 skill 脚本只连 localhost 无需再授权。
- **站点经验自动采集**：CDP 代理在 `/new` 首次访问新域名时自动生成 `references/site-patterns/<host>.md` 草稿
  （标题/URL 模式/页面结构/登录痕迹，均实测事实），二次访问不覆盖；Agent 操作后补全「有效模式」「已知陷阱」。
