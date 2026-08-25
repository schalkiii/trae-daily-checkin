# Trae SOLO CN 每日签到自动化

> 从"这是个套壳 Web 吗？"到"自动点击签到"的完整实现记录。

> 本项目 fork 维护于 https://github.com/schalkiii/trae-daily-checkin（原作 BlueChonk/trae-daily-checkin）。

## 快速开始

```bat
:: 1) 一键启动 Trae 并开放调试端口（自动定位，双击也行）
launch-with-debug.bat

:: 2) 另开终端，运行签到（端口已开，无需 --force）
node src/auto-checkin.mjs

:: 3)（可选）注册每天定时自动签到，例如每天 12:00
install-schedule.bat 12:00

:: 不想配置计划任务？每天手动点一下也行：
run-once.bat
```

> 如果 Trae 已经在运行但没开端口，直接 `node src/auto-checkin.mjs --force` 可能遇到 Electron 单实例锁竞态而超时（见下方"常见问题"第 2 条）。`launch-with-debug.bat` 与 `run-once.bat` 均已内置"先关闭已运行的 Trae 再带端口启动"，因此无需手动关闭。

## 常见问题与踩坑（Troubleshooting）

**1. 在 PowerShell 里直接贴 `"C:\...\TRAE SOLO CN.exe" --remote-debugging-port=9222` 报 `Unexpected token`**
PowerShell 把带引号的路径当成字符串而不是命令。两种修法：
- 加调用运算符 `&`：`& "C:\Users\...\TRAE SOLO CN\TRAE SOLO CN.exe" --remote-debugging-port=9222`
- 或者直接**双击 `launch-with-debug.bat`**（内部用 `start` 已处理引号）。

**2. `node src/auto-checkin.mjs --force` 报"等待调试端口超时"**
这是 Electron 单实例锁（SingletonLock）竞态：脚本先杀掉旧 Trae，再立刻带端口启动新实例，但锁文件尚未释放，新实例把 `--remote-debugging-port` 转交给（已死的）旧实例后自己退出，导致没有进程真正绑定端口。
标准解法（绕过竞态）：
1. 彻底关闭 Trae（含后台 `agent-tool-host.exe`）：
   ```powershell
   Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*TRAE SOLO CN*' -or $_.Name -eq 'agent-tool-host.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
   ```
2. 用正确语法带端口启动一次（保持运行）：
   ```powershell
   & "C:\Users\qi.shao\AppData\Local\Programs\TRAE SOLO CN\TRAE SOLO CN.exe" --remote-debugging-port=9222
   ```
3. 另开终端运行（**不要** `--force`）：`node src/auto-checkin.mjs`
> 计划任务现在改为调用 `scheduled-run.bat`（见 6.4）：它先彻底关闭 Trae → 带 `--remote-debugging-port` 重新启动 → 轮询端口就绪 → 再运行签到脚本（**不带 `--force`**），从根上绕开了 Electron 单实例锁竞态。无论首跑还是日常，都不再出现"等待调试端口超时"。

**3. 计划任务运行时提示找不到 node / 签到没执行**
计划任务在非交互环境可能没有 Node 的 PATH。`install-schedule.bat` 已改为解析 node 的**绝对路径**写入任务命令，避免该问题。若仍失败，请确认 Node 已安装且 `where node` 能找到。

**4. 退出码 2 / status=already_signed 是正常**
表示"今日已签"，不是错误，无需重试。

**5. 签到后积分没变 / status=unknown**
说明点击后按钮文字没变成"今日已签"，通常是网络或接口失败，需人工到 Trae 里看一眼。

**6. `run-once.bat` / 带端口重启后报"未找到每日签到按钮"**
刚重启的 Trae 主窗口可能还没渲染完成，或 CDP 连到了启动页/后台页。脚本已增强：连接时会逐个探测并优先选择"已渲染出左下角头像"的页面（即主窗口），随后等待主窗口 DOM 就绪（最长约 15 秒）。若仍失败，请查看日志中的 `CDP page:` 诊断行与报错里的页面标题/内容，确认连到的确实是主窗口。

## 一、需求与想法

Trae SOLO CN（字节跳动面向中文用户的 AI IDE）每天点击左下角头像会弹出一个账户菜单，其中有一项：

> **每日签到领 200 积分**

右侧有一个按钮，未签到时显示为可点击的"签到"类文字；已签到时显示为灰色的"今日已签"。

目标：让电脑每天自动完成这个点击，无需手动打开 Trae、点头像、点签到按钮。

