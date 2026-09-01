#!/usr/bin/env node
// setup-chrome.mjs — 部署：准备工作区 Chrome for Testing + 选择浏览器运行模式（web-access skill 内置）
//
// 部署时两个选择（由用户/Agent 决定）：
//   下载方式：--manual（DSH 提供最新地址，用户手动下载）/ --auto（DSH 全程自动下载）
//   运行模式：--headless（无头，不弹窗口，默认推荐）/ --headed（可见窗口，登录/调试用）
// 无参数交互终端会依次弹出选择菜单；非交互环境（Agent 调用）请显式传参。
//
// 其它：若 <skill>/chrome/ 下已存在 chrome.exe（或 chrome-win64.zip），直接复用/解压，不联网。

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(ROOT, 'config.env');
const JSON_URL = 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json';

// 读取 config.env（KEY=VALUE，# 注释）——CHROME_DIR 可覆盖为工作区专用文件夹
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
const ZIP_PATH = path.join(CHROME_DIR, 'chrome-win64.zip');

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

async function fetchLatestWin64() {
  const j = await (await fetch(JSON_URL, { signal: AbortSignal.timeout(60000) })).json();
  const d = j.channels.Stable.downloads.chrome.find((x) => x.platform === 'win64');
  return { version: j.channels.Stable.version, url: d.url, size: d.size };
}

function extractZip() {
  console.log(`chrome: 解压 ${ZIP_PATH} …`);
  execFileSync('tar', ['-xf', ZIP_PATH, '-C', CHROME_DIR], { stdio: 'ignore' });
  fs.unlinkSync(ZIP_PATH);
  const exe = findChromeExe();
  if (!exe) throw new Error('解压后未找到 chrome.exe');
  console.log(`chrome: 就绪（${exe}）`);
  return exe;
}

async function manualMode() {
  console.log('chrome: 获取最新 Chrome for Testing 下载地址…');
  const info = await fetchLatestWin64();
  console.log(`\n=== 请手动下载 Chrome for Testing (win64) ===`);
  console.log(`版本：${info.version}（约 ${Math.round(info.size / 1048576)} MB）`);
  console.log(`下载地址：\n${info.url}`);
  console.log(`\n下载完成后，把 zip 文件放到：\n${ZIP_PATH}`);
  console.log(`（文件名必须为 chrome-win64.zip）`);
  console.log(`然后重新运行：node scripts/setup-chrome.mjs 完成解压。\n`);
}

async function autoMode() {
  const info = await fetchLatestWin64();
  console.log(`chrome: 自动下载 ${info.version}（约 ${Math.round(info.size / 1048576)} MB）…`);
  fs.mkdirSync(CHROME_DIR, { recursive: true });
  const resp = await fetch(info.url, { signal: AbortSignal.timeout(900000) });
  if (!resp.ok) throw new Error(`下载失败 HTTP ${resp.status}`);
  fs.writeFileSync(ZIP_PATH, Buffer.from(await resp.arrayBuffer()));
  extractZip();
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

// 更新/新增 config.env 的单个键（保留其它行）
function setConfig(key, value) {
  let content = '';
  try { content = fs.readFileSync(CONFIG_PATH, 'utf8'); } catch {}
  const re = new RegExp(`^${key}=`);
  let found = false;
  const out = content.split(/\r?\n/).map((l) => {
    if (re.test(l.trim())) { found = true; return `${key}=${value}`; }
    return l;
  });
  if (!found) out.push(`${key}=${value}`);
  fs.writeFileSync(CONFIG_PATH, out.join('\n') + '\n', 'utf8');
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--manual') ? 'manual' : args.includes('--auto') ? 'auto' : null;

  // --- 部署时选择浏览器运行模式（无头 vs 可见窗口） ---
  let headless = args.includes('--headless') ? true : args.includes('--headed') ? false : null;
  if (headless === null) {
    if (process.stdin.isTTY) {
      const m = await ask(
        '浏览器运行模式：\n  1) 无头（不弹窗口，技能静默运行，推荐）\n  2) 可见窗口（登录站点/调试用）\n请输入 1 或 2（默认 1）：'
      );
      headless = m !== '2';
    } else {
      console.error(
        '请指定浏览器运行模式：--headless（无头，不弹窗口）或 --headed（可见窗口）\n' +
        '  完整用法：node scripts/setup-chrome.mjs [--manual|--auto] [--headless|--headed]'
      );
      process.exit(2);
    }
  }
  setConfig('CHROME_HEADLESS', headless ? '1' : '0');
  console.log(`chrome: 运行模式已设置 → ${headless ? '无头（不弹窗口）' : '可见窗口'}`);

  // 已安装 → 直接结束
  if (findChromeExe()) {
    console.log(`chrome: 已存在（${findChromeExe()}）`);
    return;
  }
  // 用户手动放置的 zip → 直接解压（不联网）
  if (fs.existsSync(ZIP_PATH)) {
    console.log('chrome: 检测到手动放置的 chrome-win64.zip，开始解压…');
    extractZip();
    return;
  }
  // 需要下载：先确定方式
  let chosen = mode;
  if (!chosen) {
    if (process.stdin.isTTY) {
      const a = await ask(
        '未找到 Chrome for Testing。选择下载方式：\n  1) 手动下载（DSH 提供最新下载地址，你自行下载）\n  2) DSH 全程自动下载\n请输入 1 或 2（默认 2）：'
      );
      chosen = a === '1' ? 'manual' : 'auto';
    } else {
      console.error(
        'chrome: 未找到 Chrome for Testing。请先向用户询问后，显式指定下载方式与运行模式：\n' +
        '  node scripts/setup-chrome.mjs --manual --headless   （DSH 提供地址，用户手动下载；无头模式）\n' +
        '  node scripts/setup-chrome.mjs --auto --headed       （DSH 全程自动下载；可见窗口）\n' +
        '  运行模式：--headless 无头（不弹窗口）/ --headed 可见窗口（登录用）'
      );
      process.exit(2);
    }
  }
  if (chosen === 'manual') await manualMode();
  else await autoMode();
}

main().catch((e) => {
  console.error('setup-chrome 失败:', e.message);
  process.exit(1);
});
