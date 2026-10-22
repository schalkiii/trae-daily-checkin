# AGENTS.md — Trae 每日签到自动化（CDP 模拟点击）

## 定位
通过 Chrome DevTools Protocol 自动完成 Trae CN / TRAE SOLO CN 每日签到（左下角头像菜单里的「每日签到」按钮）。零第三方依赖，Node >= 18 原生 fetch/WebSocket。计划任务 `TraeDailyCheckin` 每日 02:30 运行。

## 怎么跑
```bat
run-once.bat                                                          :: 手动一键签到（--no-push 不推飞书，带 pause）
scheduled-run.bat                                                     :: 非交互版（计划任务调用）：关 Trae -> 带端口重启 -> 等端口 -> 签到 -> 关 Trae
node src/auto-checkin.mjs --port 9223 --force --profile "%TEMP%\trae-test-profile"  :: 独立 profile 测试（不干扰主账号）
install-schedule.bat [HH:MM]                                          :: 注册/修改计划任务（默认 02:30）
```
推送结果到飞书：`config.json` 的 `feishuWebhook`（gitignore；优先级 `--feishu` > 环境变量 `TRAECHECKIN_FEISHU_WEBHOOK` > config.json）。**成功 / 已签 / 失败（status=error）都会推送**；推送失败不影响签到退出码。

## 技术栈
- Node.js >= 18（零依赖）：fetch + WebSocket 直连 CDP，`Input.dispatchMouseEvent` 派发真实鼠标事件（Trae 前端不响应合成事件）。
- Windows 侧：PowerShell 5.1 辅助脚本（locate / close / wait-debug）；所有 `.bat` 必须 ASCII + CRLF 无 BOM（中文 Windows GBK 下含中文的 .bat 会被误解析）。

## 目录与约定
- `src/auto-checkin.mjs`：主脚本（路径定位 → ensureDebugPort → CDP 连接 → 点击签到 → 轮询验证 → 飞书推送）。
- `scripts/*.ps1`：必须 `-File` 调用；输出被重定向或计划任务场景下内联 `-Command` 会触发 "Input redirection is not supported" 静默失败。
- 进程匹配统一 `^(Trae CN|TRAE SOLO CN|Trae|TRAE)\.exe$` + `agent-tool-host.exe`（只匹配 SOLO 会把在跑的 CN 版误判为未运行——2026-10 连续失败的根因，勿改回）。
- 启动路径 `launchAndWaitPort()`：最多 3 次尝试，第 2 次起先 `closeTrae()` 清场并等待单实例锁释放（3s）再重启，每次最长等 30s。`--force` 会关闭 Trae，可能丢失未保存内容。
- 退出码：0=success，1=失败（含 `status=error`，同样推飞书），2=already_signed（当日已签，正常）。
- `logs/checkin.log`：运行日志（gitignore）。`.codebuddy/memory/`：历史会话记忆，只读参考、勿手改；现役答案以本文件和 README 为准。
- 本仓库 `.git/config` 设了 `credential.username=schalkiii`：本机 GCM 存有 github.com 两个账户，不指定用户名时非交互 `git push` 会永久卡在账户选择弹窗。

## 当前状态与下一步（2026-10-22 08:30）
- HEAD `5099075`（已推送）：进程匹配覆盖 Trae CN、失败也推飞书、端口恢复重试加固。
- **02:30 首跑结果（修复部分验证、暴露新失败点）**：
  - 已治好：`close-trae.ps1` 正确关闭全部 15 个 Trae CN 进程 + agent-tool-host；端口就绪；CDP 连上 workbench；**失败也推了飞书**（status=error，curl 送达）；失败后 Trae 被正常关闭。
  - 新失败：`performCheckIn` 等头像（accountTrigger）的窗口是 60×500ms=**30s**，无人值守会话里 30s 没渲染出来（交互会话历史实测十几秒；02:30 日志 bodySample 显示 workbench 外壳已渲染但无头像）。失败点从「端口/单实例」后移到了「账户组件就绪」。
  - 待决策的修复方向（未实施，待用户确认）：① 等待窗口 30s→90-120s；② 等待期间用 CDP `Page.bringToFront` 把页面带到前台（怀疑无人值守下组件就绪依赖可见性）；③ 先做只读诊断实测头像真实就绪时长再定。
- 已知失败模式与排查顺序见 README「常见问题」第 2 / 7 条（含 2026-10-21/22 根因补充）；triage 先看 `logs/checkin.log` 的 `[ERROR]` 行与飞书推送内容。