## 二、关键判断：它是不是"套壳 Web"？

打开安装目录 `C:\Program Files\TRAE SOLO CN` 检查：

| 发现 | 含义 |
|------|------|
| `chrome_100_percent.pak`、`v8_context_snapshot.bin`、`icudtl.dat` | Chromium 内核 |
| `libEGL.dll`、`libGLESv2.dll` | GPU 渲染 |
| `resources/app/` 下有 3615 个文件，**没有 `app.asar`** | Electron 应用，代码未打包，可直接读取 |
| `main.js` 里出现 `out-build/vs/platform/...`、`webContentExtractorService` | 基于 **VS Code 内核 fork**（和 Cursor 同源） |
| 没有 `WebView2Loader.dll` | 排除 Tauri / Wails / CEF-WebView2 |

**结论**：`TRAE SOLO CN.exe` 是 **Electron（Chromium 142）+ VS Code 架构** 的套壳 Web 应用。左下角头像、签到菜单、设置页全是 DOM，因此可以用 Web 自动化技术操控。

## 三、技术路线：Chrome DevTools Protocol (CDP)

Electron 应用本质上就是 Chromium。Chromium 提供 **远程调试协议（CDP）**，允许外部程序通过 WebSocket 访问页面 DOM、执行 JS。

### 3.1 开启调试端口

启动时加上 Chromium 参数：

```bat
"C:\Program Files\TRAE SOLO CN\TRAE SOLO CN.exe" --remote-debugging-port=9222
```

> 注：上述路径仅为示例。现在脚本会自动定位 Trae 可执行文件（见 6.3），无需手动填写路径。

启动后访问：

```text
http://localhost:9222/json
```

可以看到类似：

```json
{
  "description": "",
  "devtoolsFrontendUrl": "...",
  "id": "B8FD94AF...",
  "title": "vscode-file://.../solo-lite.html",
  "type": "page",
  "url": "vscode-file://.../solo-lite.html",
  "webSocketDebuggerUrl": "ws://localhost:9222/devtools/page/B8FD94AF..."
}
```

这就是 Trae 主界面的 WebSocket 调试端点。

### 3.2 为什么不用 F1 命令

应用内 `F1` 命令可能被改或隐藏，但 **CDP 是 Chromium 底层能力**，只要应用是用 Chromium 渲染的，这个通道就绕不开。

## 四、定位关键元素

连接 CDP 后，在页面里执行 JS 来查找元素。实际探查到的关键选择器：

| 元素 | 选择器/特征 |
|------|-------------|
| 左下角头像入口 | 类名前缀 `accountTrigger`，文本包含 `用户` 的 `<button>` |
| 账户弹窗容器 | 类名前缀 `accountPopover`、`accountCard` |
| 每日签到标题 | 类名前缀 `accountCheckinTitle`（文本 `每日签到领 200 积分`） |
| 签到按钮 | 类名前缀 `accountCheckinButton` |
| 签到按钮文字 | 类名前缀 `accountCheckinButtonLabel` |

由于 CSS 类名是工具生成的哈希后缀（如 `accountCheckinButton-hoMtQt`），脚本里使用 `*[class*="accountCheckinButton"]` 这种前缀匹配，比完全固定类名更抗更新。

## 五、核心脚本设计

项目使用 **Node.js >= 18**，零第三方依赖（自带 `fetch` 与 `WebSocket`）。

流程：

```
1. 确保 Trae 已开启调试端口
   ├─ 端口已开：直接连接
   ├─ 未运行：自动启动 Trae（带调试端口）
   └─ 已运行但无端口：安全报错，或加 --force 参数强制重启

2. 连接 CDP，定位 workbench page

3. 点击左下角头像打开账户菜单（状态感知，避免重复点击关闭菜单）

4. 在菜单中查找"每日签到"行，读取右侧按钮文本
   ├─ 文本包含"已签" → 今日已签，退出码 2
   └─ 否则 → 点击按钮，等待 2 秒后验证文本是否变为"今日已签"

5. 输出结果并关闭 CDP 连接（加 --close 参数时再关闭 Trae 进程）
```

脚本入口：`src/auto-checkin.mjs`。

## 六、使用方式

### 6.1 命令行参数（推荐用法）

