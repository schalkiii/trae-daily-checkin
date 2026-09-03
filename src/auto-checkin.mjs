// src/auto-checkin.mjs
// 通过 Chrome DevTools Protocol (CDP) 自动完成 Trae SOLO CN 每日签到。
// 零第三方依赖：Node >= 18 自带的 fetch / WebSocket。

import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.dirname(__dirname); // project root (parent of src/)

// -------------------------------------------------------------
// 0. 解析命令行参数（优先）与环境变量（回退）
//    用法：
//      node src/auto-checkin.mjs
//      node src/auto-checkin.mjs --port 9223 --force
//      node src/auto-checkin.mjs --dir "C:\Program Files\TRAE SOLO CN\TRAE SOLO CN.exe" --port 9223 --profile "%TEMP%\trae-test-profile"
//    参数：
//      --exe / --dir <path>   Trae 可执行文件路径（不传则自动扫描定位）
//      --port <n>             CDP 调试端口（默认 9222）
//      --force                已运行但无调试端口时强制重启 Trae（也可 --force 1）
//      --profile <path>       使用独立 user-data-dir（profile）启动，隔离测试用
//      --close                签到完成后关闭 Trae 进程
//      --feishu <url>         签到结果推送飞书群机器人 webhook（也可用环境变量）
//      -h, --help             显示帮助
// -------------------------------------------------------------
function loadConfig() {
  // config.json lives at project root; TRAECHECKIN_CONFIG overrides the path.
  // Precedence (highest first): CLI arg > env var > config.json > built-in default.
  const p = process.env.TRAECHECKIN_CONFIG || path.join(ROOT, 'config.json');
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function parseOptions() {
  const cfg = loadConfig();
  const argv = process.argv.slice(2);
  const argValue = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  return {
    help: argv.includes('--help') || argv.includes('-h'),
    exe: argValue('exe') || argValue('dir') || process.env.TRAECHECKIN_EXE?.trim() || cfg.traeExe || '',
    port: Number(argValue('port') || process.env.TRAECHECKIN_PORT || cfg.port || 9222),
    force: argv.includes('--force') || argValue('force') === '1' || process.env.TRAECHECKIN_FORCE_RELAUNCH === '1' || !!cfg.forceRelaunch,
    profile: argValue('profile') || argValue('user-data-dir') || process.env.TRAECHECKIN_USER_DATA_DIR?.trim() || cfg.userDataDir || '',
    close: argv.includes('--close') || argValue('close') === '1' || process.env.TRAECHECKIN_CLOSE === '1' || !!cfg.closeAfter,
    feishu: argValue('feishu') || argValue('feishu-webhook') || process.env.TRAECHECKIN_FEISHU_WEBHOOK?.trim() || cfg.feishuWebhook || '',
    noPush: argv.includes('--no-push') || process.env.TRAECHECKIN_NO_PUSH === '1' || !!cfg.noPush,
  };
}

const OPTS = parseOptions();

if (OPTS.help) {
  console.log(`用法：
  node src/auto-checkin.mjs [选项]

选项：
  --exe / --dir <path>   Trae 可执行文件路径（不传则自动扫描定位）
  --port <n>             CDP 调试端口（默认 9222）
  --force                已运行但无调试端口时强制重启 Trae（也可 --force 1）
  --profile <path>       使用独立 user-data-dir（profile）启动，隔离测试用
  --close                签到完成后关闭 Trae 进程
  --feishu <url>         签到结果推送飞书群机器人 webhook（也可: 环境变量 TRAECHECKIN_FEISHU_WEBHOOK / config.json feishuWebhook）
  --no-push              只签到、不推送飞书（测试用）
  -h, --help             显示帮助

示例：
  node src/auto-checkin.mjs
  node src/auto-checkin.mjs --port 9223 --force
  node src/auto-checkin.mjs --dir "C:\\Program Files\\TRAE SOLO CN\\TRAE SOLO CN.exe" --port 9223 --profile "C:\\Windows\\Temp\\trae-test-profile"
  node src/auto-checkin.mjs --port 9223 --force --close
  node src/auto-checkin.mjs --feishu "https://open.feishu.cn/open-apis/bot/v2/hook/xxxx"

优先级说明：命令行参数 > 环境变量 > config.json > 自动扫描定位。
`);
  process.exit(0);
}

const DEBUG_PORT = OPTS.port;
const FORCE_RELAUNCH = OPTS.force;
const USER_DATA_DIR = OPTS.profile;
const CLI_EXE = OPTS.exe;
const CLOSE_AFTER_CHECKIN = OPTS.close;

// 启动调试端口时追加的参数（独立 profile 用）
function debugLaunchArgs() {
  const args = [`--remote-debugging-port=${DEBUG_PORT}`];
  if (USER_DATA_DIR) args.push(`--user-data-dir="${USER_DATA_DIR}"`);
  return args.join(' ');
}

// -------------------------------------------------------------
// 0. 解析 Trae 可执行文件路径
//    优先级：环境变量 TRAECHECKIN_EXE > 正在运行的进程 > 注册表 > 常见安装位置
// -------------------------------------------------------------
const COMMON_INSTALL_DIRS = [
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'D:\\Program Files',
  'D:\\Software',
  'E:\\Software',
  'D:\\',
  'C:\\Users\\',
];

function looksLikeTraeExe(p) {
  if (!p || typeof p !== 'string') return false;
  const name = path.basename(p).toLowerCase();
  const dir = p.toLowerCase();
  return /trae.*\.exe$/.test(name) && !dir.includes('agent-tool-host');
}

async function runPs(script) {
  return new Promise((resolve) => {
    // 不加 shell：直接以参数数组启动 powershell.exe，避免 cmd 解析特殊字符 & DEP0190 警告
    const p = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
    let out = '';
    p.stdout.on('data', d => out += d.toString());
    p.on('close', () => resolve(out.trim()));
    p.on('error', () => resolve(''));
  });
}

// 1) 正在运行的 Trae 进程，拿它的真实可执行路径
async function scanRunningProcess() {
  const out = await runPs(
    `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath } | Select-Object -ExpandProperty ExecutablePath -Unique`
  );
  for (const line of out.split(/\r?\n/)) {
    const p = line.trim();
    if (looksLikeTraeExe(p) && fs.existsSync(p)) {
      console.log(`[INFO] 从正在运行的进程定位到 Trae: ${p}`);
      return p;
    }
  }
  return null;
}

// 2) 从注册表卸载项里找 Trae 的 InstallLocation
async function scanRegistry() {
  const out = await runPs(`
    $roots = @(
      'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
    )
    $hits = foreach ($r in $roots) {
      if (Test-Path $r) {
        Get-ChildItem $r | ForEach-Object {
          $v = (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue)
          if ($v.DisplayName -like '*Trae*') { $v.InstallLocation }
        }
      }
    }
    $hits | Where-Object { $_ } | Sort-Object -Unique
  `);
  for (const line of out.split(/\r?\n/)) {
    const dir = line.trim();
    if (!dir) continue;
    for (const name of ['TRAE SOLO CN.exe', 'Trae.exe', 'TRAE.exe']) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) {
        console.log(`[INFO] 从注册表定位到 Trae: ${candidate}`);
        return candidate;
      }
    }
  }
  return null;
}

