#!/usr/bin/env node
// close-chrome.mjs — 用完自动关闭工作区 Chrome（带保护机制）
//
// 保护规则：
//   ① 其他 Agent 最近（5 分钟内）在使用 Chrome（代理记录了 X-Agent）→ 拒绝关闭，
//      提示由 Agent 告知用户后再决定；
//   ② Chrome 为可见窗口（用户可能正在使用/浏览）→ 拒绝关闭，除非 --force。
// 用法：
//   node scripts/close-chrome.mjs            正常关闭（带保护检测）
//   node scripts/close-chrome.mjs --force    强制关闭（跳过保护）
// 说明：代理同时内置「空闲自动关闭」——无请求超过 5 分钟且为无头模式时自动关闭 Chrome
//       （环境变量 CDP_CHROME_IDLE_MS 可调，如 60000=1 分钟）。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROXY_PORT = Number(process.env.CDP_PROXY_PORT || 3456);
const BASE = `http://127.0.0.1:${PROXY_PORT}`;
const MY_AGENT = process.env.DSH_AGENT_ID || 'local';
const RECENT_MS = parseInt(process.env.CHROME_INUSE_WINDOW_MS || '300000', 10); // 5 分钟

async function httpJson(method, pathname, timeoutMs = 4000) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: { 'X-Agent': MY_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return null; }
}

function readModeMarker() {
  try {
    const cfg = {};
    const content = fs.readFileSync(path.join(ROOT, 'config.env'), 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      if (k === 'CHROME_PROFILE_DIR') cfg.dir = t.slice(i + 1).trim();
    }
    const dir = cfg.dir || path.join(ROOT, 'chrome-profile');
    return fs.readFileSync(path.join(dir, '.chrome-mode'), 'utf8').trim();
  } catch { return null; }
}

function killChrome() {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    try {
      const c = spawn('taskkill', ['/F', '/IM', 'chrome.exe', '/T'], { stdio: 'ignore', windowsHide: true });
      c.on('exit', finish);
      c.on('error', finish);
    } catch { return finish(); }
    setTimeout(finish, 8000);
  });
}

async function main() {
  const force = process.argv.includes('--force');

  // 保护①：其他 Agent 最近在使用？
  let health = null;
  try { health = await httpJson('GET', '/health'); } catch {}
  if (health && health.connected) {
    const other = health.lastAgent && health.lastAgent !== MY_AGENT && (Date.now() - health.lastActivity < RECENT_MS);
    if (other && !force) {
      const secs = Math.round((Date.now() - health.lastActivity) / 1000);
      console.error(
        `chrome: 拒绝关闭 —— Chrome 正在被其他 Agent（${health.lastAgent}）使用（${secs}s 前有活动）。\n` +
        `  请将该情况告知用户；确认无并发使用后可用 --force 强制关闭。`
      );
      process.exit(3);
    }
  }

  // 保护②：可见窗口（用户可能在使用）？
  const mode = readModeMarker();
  if (mode === 'headed' && !force) {
    console.error(
      'chrome: 拒绝关闭 —— Chrome 当前为可见窗口（用户可能正在使用/浏览）。\n' +
      '  确认可关闭后加 --force。'
    );
    process.exit(2);
  }

  await killChrome();
  console.log(`chrome: 已关闭（${mode === 'headed' ? '可见窗口' : mode === 'headless' ? '无头' : '模式未知'}）`);
}

main().catch((e) => {
  console.error('close-chrome 失败:', e.message);
  process.exit(1);
});