```bat
:: 最简单：自动定位 Trae，默认端口 9222
node src/auto-checkin.mjs

:: 指定 Trae 路径 + 自定义端口
node src/auto-checkin.mjs --dir "C:\Program Files\TRAE SOLO CN\TRAE SOLO CN.exe" --port 9223

:: Trae 已在运行但无调试端口时，强制重启
node src/auto-checkin.mjs --force

:: 独立 profile 隔离测试（不干扰主账号）
node src/auto-checkin.mjs --dir "C:\Program Files\TRAE SOLO CN\TRAE SOLO CN.exe" --port 9223 --force --profile "%TEMP%\trae-test-profile"

:: 签到完成后自动关闭 Trae（适合无人值守/任务计划场景）
node src/auto-checkin.mjs --force --close

::: 签到结果推送到飞书群机器人（webhook 也可用环境变量 TRAECHECKIN_FEISHU_WEBHOOK）
node src/auto-checkin.mjs --feishu "https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx"

:: 查看全部参数说明
node src/auto-checkin.mjs --help
```

参数一览：

| 参数 | 作用 | 默认值 |
|------|------|--------|
| `--dir <path>` / `--exe <path>` | Trae 可执行文件路径（不传则自动扫描定位） | 自动定位 |
| `--port <n>` | CDP 调试端口 | `9222` |
| `--force` | 已运行但无调试端口时强制重启（也可 `--force 1`） | 关 |
| `--profile <path>` | 使用独立 user-data-dir（profile）启动，用于隔离测试 | 默认账号 |
| `--close` | 签到完成后关闭 Trae 进程（适合无人值守） | 关 |
| `--feishu <url>` | 签到结果推送飞书群机器人 webhook（也可 config.json / 环境变量） | 不推送 |
| `--no-push` | 只签到、不推送飞书（测试用，run-once.bat 默认带此参数） | 关 |

> 兼容旧用法：以上参数均有对应环境变量 `TRAECHECKIN_EXE` / `TRAECHECKIN_PORT` / `TRAECHECKIN_FORCE_RELAUNCH` / `TRAECHECKIN_USER_DATA_DIR` / `TRAECHECKIN_CLOSE` / `TRAECHECKIN_FEISHU_WEBHOOK`，但**命令行参数优先级更高**。实际优先级：`命令行参数 > 环境变量 > config.json > 自动扫描定位`。

### 6.2 首次/手动运行

```bat
:: 方法 A（推荐，一步到位）：run-once.bat 会先带端口重启 Trae，再自动签到
run-once.bat

:: 方法 B：双击 launch-with-debug.bat 启动 Trae（自动关闭已运行实例，再带调试端口启动，自动定位）
::         然后另开终端运行签到脚本
node src/auto-checkin.mjs

:: 方法 C：如果 Trae 已经在运行但无端口，用 PowerShell 强制重启（自动定位）
powershell -ExecutionPolicy Bypass -File scripts\relaunch-with-debug.ps1
node src/auto-checkin.mjs
```

> 方法 A/B 在 Trae 未运行或已正确带端口时最稳；若遇到"等待调试端口超时"，见顶部"常见问题"第 2 条。

### 6.3 如何定位 Trae（自定义路径 + 自动扫描）

`launch-with-debug.bat` 与 `relaunch-with-debug.ps1` 都调用共用的 `scripts\locate-trae.ps1` 定位；`src\auto-checkin.mjs` 内实现了等效的 Node 版定位。三处按同一优先级解析 Trae 可执行文件路径：

1. **自定义路径**：优先使用命令行参数 `--dir/--exe`（或 `TRAECHECKIN_EXE` 环境变量、`relaunch-with-debug.ps1` 的 `-ExePath` 参数）。
2. **正在运行的进程**：查询系统中正在运行的 `TRAE*.exe` 主进程，取其真实可执行路径。
3. **注册表卸载项**：扫描 `HKLM/HKCU` 卸载列表里 `DisplayName` 含 `Trae` 的安装位置。
4. **常见安装目录**：有限深度（3 层）扫描以下位置：`C:\Program Files`、`C:\Program Files (x86)`、`%LOCALAPPDATA%\Programs`、`%USERPROFILE%`。

因此别人克隆本项目后，**无需修改任何代码**即可直接运行——只要 Trae 安装在本机，无论装在哪个盘/目录都能被自动找到。

### 6.4 每日自动签到（Windows 任务计划）

**方式一：一键脚本（推荐）**

```bat
:: 安装：默认每天 12:00 签到
install-schedule.bat

:: 自定义时间（24 小时制），例如每天 09:30
install-schedule.bat 09:30

:: 卸载
uninstall-schedule.bat
```

