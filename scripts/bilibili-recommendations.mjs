#!/usr/bin/env node
// bilibili-recommendations.mjs — 一键获取 B 站主页推荐视频（web-access skill 内置脚本）
//
// 用法：
//   node bilibili-recommendations.mjs            取前 10 条推荐
//   node bilibili-recommendations.mjs --limit 5  取 5 条
//
// 依赖：CDP Proxy（未运行自动拉起，端口 3456）、工作区 Chrome（flag 模式，见 launch-chrome.mjs）、
//       Node.js 22+。流程：开后台 tab → 打开 www.bilibili.com → 等推荐卡片渲染 →
//       遍历 .bili-video-card 提取（标题取卡片内不含换行的最长链接文本）→ 输出 → 关 tab。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROXY_SCRIPT = path.join(ROOT, 'scripts', 'cdp-proxy.mjs');
const PROXY_PORT = Number(process.env.CDP_PROXY_PORT || 3456);
const BASE = `http://127.0.0.1:${PROXY_PORT}`;
const HOME_URL = 'https://www.bilibili.com';

function parseArgs(argv) {
  const opts = { limit: 10 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit' && argv[i + 1]) { const n = parseInt(argv[i + 1]); if (n > 0) opts.limit = Math.min(n, 20); i++; }
  }
  return opts;
}

async function httpJson(method, pathname, body, timeoutMs = 60000) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    body: body !== undefined ? body : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function evalJs(targetId, expression) {
  const r = await httpJson('POST', `/eval?target=${encodeURIComponent(targetId)}`, expression);
  if (r && r.error !== undefined) throw new Error(`页面执行 JS 失败: ${r.error}`);
  return r.value;
}

// 容错版：页面未就绪/上下文切换导致 eval 报错时返回 null（等待场景用）
async function evalJsSafe(targetId, expression) {
  try { return await evalJs(targetId, expression); } catch { return null; }
}

// --- 确保 CDP Proxy 就绪 ---
async function ensureProxy() {
  const health = await httpJson('GET', '/health', undefined, 3000).catch(() => null);
  if (health && health.status === 'ok') return;
  console.log('proxy: 未运行，正在启动…');
  const logFile = path.join(os.tmpdir(), 'cdp-proxy.log');
  const logFd = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, [PROXY_SCRIPT], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    ...(os.platform() === 'win32' ? { windowsHide: true } : {}),
  });
  child.unref();
  fs.closeSync(logFd);
  for (let i = 1; i <= 20; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const h = await httpJson('GET', '/health', undefined, 3000).catch(() => null);
    if (h && h.status === 'ok') { console.log('proxy: ready'); return; }
  }
  console.error(`proxy: 启动超时，日志：${logFile}`);
  process.exit(1);
}

// --- 提取主页推荐 ---
// 经验要点：① 直接遍历 .bili-video-card 卡片（SPA 结构稳定），勿用 closest 推测；
//           ② 标题取卡片内「不含换行」的最长链接文本（统计条/稍后再看浮层含 \n 或为短文本）；
//           ③ 表达式禁用 continue/break；④ 括号必须配对（多余右括号会让 return 掉出 IIFE 报 Uncaught）。
async function extractRecommendations(targetId, limit) {
  const expr = `(()=>{const seen=new Set();const out=[];for(const card of document.querySelectorAll('.bili-video-card')){const link=card.querySelector('a[href*="/video/BV"]');if(link){const href=link.href.split('?')[0].replace('http://','https://');if(!seen.has(href)&&out.length<${limit}){seen.add(href);let best='';for(const la of card.querySelectorAll('a[href*="/video/BV"]')){const t=(la.innerText||'').trim();if(t.length>best.length&&!t.includes('\\n')){best=t;}}const authorEl=card.querySelector('.bili-video-card__info--author');const author=authorEl?authorEl.innerText.trim().slice(0,40):null;const dateEl=card.querySelector('.bili-video-card__info--date');const date=dateEl?dateEl.innerText.trim().slice(0,30):null;out.push({title:(best||null),author,date,href});}}}return JSON.stringify(out);})()`;
  let parsed = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      parsed = JSON.parse(await evalJs(targetId, expr));
      break;
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return parsed;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await ensureProxy();

  console.log('bilibili: 打开主页（后台 tab）…');
  const tab = await httpJson('POST', '/new', HOME_URL);
  if (!tab?.targetId) throw new Error(`打开主页失败: ${JSON.stringify(tab)}`);
  const targetId = tab.targetId;

  try {
    // 等推荐卡片出现（未登录/页面异常时超时）
    await new Promise((r) => setTimeout(r, 3000)); // 初始等待，避免上下文未就绪
    let ready = false;
    for (let i = 0; i < 20; i++) {
      const raw = await evalJsSafe(targetId, `document.querySelectorAll('.bili-video-card').length`);
      const count = Number(raw);
      if (count > 0) { ready = true; break; }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!ready) throw new Error('主页推荐未能加载（可能未登录或页面异常）');

    const items = await extractRecommendations(targetId, opts.limit);
    if (!Array.isArray(items) || items.length === 0) throw new Error('主页未提取到推荐视频');

    console.log(`\n==== B 站主页推荐视频（${items.length} 条） ====`);
    items.forEach((v, i) => {
      console.log(`${i + 1}. ${v.title ?? '（标题提取失败）'}`);
      console.log(`   作者：${v.author ?? '未知'}${v.date ? ' | ' + v.date : ''}`);
      console.log(`   链接：${v.href}`);
    });
    console.log('====================================');
    console.log('JSON:', JSON.stringify(items));
  } finally {
    await httpJson('GET', `/close?target=${encodeURIComponent(targetId)}`, undefined, 10000).catch(() => {});
  }
}

main().catch((e) => {
  console.error('bilibili-recommendations 失败:', e.message);
  process.exit(1);
});
