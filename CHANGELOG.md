# 更新日志

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [2026-10-22]

### 修复
- **定时签到连续多天"等待调试端口超时" / "Trae executable not found"（本机 Trae CN）**：进程匹配只认 SOLO 版（`ExecutablePath -like '*TRAE SOLO CN*'` / `^TRAE( SOLO CN)?\.exe$`），把正在运行的 Trae CN 误判为未运行，启动分支被单实例锁吞掉、端口永不开放；非运行日又找不到可执行文件。
  - `src/auto-checkin.mjs`：`isTraeRunning()` / `closeTrae()` 统一匹配 `^(Trae CN|TRAE SOLO CN|Trae|TRAE)\.exe$` + `agent-tool-host.exe`。
  - `scripts/close-trae.ps1`、`scripts/locate-trae.ps1`：同一匹配集（注册表候选与目录扫描补 `Trae CN.exe`，taskkill 兜底同步）。
- **失败不推送飞书**：`main()` 在启动/连接阶段抛错时直接 `exit 1`，`notifyFeishu` 永不到达，失败当天无任何通知。现重构为：抛错也构造 `status=error` 结果，**成功/已签/失败一律推送**；`--close` 对失败路径同样生效（不再遗留带调试端口的 Trae）。
- **端口恢复重试加固**：新增 `launchAndWaitPort()`（ensureDebugPort 的启动路径收敛于此）：最多 3 次尝试，第 2 次起先 `closeTrae()` 清场并等待单实例锁释放（3 秒）再重启，每次最长等 30 秒，全部失败才抛 `等待调试端口超时（已重试 3 次）`。
- 实测（2026-10-22 01:2x）：Trae CN 运行中 + 不存在端口 → 正确走入"已运行但无端口"分支、20s 恢复窗口后报错、飞书收到 `运行错误` 推送、退出码 1，Trae 进程零惊动。

### 变更
- README：Troubleshooting 第 2 条补 2026-10-21/22 根因与加固说明、第 7 条同步匹配集；6.5 与退出码 status 表补 `error`（失败也推送）；核心流程图补启动重试描述。

## [2026-09-26]

### 修复
- **定时签到报 `not_logged_in` / `checkin_button_not_found`（实际已登录）**：Trae 账户组件与签到卡片均为异步渲染——菜单先出现 UID 与管理项，签到卡片滞后数秒才插入 DOM；打开菜单后只读一次按钮状态会误判失败。
  - `src/auto-checkin.mjs`：打开菜单后轮询等待签到卡片渲染（30 秒窗口，期间菜单若收起自动重新展开）；头像（主窗口就绪标志）等待窗口从 15 秒扩到 30 秒；未登录判定先剔除"退出登录"字样再匹配登录入口特征词。
  - 实测：当日真实签到成功（`status: success`，Exit 0），正常路径下卡片即时渲染、零额外等待。

### 变更
- README：Troubleshooting 第 9 条等待窗口同步为 30 秒，新增第 10 条记录本次案例与判定方法。

## [2026-09-21]

### 修复
- 新版 Trae（1.107.1）无人值守会话下调试端口丢失导致签到失败：
  - `src/auto-checkin.mjs`：端口异常时先探测 20 秒恢复窗口；`--force` 重启前等待单实例锁释放（3 秒）。
  - `scheduled-run.bat`：启动/等端口失败自动重试最多 3 次；签到命令传 `--force --close` 自愈。