脚本会自动用 `schtasks` 注册名为 `TraeDailyCheckin` 的任务，每天定时执行：

```
scheduled-run.bat
```

`scheduled-run.bat` 内部流程：**先彻底关闭 Trae（含后台 `agent-tool-host.exe`）→ 带 `--remote-debugging-port` 重新启动 → 轮询端口就绪 → 运行 `node src\auto-checkin.mjs`（不带 `--force`）**。这样无论 Trae 当前是否在运行，都不会触发单实例锁竞态。签到后 Trae 保持打开（方便你继续使用）；如需签到后自动关闭 Trae，可在 `scheduled-run.bat` 末尾补一句 `taskkill /IM "TRAE SOLO CN.exe" /F`。

> `scheduled-run.bat` 调用 `auto-checkin.mjs` 完成签到；如配置了飞书 webhook（`config.json` 的 `feishuWebhook` 或环境变量 `TRAECHECKIN_FEISHU_WEBHOOK`），计划任务每次签到结束后会自动把结果（状态/详情/时间）推送到指定飞书群。`run-once.bat` 以 `--no-push` 运行，仅测试、不推送。webhook 不再硬编码在 `.bat` 中。

**方式二：手动配置**

1. 打开"任务计划程序" → 创建基本任务，每天固定时间触发。
2. 操作选择"启动程序"，程序设为：
   `node "D:\Projects\trae-daily-checkin\src\auto-checkin.mjs" --force --close`
3. 建议签到时间设为开机后或午休时间，并勾选"无论用户是否登录都要运行"（需要保存密码）。

> 如果希望签到后 Trae 保持打开（正常使用时），命令去掉 `--close` 即可。

### 6.5 签到结果飞书推送（可选）

给飞书群机器人推送每日签到结果，方便手机查看。

1. 在飞书里创建一个群 → 群设置 → 群机器人 → 添加"自定义机器人"，复制 webhook 地址（形如 `https://open.feishu.cn/open-apis/bot/v2/hook/xxxx`）。当前版本仅支持**未开启"签名校验"**的 webhook。
2. 三种配置方式（`config.json` / 环境变量 / 命令行，优先级：命令行 > 环境变量 > config.json）：
   - config.json（推荐，且不会进版本库）：在项目根目录创建 `config.json`，填入 `"feishuWebhook": "https://open.feishu.cn/open/apis/bot/v2/hook/xxxx"`（模板见 `config.example.json`）。
   - 环境变量：`setx TRAECHECKIN_FEISHU_WEBHOOK "https://open.feishu.cn/open/apis/bot/v2/hook/xxxx"`。
   - 命令行：`node src/auto-checkin.mjs --feishu "https://open.feishu.cn/open/apis/bot/v2/hook/xxxx"`。
   注意：`run-once.bat` 以 `--no-push` 运行（仅测试）；`scheduled-run.bat` 不传 `--no-push`，配置 webhook 后会自动推送。
3. 每次签到结束后，脚本向 webhook 发送一条文本消息，内容包含：状态、详情、时间。

> 说明：推送失败只会在终端输出 `[WARN] 飞书通知发送失败`，**不影响签到本身的退出码**；未配置 webhook 时跳过推送。

## 七、退出码说明

| 退出码 | 含义 |
|--------|------|
| `0` | 签到成功 |
| `1` | 失败/异常（含未登录 `not_logged_in`、找不到按钮、签到后验证不通过等） |
| `2` | 今日已签（无需重复操作） |

脚本 `[RESULT]` 输出中可能出现的 `status` 值：

| status | 含义 |
|--------|------|
| `success` | 真实点击并签到成功 |
| `already_signed` | 今日已签 |
| `not_logged_in` | 账户未登录（弹窗里出现"登录/扫码"等入口），需要先手动登录 |
| `click_failed` | 找到了按钮但点击失败 |
| `unknown` | 点击后按钮文字未变成"今日已签"，需人工查看 |

## 八、验证结果

### 8.1 端到端签到测试（9223 端口，独立新登录账号）

在某次"未登录 → 手动登录"的新账号实例上，跑了一次完整的真实签到：

```bat
cd /d "D:\Projects\trae-daily-checkin" && node src\auto-checkin.mjs --port 9223
```

日志输出：

```
[OK] 调试端口已开放
[INFO] 点击左下角头像...
[INFO] 签到按钮状态: {"buttonText":"签到","title":"每日签到领 200 积分"}
[INFO] 尝试点击签到按钮...
[RESULT] { "status": "success", "detail": "今日已签" }
```

