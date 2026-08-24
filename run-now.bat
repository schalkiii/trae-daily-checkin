@echo off
chcp 65001 >nul
rem ============================================================
rem 一键签到：关闭现有 Trae -> 带调试端口启动 -> 等待端口 -> 签到
rem 适合手动测试，或不想配置计划任务时每天手动点一下。
rem 注意：会关闭当前 Trae 窗口（可能丢失未保存内容），请先保存工作。
rem ============================================================

set "PROJECT_DIR=%~dp0"
set "PORT=9222"
if not "%TRAECHECKIN_PORT%"=="" set "PORT=%TRAECHECKIN_PORT%"

rem 1) 彻底关闭 Trae 及后台宿主进程
echo [INFO] 正在关闭 Trae ...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*TRAE SOLO CN*' -or $_.Name -eq 'agent-tool-host.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
timeout /t 3 >nul

rem 2) 自动定位并带端口启动 Trae（Trae 已关闭，无单实例竞态）
if "%TRAECHECKIN_EXE%"=="" (
  for /f "delims=" %%i in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_DIR%scripts\locate-trae.ps1" 2^>nul') do set "TRAECHECKIN_EXE=%%i"
)
if "%TRAECHECKIN_EXE%"=="" (
  echo [ERROR] 未找到 Trae 可执行文件，请先设置 TRAECHECKIN_EXE 环境变量。
  pause >nul
  exit /b 1
)
echo [INFO] 使用 Trae 路径: "%TRAECHECKIN_EXE%"
start "" "%TRAECHECKIN_EXE%" --remote-debugging-port=%PORT%

rem 3) 等待端口就绪（最多 ~20 秒）
echo [INFO] 正在等待调试端口 %PORT% 就绪...
powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 40;$i++){ try { $r=Invoke-WebRequest -Uri 'http://127.0.0.1:%PORT%/json/version' -TimeoutSec 1 -UseBasicParsing; if($r.StatusCode -eq 200){$ok=$true; break} } catch {} ; Start-Sleep -Milliseconds 500 }; if($ok){Write-Host '[OK] 端口就绪'} else {Write-Host '[ERROR] 端口超时，请确认 Trae 是否已完全启动'}"

rem 4) 运行签到（端口已开，无需 --force）
echo [INFO] 开始签到 ...
node "%PROJECT_DIR%src\auto-checkin.mjs"
pause >nul
