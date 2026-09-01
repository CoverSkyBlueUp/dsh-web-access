#!/usr/bin/env node
// bilibili-dynamics.mjs — 打开 B 站「动态」，取第一条视频动态（web-access skill 内置脚本）
//
// 用法：
//   node bilibili-dynamics.mjs               打开动态首页，输出第一条视频动态（标题/作者/链接/时长/时间）
//
// 依赖：web-access skill 的 CDP Proxy（未运行会自动拉起，端口 3456），
//       Node.js 22+（原生 fetch/WebSocket），Edge/Chrome 已开启远程调试且已登录 B 站。
// 流程：开后台 tab → 打开 t.bilibili.com → 等动态加载 → 找第一条视频动态 → 输出 → 关 tab。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROXY_SCRIPT = path.join(ROOT, 'scripts', 'cdp-proxy.mjs');
const PROXY_PORT = Number(process.env.CDP_PROXY_PORT || 3456);
const BASE = `http://127.0.0.1:${PROXY_PORT}`;
const FEED_URL = 'https://t.bilibili.com/';
// 使用方标识：多 Agent 并发时由代理记录，供 close-chrome 判断"是否被其他 Agent 使用"
const AGENT_ID = process.env.DSH_AGENT_ID || 'local';

async function httpJson(method, pathname, body, timeoutMs = 60000) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: { 'X-Agent': AGENT_ID },
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

// --- 找第一条视频动态 ---
// 注意：表达式中不能用 `continue`/`break`（CDP Runtime.evaluate 会报 "Uncaught"），
// 统一用 `if(命中){...return...}` 的写法。
async function findFirstVideo(targetId) {
  const expr = `(()=>{const items=[...document.querySelectorAll('.bili-dyn-list__item')];let idx=0;for(const it of items){idx++;const vlink=it.querySelector('a[href*="/video/"]');if(vlink){const titleEl=it.querySelector('.bili-dyn-card-video__title, .bili-video-card__info--tit, .bili-dyn-content__desc');const title=titleEl?(titleEl.innerText||'').trim().slice(0,160):((vlink.innerText||vlink.title||'').trim().slice(0,160));const author=(it.querySelector('.bili-dyn-item__author-name, .bili-dyn-item__author')||{}).innerText?.trim().slice(0,60)||(it.innerText||'').split('\\n').map(s=>s.trim()).filter(Boolean)[0]||null;const time=(it.querySelector('.bili-dyn-item__time, .bili-dyn-time')||{}).innerText?.trim().slice(0,60)||null;const dur=(it.querySelector('.duration-time')||{}).innerText?.trim()||null;return JSON.stringify({found:true,itemNo:idx,total:items.length,title,author,href:vlink.href,duration:dur,time});}}return JSON.stringify({found:false,total:items.length})})()`;
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
  await ensureProxy();

  console.log('bilibili: 打开动态页（后台 tab）…');
  const tab = await httpJson('POST', '/new', FEED_URL);
  if (!tab?.targetId) throw new Error(`打开动态失败: ${JSON.stringify(tab)}`);
  const targetId = tab.targetId;

  try {
    // 等动态卡片出现（未登录/页面异常时超时）
    await new Promise((r) => setTimeout(r, 2000)); // 初始等待，避免上下文未就绪
    let ready = false;
    for (let i = 0; i < 20; i++) {
      const raw = await evalJsSafe(targetId, `document.querySelectorAll('.bili-dyn-list__item').length`);
      const count = Number(raw);
      if (count > 0) { ready = true; break; }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!ready) throw new Error('动态页未能加载动态列表（可能未登录或页面异常）');

    const v = await findFirstVideo(targetId);
    if (!v.found) throw new Error('动态页中未找到视频动态');

    console.log('\n==== B 站动态 · 第一条视频 ====');
    console.log(`标题：${v.title}`);
    console.log(`作者：${v.author ?? '未知'}`);
    console.log(`链接：${v.href}`);
    if (v.duration) console.log(`时长：${v.duration}`);
    if (v.time) console.log(`时间：${v.time}`);
    console.log('===============================');
    console.log('JSON:', JSON.stringify(v));
  } finally {
    await httpJson('GET', `/close?target=${encodeURIComponent(targetId)}`, undefined, 10000).catch(() => {});
  }
}

main().catch((e) => {
  console.error('bilibili-dynamics 失败:', e.message);
  process.exit(1);
});
