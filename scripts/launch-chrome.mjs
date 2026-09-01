#!/usr/bin/env node
// launch-chrome.mjs — 用远程调试模式启动工作区 Chrome（web-access skill 内置启动器）
//
// 背景（Chrome for Testing 官方文档 + 本机实测）：
//   - CfT 是 Google 专为自动化/测试提供的 Chrome（无自动更新、版本化二进制），
//     见 https://developer.chrome.com/blog/chrome-for-testing/
//   - Chromium 136+ 在默认配置下忽略 --remote-debugging-port，需独立配置 --user-data-dir
//   - 本机实测：需 `--no-sandbox --disable-gpu`，否则 Chromium 沙箱/GPU 初始化失败、数秒后自行退出
//     （与 DSH 沙箱/安全软件环境相关；CfT 用于自动化属官方预期用法）
//   - flag 模式（命令行显式同意）不会再弹「允许远程调试」授权框
//   - DSH workspace-write 沙箱会拦截 Chrome 进程（即使 --no-sandbox）；故启动 Chrome 需要
//     一次 full access 授权，启动后 Chrome 常驻，skill 后续操作仅走 localhost、无需再授权。
//
// 行为：
//   - 9222 已就绪 → 直接退出
//   - Chrome 缺失 → 提示先运行 setup-chrome.mjs（询问下载方式）
//   - 启动 Chrome（独立配置 + flag + no-sandbox/disable-gpu），等待端口就绪
//   - 未就绪 → 退出并给出提示（可重试；在 DSH 沙箱内需以 full access 运行本脚本）

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(ROOT, 'config.env');
const PORT = 9222;

// 读取 config.env —— CHROME_DIR / CHROME_PROFILE_DIR 可覆盖为工作区专用文件夹
function readConfig() {
  const cfg = {};
  let content;
  try { content = fs.readFileSync(CONFIG_PATH, 'utf8'); } catch { return cfg; }
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (k && v) cfg[k] = v;
  }
  return cfg;
}
const CONFIG = readConfig();
const CHROME_DIR = CONFIG.CHROME_DIR || path.join(ROOT, 'chrome');
const PROFILE_DIR = CONFIG.CHROME_PROFILE_DIR || path.join(ROOT, 'chrome-profile');
// 无头模式（默认）：不弹可见窗口运行技能；`--headed` 或 config.env CHROME_HEADLESS=0 时显示窗口（用于登录/调试）
const HEADLESS = process.argv.includes('--headed') ? false : (CONFIG.CHROME_HEADLESS === '0' ? false : true);

function findChromeExe() {
  if (!fs.existsSync(CHROME_DIR)) return null;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { const r = walk(p); if (r) return r; }
      else if (e.name === 'chrome.exe') return p;
    }
    return null;
  };
  return walk(CHROME_DIR);
}

function checkPort(port) {
  return new Promise((resolve) => {
    const s = net.createConnection(port, '127.0.0.1');
    const t = setTimeout(() => { s.destroy(); resolve(false); }, 1500);
    s.once('connect', () => { clearTimeout(t); s.destroy(); resolve(true); });
    s.once('error', () => { clearTimeout(t); resolve(false); });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (await checkPort(PORT)) {
    console.log(`chrome: 已在调试模式（端口 ${PORT}）`);
    return;
  }
  let exe = findChromeExe();
  if (!exe) {
    console.error(
      'chrome: 未找到 Chrome for Testing。请先运行：node scripts/setup-chrome.mjs\n' +
      '  （部署时会询问下载方式：--manual 由用户手动下载 / --auto DSH 全程自动下载；\n' +
      '    也可手动把 chrome-win64.zip 放入 chrome/ 目录后重跑 setup-chrome.mjs）'
    );
    process.exit(1);
  }
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  console.log(`chrome: 启动（${exe}，独立配置 ${PROFILE_DIR}，端口 ${PORT}${HEADLESS ? '，无头模式' : '，可见窗口'}）…`);
  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',      // 本机实测必需：Chromium 沙箱初始化失败会导致数秒后自行退出
    '--disable-gpu',     // 同上；截图/视频功能走软件渲染，不受影响
  ];
  if (HEADLESS) args.push('--headless=new'); // 无头模式：不弹窗口，完整支持 CDP/登录态
  spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false }).unref();
  for (let i = 1; i <= 20; i++) {
    await sleep(1000);
    if (await checkPort(PORT)) {
      console.log(`chrome: 就绪（端口 ${PORT}）`);
      return;
    }
  }
  console.error(`chrome: 端口 ${PORT} 未就绪。确认无其它程序占用后重试：node scripts/launch-chrome.mjs`);
  process.exit(1);
}

main().catch((e) => {
  console.error('launch-chrome 失败:', e.message);
  process.exit(1);
});
