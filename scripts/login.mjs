#!/usr/bin/env node
// login.mjs <url> — 需要登录特定网站时：自动打开可见 Chrome 窗口并打开目标页
//
// 背景：技能默认无头模式（不弹窗口）；但登录站点必须由用户肉眼操作。
// 本脚本把 Chrome 切换为可见窗口（无头会自动重启为可见），打开目标页面，打印指引。
// 登录完成后：若想恢复无头，运行 `node scripts/launch-chrome.mjs --force`。
//
// 用法：node scripts/login.mjs https://www.bilibili.com

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROXY_SCRIPT = path.join(ROOT, 'scripts', 'cdp-proxy.mjs');
const LAUNCH_SCRIPT = path.join(ROOT, 'scripts', 'launch-chrome.mjs');
const PROXY_PORT = Number(process.env.CDP_PROXY_PORT || 3456);
const BASE = `http://127.0.0.1:${PROXY_PORT}`;

async function httpJson(method, pathname, body, timeoutMs = 60000) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    body: body !== undefined ? body : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

function runNode(script, args = [], inherit = false) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (code) => { if (!done) { done = true; resolve(code ?? 0); } };
    const child = spawn(process.execPath, [script, ...args], { stdio: inherit ? 'inherit' : 'ignore', windowsHide: true });
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish(1); }, 60000);
    child.on('exit', (code) => { clearTimeout(timer); finish(code); });
    child.on('error', () => { clearTimeout(timer); finish(1); });
  });
}

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
  console.error('proxy: 启动超时');
  process.exit(1);
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('用法：node scripts/login.mjs <url>');
    process.exit(1);
  }
  // 1) 确保 Chrome 为可见窗口（无头会自动重启为可见；需 full access 运行本脚本）
  console.log('chrome: 切换为可见窗口…');
  const code = await runNode(LAUNCH_SCRIPT, ['--headed'], true);
  if (code !== 0) {
    console.error('chrome: 未能切换到可见窗口（DSH 沙箱内请以 full access 运行本脚本）');
    process.exit(1);
  }
  // 2) 确保代理并在可见窗口打开目标页
  await ensureProxy();
  const tab = await httpJson('POST', '/new', url);
  if (!tab?.targetId) {
    console.error(`打开页面失败: ${JSON.stringify(tab)}`);
    process.exit(1);
  }
  console.log(`\n=== 请在可见的 Chrome 窗口中登录 ===`);
  console.log(`目标：${url}`);
  console.log(`已打开标签页；若未看到，请在 Chrome 窗口地址栏输入上面的网址。`);
  console.log(`登录完成后，告知 Agent 继续（无需重启任何东西）。\n`);
  console.log(`登录后如需恢复无头模式：node scripts/launch-chrome.mjs --force`);
}

main().catch((e) => {
  console.error('login 失败:', e.message);
  process.exit(1);
});
