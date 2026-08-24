@echo off
chcp 65001 >nul
rem ============================================================
rem Remove the daily auto check-in Windows Task Scheduler job.
rem ============================================================

set "TASK_NAME=TraeDailyCheckin"

schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>nul
if errorlevel 1 (
  echo [INFO] Task %TASK_NAME% does not exist or was already removed.
) else (
  echo [OK] Removed task: %TASK_NAME%
)
pause >nul
