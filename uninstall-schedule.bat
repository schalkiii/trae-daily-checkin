@echo off
chcp 65001 >nul
rem ============================================================
rem 删除"每日自动签到"Windows 任务计划
rem ============================================================

set "TASK_NAME=TraeDailyCheckin"

schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>nul
if errorlevel 1 (
  echo [INFO] 任务 %TASK_NAME% 不存在或已删除。
) else (
  echo [OK] 已删除任务：%TASK_NAME%
)
pause >nul
