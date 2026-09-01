---
domain: bilibili.com
aliases: [哔哩哔哩, B站, b站]
updated: 2026-08-31
---

## 平台特征
- 登录后动态首页 `https://t.bilibili.com/` 为单页应用（SPA），动态列表逐条渲染在 `.bili-dyn-list__item` 卡片中，内容异步加载。
- 视频动态卡片（「投稿了视频」/含视频）内含一个指向视频的链接 `a[href*="/video/"]`（形如 `https://www.bilibili.com/video/BV...`），可用它判断「是否为视频动态」。
- 视频卡片标题元素：`.bili-dyn-card-video__title`（新结构），老结构 `.bili-video-card__info--tit`；视频时长在 `.duration-time`（如 `01:56`）。
- 作者名在 `.bili-dyn-item__author-name`（或 `.bili-dyn-item__author`）；时间在 `.bili-dyn-item__time`（如「7分钟前 · 投稿了视频」）。
- 需登录态：动态流为本人账号关注列表，CDP 直连用户日常浏览器即可拿到。
- 通用 CDP 连接/eval 问题（调试模式、continue/break、编码、代理重启）见 [`../cdp-browser-modes.md`](../cdp-browser-modes.md)。

## 有效模式
- 取动态第一条视频：`/new` 打开 `https://t.bilibili.com/` → 轮询 `.bili-dyn-list__item` 数量>0 → 遍历卡片取第一个含 `a[href*="/video/"]` 的卡片 → 提取 `.bili-dyn-card-video__title` 标题、作者、时长、时间 → `/close` 关 tab。
- 作者名可用卡片 `innerText` 的第一个非空行兜底（作者名通常排在卡片文本首行）。
- 脚本内 JS 表达式含中文时用 Unicode 转义（如 `\u7c89\u4e1d`），避免请求体编码损坏导致 `Runtime.evaluate` 报 "Uncaught"；纯 ASCII 选择器无需处理。

## 已知陷阱
- **CDP `Runtime.evaluate` 表达式中不能用 `continue`/`break`**——会报 "Uncaught"（Edge CDP 怪癖）。要用 `if(命中){...return...}` 的写法，而不是 `if(不命中)continue;`。
- 动态流是 SPA，卡片类名随版本变化；优先用 `body.innerText` + 关键词或 `a[href*="/video/"]` 定位，而非硬编码单一类名。
- 页面刚加载时卡片可能尚未渲染，需等待 `.bili-dyn-list__item` 出现后再取；若长期无卡片，多为未登录或风控拦截。
- 动态流实时刷新，同一脚本两次运行取到的「第一条视频」可能不同，属正常。
