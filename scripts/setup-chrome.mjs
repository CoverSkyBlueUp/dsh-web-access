#!/usr/bin/env node
// setup-chrome.mjs — 准备工作区 Chrome for Testing（web-access skill 内置）
//
// 部署时两种方式（由用户/Agent 选择）：
//   1) --manual  「DSH 获取最新下载地址 → 你手动下载」：脚本联网获取最新 Chrome for Testing
//                 的 win64 下载地址并打印；你自行下载（如用浏览器），把 zip 存为
//                 <skill>/chrome/chrome-win64.zip，然后重新运行本脚本完成解压。
//   2) --auto     「全程交给 DSH 下载」：脚本自动下载（约 150MB）并解压。
// 无参数时：交互式终端会弹出选择菜单；非交互环境（Agent 调用）请显式传 --auto / --manual。
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

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--manual') ? 'manual' : args.includes('--auto') ? 'auto' : null;

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
        'chrome: 未找到 Chrome for Testing。请先向用户询问下载方式后，显式指定：\n' +
        '  node scripts/setup-chrome.mjs --manual   （DSH 获取最新地址，用户手动下载）\n' +
        '  node scripts/setup-chrome.mjs --auto     （DSH 全程自动下载）'
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
