#!/usr/bin/env node
// launch-chrome.mjs — 用远程调试模式启动工作区 Chrome（web-access skill 内置启动器）
//
// 背景（Chrome for Testing 官方文档 + 本机实测）：
//   - CfT 是 Google 专为自动化/测试提供的 Chrome（无自动更新、版本化二进制），
//     见 https://developer.chrome.com/blog/chrome-for-testing/
//   - Chromium 136+ 在默认配置下忽略 --remote-debugging-port，需独立配置 --user-data-dir
//   - 本机实测：需 `--no-sandbox --disable-gpu`，否则 Chromium 沙箱/GPU 初始化失败、数秒后自行退出
//   - flag 模式（命令行显式同意）不会再弹「允许远程调试」授权框
//   - DSH workspace-write 沙箱会拦截 Chrome 进程（即使 --no-sandbox）；故启动 Chrome 需要
//     一次 full access 授权，启动后 Chrome 常驻，skill 后续操作仅走 localhost、无需再授权。
//
// 运行模式（部署时由 setup-chrome.mjs 询问用户选择，写入 config.env 的 CHROME_HEADLESS）：
//   - 无头（默认）：`--headless=new`，不弹可见窗口，技能静默运行
//   - 可见：显示窗口，用于登录站点 / 调试 / 人工查看
// 参数：
//   --headed   强制使用可见窗口（当前为无头时自动重启为可见；登录站点时用）
//   --force    显式重启到目标模式（如登录完成后从可见切回无头）
//
// 行为：
//   - 已就绪且模式匹配 → 直接退出
//   - 已就绪但模式不匹配（--headed 且当前无头 / --force 切换）→ 重启到目标模式
//   - Chrome 缺失 → 提示先运行 setup-chrome.mjs（询问下载方式）
//   - 未就绪 → 启动（独立配置 + flag + no-sandbox/disable-gpu）并等待端口就绪
// 说明：模式写入 <profile>/.chrome-mode，供本脚本判断当前模式。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(ROOT, 'config.env');
const PORT = 9222;

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
const MARKER = path.join(PROFILE_DIR, '.chrome-mode');
// 目标模式：--headed 优先；否则读 config.env CHROME_HEADLESS（1/留空=无头，0=可见）
const HEADLESS = process.argv.includes('--headed') ? false : (CONFIG.CHROME_HEADLESS === '0' ? false : true);
const FORCE = process.argv.includes('--force');

function readMode() { try { return fs.readFileSync(MARKER, 'utf8').trim(); } catch { return null; } }
function writeMode(m) { try { fs.writeFileSync(MARKER, m, 'utf8'); } catch {} }
function modeLabel(m) { return m === 'headed' ? '可见窗口' : m === 'headless' ? '无头' : '未知'; }

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

function killChrome() {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    try {
      const c = spawn('taskkill', ['/F', '/IM', 'chrome.exe', '/T'], { stdio: 'ignore', windowsHide: true });
      c.on('exit', finish);
      c.on('error', finish);
    } catch { return finish(); }
    setTimeout(finish, 8000); // 兜底
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(exe, requested) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  console.log(`chrome: 启动（${exe}，独立配置 ${PROFILE_DIR}，端口 ${PORT}，${modeLabel(requested)}）…`);
  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',      // 本机实测必需：Chromium 沙箱初始化失败会导致数秒后自行退出
    '--disable-gpu',     // 同上；截图/视频功能走软件渲染，不受影响
  ];
  if (requested === 'headless') args.push('--headless=new'); // 无头模式：不弹窗口，完整支持 CDP/登录态
  spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false }).unref();
  for (let i = 1; i <= 20; i++) {
    await sleep(1000);
    if (await checkPort(PORT)) {
      writeMode(requested);
      console.log(`chrome: 就绪（端口 ${PORT}，${modeLabel(requested)}）`);
      return true;
    }
  }
  console.error(`chrome: 端口 ${PORT} 未就绪。确认无其它程序占用后重试：node scripts/launch-chrome.mjs`);
  return false;
}

async function main() {
  const requested = HEADLESS ? 'headless' : 'headed';
  let exe = findChromeExe();
  if (!exe) {
    console.error(
      'chrome: 未找到 Chrome for Testing。请先运行：node scripts/setup-chrome.mjs\n' +
      '  （部署时会询问下载方式与运行模式：--manual/--auto、--headless/--headed）'
    );
    process.exit(1);
  }

  if (await checkPort(PORT)) {
    const current = readMode();
    const needVisible = requested === 'headed' && current !== 'headed';       // 无头→可见（登录用）
    const needHeadless = requested === 'headless' && current === 'headed' && FORCE; // 可见→无头（显式）
    if (needVisible || needHeadless) {
      console.log(`chrome: 当前 ${modeLabel(current)}，切换为 ${modeLabel(requested)}…`);
      await killChrome();
      await sleep(2000);
      if (await launch(exe, requested)) return;
      process.exit(1);
    }
    console.log(`chrome: 已在调试模式（${modeLabel(current) || '未知'}，端口 ${PORT}）`);
    return;
  }

  if (!(await launch(exe, requested))) process.exit(1);
}

main().catch((e) => {
  console.error('launch-chrome 失败:', e.message);
  process.exit(1);
});