// 3) 常见安装目录下做有限深度的文件扫描（避免全盘遍历太慢）
function scanCommonDirs(maxDepth = 3) {
  const hit = [];
  const walk = (dir, depth) => {
    if (hit.length || depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.toLowerCase().includes('trae')) {
          // 命中 Trae 安装目录，直接找 exe
          for (const n of ['TRAE SOLO CN.exe', 'Trae.exe', 'TRAE.exe']) {
            const exe = path.join(full, n);
            if (fs.existsSync(exe)) { hit.push(exe); return; }
          }
        }
        walk(full, depth + 1);
      } else if (e.name.toLowerCase().endsWith('.exe') && looksLikeTraeExe(full)) {
        hit.push(full); return;
      }
    }
  };
  for (const base of COMMON_INSTALL_DIRS) {
    const root = base.replace('C:\\Users\\', process.env.USERPROFILE + '\\');
    if (!fs.existsSync(root)) continue;
    walk(root, 0);
    if (hit.length) break;
  }
  if (hit.length) {
    console.log(`[INFO] 自动扫描到 Trae: ${hit[0]}`);
    return hit[0];
  }
  return null;
}

async function resolveTraePath() {
  if (CLI_EXE) {
    if (!fs.existsSync(CLI_EXE)) {
      throw new Error(`--exe/--dir 指定的路径不存在：${CLI_EXE}`);
    }
    console.log(`[INFO] 使用命令行指定的 Trae 路径: ${CLI_EXE}`);
    return CLI_EXE;
  }

  const found =
    (await scanRunningProcess()) ||
    (await scanRegistry()) ||
    scanCommonDirs();

  if (found) return found;

  throw new Error(
    '未找到 Trae SOLO CN 可执行文件。\n' +
    '请通过命令行参数指定：\n' +
    '  node src/auto-checkin.mjs --dir "你的\\TRAE SOLO CN\\TRAE SOLO CN.exe"\n' +
    '脚本会依次尝试：正在运行的进程 -> 注册表卸载项 -> 常见安装目录。'
  );
}

