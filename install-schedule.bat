@echo off
chcp 65001 >nul
rem ============================================================
rem 安装"每日自动签到"Windows 任务计划
rem 用法：
rem   install-schedule.bat             默认每天 12:00 签到
rem   install-schedule.bat 09:30       自定义时间（24 小时制）
rem 说明：任务会写入 node 的绝对路径，避免计划任务运行环境找不到 node。
rem ============================================================

set "TASK_NAME=TraeDailyCheckin"
set "TIME=12:00"
if not "%1"=="" set "TIME=%1"

rem 定位项目目录（本 bat 所在目录）
set "PROJECT_DIR=%~dp0"

rem 解析 node 绝对路径（计划任务在非交互环境可能无 node 的 PATH）
set "NODE_EXE=node"
for /f "delims=" %%i in ('where node 2^>nul') do (
  set "NODE_EXE=%%i"
  goto :found_node
)
:found_node
if "%NODE_EXE%"=="node" (
  echo [ERROR] 未找到 node，请先安装 Node.js 并加入 PATH。
  pause >nul
  exit /b 1
)

rem 若任务已存在，先删除（避免重复注册报错）
schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>nul

rem 注册任务：每天指定时间运行签到脚本（带端口重启 + 签到后关闭）
schtasks /Create /TN "%TASK_NAME%" /TR "\"%NODE_EXE%\" \"%PROJECT_DIR%src\auto-checkin.mjs\" --force --close" /SC DAILY /ST "%TIME%" /F

if errorlevel 1 (
  echo [ERROR] 任务注册失败。请以管理员身份运行本脚本，或检查 schtasks 权限。
  pause >nul
  exit /b 1
)

echo [OK] 已创建每日自动签到任务：
echo   任务名: %TASK_NAME%
echo   时间  : 每天 %TIME%
echo   命令  : "%NODE_EXE%" "%PROJECT_DIR%src\auto-checkin.mjs" --force --close
echo.
echo 可用 schtasks /Query /TN "%TASK_NAME%" /V 查看详情。
echo 删除任务请运行 uninstall-schedule.bat
echo.
set "RUN_NOW="
set /p "RUN_NOW=是否现在立即运行一次测试？(Y/N，默认 N): "
if /i "%RUN_NOW%"=="Y" (
  echo [INFO] 立即运行一次签到测试...
  "%NODE_EXE%" "%PROJECT_DIR%src\auto-checkin.mjs" --force --close
)
echo 可按 Enter 关闭本窗口。
pause >nul
