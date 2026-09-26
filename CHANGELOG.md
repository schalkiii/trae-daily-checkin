# 更新日志

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

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