脚本走通了真实流程：连接新实例 CDP → 点击左下角头像弹出账户菜单 → 读到签到按钮文字为「签到」（未签状态）→ 真实点击按钮 → 验证按钮文字变成「今日已签」，退出码 `0`。

### 8.2 已有账号"今日已签"状态识别

另一次测试中，脚本正确识别到"今日已签"状态：

- 调试端口成功打开：
  ```
  VERSION: Chrome/142.0.7444.235
  [page] vscode-file://.../solo-lite.html
  ```
- 脚本正确识别到"今日已签"状态，输出：
  ```json
  {
    "status": "already_signed",
    "detail": "今日已签"
  }
  ```

说明自动化链路完全跑通；当按钮可点击时，脚本会真实点击并完成签到。

### 8.3 独立 profile 测试（不干扰主账号）

Electron 默认单实例：如果 Trae 已在运行，再带端口启动新实例不会生效。为了在一个"干净的新账号"上验证，而不影响主账号，可以用**独立的 user-data-dir（profile）**：

```bat
:: 指定独立 profile + 独立端口，并强制重启到新实例（未登录）
node src/auto-checkin.mjs --port 9223 --force --profile "C:\Windows\Temp\trae-test-profile"
```

首次运行会用独立 profile 打开一个全新窗口，需**手动登录一次**（该登录态只保存在这个独立 profile 里，不影响主账号）。之后再运行脚本即可完成真实签到。验证过程中，主账号（9222 端口）全程不受影响。

> 说明：此方式是"带端口启动已在运行的 Trae 无效"限制的绕过手段——不同 `--user-data-dir` 会被 Electron 视为不同实例，因此可以和主账号并存。

## 九、已知限制与注意事项

1. **CSS 类名可能随更新变化**：脚本使用 `class*="前缀"` 匹配，但仍需在 Trae 更新后抽查一次。
2. **调试端口的安全风险**：`--remote-debugging-port=9222` 只监听 `127.0.0.1`，本机安全；但任何本机进程都能连接，公用电脑不建议长期开启。
3. **单实例限制**：Electron 单实例机制导致"带端口启动"在已有实例运行时不会生效，因此脚本在冲突时默认安全退出，并提供强制重启选项。
4. **UI 弹窗/网络失败**：如果签到接口失败，按钮文本不会变成"今日已签"，脚本会返回 `unknown`，此时需要人工查看。
5. **批处理文件编码**：所有 `.bat` 必须是「ASCII + CRLF（无 BOM）」。在中文 Windows（GBK 代码页）下，含中文的 `.bat` 即便写了 `chcp 65001` 也会被误解析（曾导致 `'rem' 不是内部或外部命令`、`'Trae' 不是内部或外部命令` 等报错）。需要中文提示时，请改用 `.ps1`（需带 UTF-8 BOM）或交给 PowerShell 输出；`.bat` 内只保留英文 `rem`/`echo`。

## 十、项目文件说明

```text
trae-daily-checkin/
├── package.json                  # 项目元数据
├── README.md                     # 本文件
├── launch-with-debug.bat         # 双击启动 Trae：先关闭已运行实例，再带调试端口启动（自动定位），并轮询确认端口就绪
├── run-once.bat                   # 一键签到：关闭 Trae 后带端口重启 -> 等待端口 -> 运行签到（手动双击用，含 pause）
├── scheduled-run.bat             # 非交互版一键签到：供 Windows 任务计划调用（无 pause，避免挂起）
├── install-schedule.bat          # 一键注册"每日自动签到"任务计划（指向 scheduled-run.bat）
├── uninstall-schedule.bat        # 删除"每日自动签到"任务计划
├── scripts/
│   ├── locate-trae.ps1           # 通用定位 Trae 路径（进程/注册表/常见目录，可单独调用）
│   └── relaunch-with-debug.ps1   # 强制重启 Trae 并开放端口（复用 locate-trae.ps1 定位）
└── src/
    └── auto-checkin.mjs          # 自动签到主脚本（Node 版路径定位：自定义/自动扫描）
```

## 十一、后续可扩展

- 增加截图/日志落盘，方便排查失败原因。
- 在 Windows 任务计划里直接触发，实现完全无人值守。
- 如果 Trae 未来封禁 CDP，可以改用 **无障碍 API（MSAA/UIA）** 或 **Playwright 的 Electron 支持** 作为备用方案。

---

实现日期：2026-08-19
