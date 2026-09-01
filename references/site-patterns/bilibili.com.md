---
domain: bilibili.com
aliases: [哔哩哔哩, B站, b站]
updated: 2026-09-01
---

## 平台特征
- 主页 `https://www.bilibili.com/` 与动态 `https://t.bilibili.com/` 均为 SPA；推荐/动态内容异步渲染，需等待目标卡片出现。
- 主页推荐卡片：`.bili-video-card`（每卡一条推荐），含 2 个视频链接（封面缩略图 + 标题链接），链接 `a[href*="/video/BV"]`。
- 卡片标题=标题链接文本（不含换行）；统计条文本（如「642.0万 6132 11:09」）含换行且更长，勿直接取最长文本。
- 作者 `.bili-video-card__info--author`；日期 `.bili-video-card__info--date`（如「· 08-27」）。
- 动态卡片：`.bili-dyn-list__item`；视频动态标题 `.bili-dyn-card-video__title`（老结构 `.bili-video-card__info--tit`）；时长 `.duration-time`；作者名可取其 `innerText` 首行兜底。
- 需登录态（动态流为本人关注列表）；主页推荐未登录也能拿到（个性化弱）。
- 通用 CDP 连接/eval 问题（调试模式、continue/break、括号陷阱、编码、代理重启）见 [`../cdp-browser-modes.md`](../cdp-browser-modes.md)。

## 有效模式
- **主页推荐**（首选直接跑脚本 `node scripts/bilibili-recommendations.mjs [--limit N]`，免手写 eval）：
  `/new https://www.bilibili.com` → 轮询 `.bili-video-card` 数量>0 → 遍历卡片：取 `a[href*="/video/BV"]` 首个链接的 href（去 query、统一 https、去重），标题=卡片内**不含换行**的最长链接文本 → `/close`。
- **动态第一条视频**（脚本 `node scripts/bilibili-dynamics.mjs`）：`/new https://t.bilibili.com` → 轮询 `.bili-dyn-list__item`>0 → 第一个含 `a[href*="/video/"]` 的卡片 → 标题/作者/时长/时间 → `/close`。
- 脚本内 JS 表达式含中文时用 Unicode 转义（如 `\u7c89\u4e1d`），避免请求体编码损坏报 "Uncaught"；纯 ASCII 无需处理。
- 复杂表达式先写成本地 `.mjs` 文件用 `node --check` 校验语法，再发送（能发现括号/语法错误，省调试轮次）。

## 已知陷阱
- **CDP `Runtime.evaluate` 表达式禁 `continue`/`break`**——报 "Uncaught"；用 `if(命中){...return...}` 写法。
- **多余右括号**：`return` 前的 `}` 多一个会让 IIFE 提前闭合、`return` 掉到函数外 → "Uncaught"（本次实测根因）。计数：`push` 后按嵌套层数闭合，再用 `node --check` 复核。
- SPA 持续重渲染会令旧 DOM 引用失效：优先**直接遍历已知卡片容器**（`.bili-video-card`/`.bili-dyn-list__item`），勿依赖 `closest()` 推测结构；eval 报错可重试（3 次、间隔 1.5s）。
- 页面刚加载卡片未渲染：先轮询目标选择器数量>0 再提取；长期为 0 多为未登录或风控。
- 推荐/动态流实时刷新，两次运行结果不同属正常。