const TRAE_EXE = await resolveTraePath();

// 强制使用 127.0.0.1（IPv4）：避免 localhost 优先解析到 IPv6，导致连到其它也监听 9222 的应用（如豆包）
const DEBUG_URL = `http://127.0.0.1:${DEBUG_PORT}`;
const WS_URL = `${DEBUG_URL}/json`;

// -------------------------------------------------------------
// 1. 确保 Trae 已启动且调试端口可用
// -------------------------------------------------------------
async function ensureDebugPort() {
  // 1.1 端口已开，直接返回
  if (await isPortOpen()) {
    console.log('[OK] 调试端口已开放');
    return;
  }

  const running = await isTraeRunning();

  // 1.2 没有运行，直接启动并带调试端口
  if (!running) {
    console.log('[INFO] Trae 未运行，正在启动并开放调试端口...');
    launchTraeWithDebug();
    await waitForPort(30_000);
    return;
  }

  // 1.3 正在运行但没有调试端口：默认安全退出，可选强制重启
  if (running) {
    if (FORCE_RELAUNCH) {
      console.log('[WARN] 强制重启 Trae 以开放调试端口（可能丢失未保存内容）...');
      await closeTrae();
      launchTraeWithDebug();
      await waitForPort(30_000);
      return;
    }
    throw new Error(
      `Trae 正在运行，但未开启调试端口。\n` +
      `请先关闭 Trae，然后运行：\n` +
      `  "${TRAE_EXE}" ${debugLaunchArgs()}\n` +
      `或加 --force 参数让脚本自动重启：node src/auto-checkin.mjs --force`
    );
  }
}

async function isPortOpen() {
  try {
    const res = await fetch(`${DEBUG_URL}/json/version`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function isTraeRunning() {
  const cmd = `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*TRAE SOLO CN*' } | Select-Object ProcessId`;
  return new Promise((resolve, reject) => {
    const p = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd]);
    let out = '';
    p.stdout.on('data', d => out += d.toString());
    p.on('close', () => resolve(/ProcessId/.test(out) && out.trim().split('\n').length > 1));
    p.on('error', reject);
  });
}

function launchTraeWithDebug() {
  // 用 start 命令脱离当前进程，避免 Node 持有子进程句柄导致关闭时 UV 断言崩溃
  const cmd = `start "" "${TRAE_EXE}" ${debugLaunchArgs()}`;
  spawn('cmd', ['/c', cmd], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

async function closeTrae() {
  const cmd = `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*TRAE SOLO CN*' -or $_.Name -eq 'agent-tool-host.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  return new Promise((resolve, reject) => {
    const p = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd]);
    p.on('close', () => resolve());
    p.on('error', reject);
  });
}

async function waitForPort(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortOpen()) return;
    await sleep(500);
  }
  throw new Error('等待调试端口超时');
}

// -------------------------------------------------------------
// 1.5 页面端 DOM 定位辅助（多重候选，抗类名变化）
//     原脚本仅依赖固定 class 前缀（accountCheckin* 等），Trae
//     更新导致 CSS 类名前缀变化时会定位失败。改为"class 前缀 ->
//     文本语义"多重候选，并支持账户菜单 HTML 诊断，最大化兼容。
// -------------------------------------------------------------
const DOM_HELPERS_SRC = `
(function(){
  if (window.__TRAEFIND) return;
  function find(sel){ return document.querySelector(sel); }
  window.__TRAEFIND = {
    trigger: function(){
      var el = find('[class*="accountTrigger"]') || find('[class*="AccountTrigger"]');
      if (el) return el;
      var btns = document.querySelectorAll('button, [role="button"], a');
      for (var i=0;i<btns.length;i++){
        if (/用户|账户|头像/.test(btns[i].textContent||'')) return btns[i];
      }
      return null;
    },
    menu: function(){
      var el = find('[class*="accountPopover"]') || find('[class*="accountCard"]')
            || find('[class*="AccountPopover"]') || find('[class*="AccountCard"]');
      if (el) return el;
      var nodes = document.querySelectorAll('*');
      for (var i=0;i<nodes.length;i++){
        if (/每日签到领[0-9]+积分/.test(nodes[i].textContent||'')){
          var p = nodes[i];
          for (var k=0;k<4 && p;k++){
            if (p.className && /popover|card|menu|overlay|panel/i.test(String(p.className))) return p;
            p = p.parentElement;
          }
          return nodes[i].parentElement || nodes[i];
        }
      }
      return null;
    },
    menuText: function(){ var m = window.__TRAEFIND.menu(); return m ? (m.textContent||'') : ''; },
    menuHtml: function(){
      var m = window.__TRAEFIND.menu();
      var h = m ? m.outerHTML : (document.body ? document.body.innerHTML : '');
      return (h||'').slice(0, 3000);
    },
    checkinButton: function(){
      var el = find('[class*="accountCheckinButton"]') || find('[class*="AccountCheckinButton"]')
             || find('[class*="checkinButton"]') || find('[class*="CheckinButton"]');
      if (el) return el;
      var scope = window.__TRAEFIND.menu() || document;
      var nodes = scope.querySelectorAll('button, [role="button"], a, div, span');
      var exact = [];
      for (var i=0;i<nodes.length;i++){
        var t = (nodes[i].textContent||'').trim();
        if (t==='签到' || t==='今日已签' || t==='去签到' || t==='立即签到' || t==='已签到') exact.push(nodes[i]);
      }
      if (exact.length) return exact[0];
      var fuzzy = [];
      var all = scope.querySelectorAll('*');
      for (var j=0;j<all.length;j++){
        var e = all[j];
        if (e.children.length!==0) continue;
        var tx = (e.textContent||'').trim();
        if (/签到/.test(tx) && !/每日签到领/.test(tx)) fuzzy.push(e);
      }
      return fuzzy.length ? fuzzy[0] : null;
    },
    // 返回命中策略，便于诊断：是 class 前缀命中，还是文本语义兜底
    checkinStrategy: function(){
      var byClass = find('[class*="accountCheckinButton"]') || find('[class*="AccountCheckinButton"]')
             || find('[class*="checkinButton"]') || find('[class*="CheckinButton"]');
      if (byClass) return { via: 'class', text: (byClass.textContent||'').trim() };
      var b = window.__TRAEFIND.checkinButton();
      if (b) return { via: 'text', text: window.__TRAEFIND.checkinText() };
      return { via: 'none', text: '' };
    },
    checkinText: function(){
      var label = find('[class*="accountCheckinButtonLabel"]') || find('[class*="AccountCheckinButtonLabel"]');
      if (label) return (label.textContent||'').trim();
      var b = window.__TRAEFIND.checkinButton();
      return b ? (b.textContent||'').trim() : '';
    },
    checkinTitle: function(){
      var t = find('[class*="accountCheckinTitle"]') || find('[class*="AccountCheckinTitle"]');
      if (t) return (t.textContent||'').trim();
      var nodes = document.querySelectorAll('*');
      for (var i=0;i<nodes.length;i++){
        if (/每日签到领[0-9]+积分/.test(nodes[i].textContent||'')) return (nodes[i].textContent||'').trim();
      }
      return '';
    }
  };
})();
`;

async function injectDomHelpers(cdp) {
  // 幂等：页面内已存在则跳过；注入多候选定位辅助，避免类名变化后失效
  await cdp.evaluate(DOM_HELPERS_SRC);
}

// -------------------------------------------------------------
// 2. CDP 连接工具
// -------------------------------------------------------------
// 基于一个已建立的 WebSocket 生成 send / evaluate 客户端
function makeCdpClient(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });

  const send = (method, params) => new Promise((resolve) => {
    const myId = ++id;
    pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
  });

  return {
    ws,
    send,
    evaluate: expr => send('Runtime.evaluate', { expression: expr, returnByValue: true }),
  };
}

async function connectPage(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  const cdp = makeCdpClient(ws);
  await cdp.send('Runtime.enable');
  await injectDomHelpers(cdp); // 注入多候选定位辅助，抗 CSS 类名变化
  return cdp;
}

async function connectCDP() {
  // Trae 刚带端口启动时，/json/version 已响应但主窗口 page 可能尚未创建，
  // 此时 /json 返回的 target 列表为空。定时任务属冷启动必现此竞态，
  // 因此轮询等待 page 出现，而非一次性查询后立即报错。
  const PAGE_WAIT_MS = 30_000;
  const deadline = Date.now() + PAGE_WAIT_MS;
  let pages = [];
  let notified = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(WS_URL);
      const targets = await res.json();
      pages = targets.filter(t => t.type === 'page');
      if (pages.length) break;
    } catch {
      // Trae 启动/切换实例期间端口可能短暂不可达，忽略单次失败继续重试
    }
    if (!notified) {
      console.log('[INFO] Trae 主窗口尚未创建，等待 page target 就绪...');
      notified = true;
    }
    await sleep(1000);
  }
  if (!pages.length) {
    throw new Error(
      `等待 ${PAGE_WAIT_MS / 1000} 秒后仍未找到 page 类型的 CDP target（Trae 可能启动失败或被安全软件拦截）`
    );
  }
  for (const t of pages) {
    console.log(`[INFO] CDP page: ${t.title || '(无标题)'} | ${t.url || ''}`);
  }

  // 逐个探测，优先连接"已渲染出左下角头像"的页面（即 Trae 主窗口）。
  // 刚带端口重启的 Trae 可能存在启动页/后台页，直接取第一个 page 会连错页面。
  for (const t of pages) {
    let cdp;
    try {
      cdp = await connectPage(t.webSocketDebuggerUrl);
    } catch {
      continue;
    }
    try {
      await injectDomHelpers(cdp);
      const r = await cdp.evaluate(`!!window.__TRAEFIND.trigger()`);
      if (r?.result?.result?.value) {
        console.log(`[INFO] 已定位到 Trae 主窗口: ${t.title}`);
        return cdp;
      }
    } catch {
      // 页面可能仍在加载中，探测失败则尝试下一个
    }
    try { cdp.ws.close(); } catch { /* 忽略 */ }
  }

  // 兜底：连接第一个 page，若界面尚未渲染完成，由后续"等待主窗口就绪"处理
  console.log('[INFO] 未探测到已就绪的主窗口，先连接第一个 page，等待其渲染...');
  return connectPage(pages[0].webSocketDebuggerUrl);
}

// -------------------------------------------------------------
// 3. DOM 操作：打开头像菜单、检测并点击签到
// -------------------------------------------------------------
// 用 CDP Input.dispatchMouseEvent 派发真实鼠标事件（trusted）点击签到按钮。
// DOM 的 element.click() 产生的是 untrusted 合成事件，Trae 前端框架不响应，
// 实测表现是"点击后按钮文字仍为签到"，签到请求并未真正提交。
async function clickCheckinButton(cdp) {
  const { evaluate, send } = cdp;

  // 先滚动到视口内，保证后续坐标落在可见区域
  await evaluate(`(() => {
    const btn = window.__TRAEFIND.checkinButton();
    if (btn && btn.scrollIntoView) btn.scrollIntoView({ block: 'center', inline: 'center' });
    return true;
  })()`);
  await sleep(300);

  const rect = await evaluate(`(() => {
    const btn = window.__TRAEFIND.checkinButton();
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  })()`);
  const box = rect?.result?.result?.value;
  if (!box || !box.w || !box.h) return false;

  const dispatch = (type, buttons) => send('Input.dispatchMouseEvent', {
    type, x: box.x, y: box.y, button: 'left', buttons, clickCount: 1,
  });
  await dispatch('mouseMoved', 0);
  await dispatch('mousePressed', 1);
  await sleep(60);
  await dispatch('mouseReleased', 0);
  return true;
}

async function performCheckIn(cdp) {
  const { evaluate } = cdp;
  await injectDomHelpers(cdp); // 确保多候选定位辅助已注入（抗类名变化）

  // 3.0 等待主窗口 DOM 就绪：Trae 刚带端口重启时界面可能仍在加载，
  //     左下角头像（accountTrigger）出现后才说明主界面已渲染完成
  let triggerReady = false;
  for (let i = 0; i < 30; i++) {
    const probe = await evaluate(`!!window.__TRAEFIND.trigger()`);
    if (probe.result.result.value) { triggerReady = true; break; }
    await sleep(500);
  }
  if (!triggerReady) {
    const diag = await evaluate(`(() => ({
      title: document.title || '',
      url: location.href || '',
      hasTrigger: !!window.__TRAEFIND.trigger(),
      bodySample: document.body ? document.body.innerText.replace(/\\s+/g, ' ').slice(0, 120) : ''
    }))()`);
    throw new Error(
      '等待 Trae 主窗口就绪超时（界面未加载完成，或连到了非主窗口页面）: ' +
      JSON.stringify(diag.result.result.value)
    );
  }

  // 3.1 打开账户菜单（状态感知：如果已经打开就不再点）
  const menuAlreadyOpen = await evaluate(`!!window.__TRAEFIND.menu()`);
  if (!menuAlreadyOpen.result.result.value) {
    console.log('[INFO] 点击左下角头像...');
    await evaluate(`window.__TRAEFIND.trigger() && window.__TRAEFIND.trigger().click()`);
    // 菜单渲染可能需要时间，轮询等待最多 5 秒
    for (let i = 0; i < 10; i++) {
      await sleep(500);
      const open = await evaluate(`!!window.__TRAEFIND.menu()`);
      if (open.result.result.value) break;
    }
  } else {
    console.log('[INFO] 账户菜单已经打开');
  }

  // 3.2 读取签到按钮当前状态
  const inspect = await evaluate(`(() => {
    const btn = window.__TRAEFIND.checkinButton();
    if (!btn) return { error: 'checkin_button_not_found' };
    return {
      buttonText: window.__TRAEFIND.checkinText(),
      title: window.__TRAEFIND.checkinTitle()
    };
  })()`);
  const state = inspect.result.result.value;
  console.log(`[INFO] 签到按钮状态: ${JSON.stringify(state)}`);
  // 自检：报告命中策略，便于判断是类名前缀变化还是文本兜底生效
  const strat = await evaluate(`window.__TRAEFIND.checkinStrategy()`);
  const sv = strat.result.result.value || { via: 'unknown' };
  console.log(
    `[INFO] 定位策略: ${sv.via}` +
    (sv.via === 'text' ? '（class 前缀未命中，文本语义兜底生效，疑似类名已变化）'
      : sv.via === 'class' ? '（class 前缀命中，类名未变）' : '')
  );

  if (state.error) {
    // 区分"未登录"与"类名已变化"：检查账户菜单里是否出现登录入口
    const diag = await evaluate(`(() => {
      const menu = window.__TRAEFIND.menu();
      const t = window.__TRAEFIND.menuText();
      return {
        menuOpen: !!menu,
        hasLogin: /登录|扫码|立即登录|手机号/.test(t),
        sample: t.replace(/\\s+/g, ' ').slice(0, 120),
        html: window.__TRAEFIND.menuHtml()
      };
    })()`);
    const hint = diag.result.result.value;
    if (hint.menuOpen && hint.hasLogin) {
      return { status: 'not_logged_in', detail: hint.sample };
    }
    // 类名/结构变化导致定位失败时，打印账户菜单 HTML 片段便于排查
    console.error('[DIAG] 账户菜单诊断（前 3000 字符）：\\n' + (hint.html || '(无菜单容器)'));
    throw new Error('未找到每日签到按钮（class 前缀与文本语义均匹配失败，可能 UI 结构已变化）');
  }

  if (/已签/.test(state.buttonText)) {
    return { status: 'already_signed', detail: state.buttonText };
  }

  // 3.3 点击签到按钮（真实鼠标事件，见 clickCheckinButton 说明）
  console.log('[INFO] 尝试点击签到按钮...');
  const clicked = await clickCheckinButton(cdp);

  if (!clicked) {
    return { status: 'click_failed' };
  }

  // 3.4 验证：轮询等待按钮文字变成"今日已签"。
  //     签到是网络请求，耗时不定，固定等待会误判为 unknown。
  let afterText = '';
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    const verify = await evaluate(`window.__TRAEFIND.checkinText() || 'button_gone'`);
    afterText = verify.result.result.value;
    if (/已签/.test(afterText)) {
      return { status: 'success', detail: afterText };
    }
  }
  return { status: 'unknown', detail: afterText };
}

// -------------------------------------------------------------
// 3.5 飞书群机器人 webhook 推送（可选）
//     配置方式：--feishu <url> 或环境变量 TRAECHECKIN_FEISHU_WEBHOOK
//     推送失败仅告警，不影响签到退出码
// -------------------------------------------------------------
async function notifyFeishu(result) {
  const webhook = OPTS.feishu;
  if (!webhook || OPTS.noPush) return;

  const statusMap = {
    success: '签到成功',
    already_signed: '今日已签',
    not_logged_in: '账户未登录',
    click_failed: '点击按钮失败',
    unknown: '结果未知',
  };
  const text = [
    '【Trae 每日签到】',
    `状态：${statusMap[result.status] || result.status}`,
    `详情：${result.detail || '-'}`,
    `时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
  ].join('\n');
  const body = JSON.stringify({ msg_type: 'text', content: { text } });

  // 1) curl 主通道：本环境经实战验证可用（走 HTTP(S)_PROXY；--ssl-no-revoke 规避
  //    Windows schannel 证书吊销离线握手失败）。Node fetch 在 mihomo 代理下可能直连被拦截。
  try {
    const tmp = path.join(os.tmpdir(), 'trae_feishu_' + Date.now() + '.json');
    fs.writeFileSync(tmp, body, 'utf8');
    const curlArgs = ['-sS', '-H', 'Content-Type: application/json', '-d', '@' + tmp, webhook];
    if (process.platform === 'win32') curlArgs.unshift('--ssl-no-revoke');
    const r = spawnSync('curl', curlArgs, { encoding: 'utf8', timeout: 20000 });
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    const out = (r.stdout || '').trim();
    let codeOk = r.status === 0;
    try { codeOk = codeOk && /"code"\s*:\s*0/.test(out); } catch { /* ignore */ }
    if (!codeOk) throw new Error('curl HTTP ' + (r.status || '?') + ': ' + out.slice(0, 200));
    console.log('[INFO] 飞书通知已发送 (curl)');
    return;
  } catch (e) {
    console.warn('[WARN] curl 推送失败 (' + e.message + ')，尝试 Node fetch 兜底...');
  }

  // 2) fetch 兜底
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const rb = await res.text();
    let codeOk = res.ok;
    try { codeOk = codeOk && JSON.parse(rb).code === 0; } catch { /* 非 JSON 响应 */ }
    if (!codeOk) throw new Error(`HTTP ${res.status}: ${rb.slice(0, 200)}`);
    console.log('[INFO] 飞书通知已发送 (fetch)');
  } catch (err) {
    console.error('[WARN] 飞书通知发送失败:', err.message);
  }
}

// -------------------------------------------------------------
// 4. 主流程
// -------------------------------------------------------------
async function main() {
  try {
    await ensureDebugPort();
    console.log('[INFO] 连接 CDP...');
    const cdp = await connectCDP();
    const result = await performCheckIn(cdp);
    cdp.ws.close();
    await sleep(300); // 等 WebSocket 句柄释放后再退出

    console.log('[RESULT]', JSON.stringify(result, null, 2));

    // 签到结果推送到飞书（可选，配置了 webhook 才发送）
    await notifyFeishu(result);

    // 签到完成（无论成功/已签/失败）后，可选关闭 Trae 进程
    if (CLOSE_AFTER_CHECKIN) {
      console.log('[INFO] --close 已指定，正在关闭 Trae...');
      await closeTrae();
      console.log('[INFO] Trae 已关闭');
    }

    if (result.status === 'success') {
      process.exit(0);
    } else if (result.status === 'already_signed') {
      process.exit(2); // 已签也是一种"成功"，但用不同退出码方便调度
    } else {
      process.exit(1);
    }
  } catch (err) {
    console.error('[ERROR]', err.message);
    process.exit(1);
  }
}

main();
