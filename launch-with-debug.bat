@echo off
chcp 65001 >nul
rem ============================================================
rem 启动 Trae SOLO CN 并开放远程调试端口
rem 用法：
rem   1) 双击本文件：自动定位 Trae 并启动（开放 9222 端口）
rem   2) 自定义路径：set TRAECHECKIN_EXE="你的路径\TRAE SOLO CN.exe" && 双击本文件
rem   3) 自定义端口：set TRAECHECKIN_PORT=9223 && 双击本文件
rem 启动后会自动轮询调试端口，确认可用后提示可以运行签到脚本。
rem ============================================================

if "%TRAECHECKIN_PORT%"=="" set TRAECHECKIN_PORT=9222

rem 若未指定路径，则调用 scripts\locate-trae.ps1 自动定位
if "%TRAECHECKIN_EXE%"=="" (
  echo [INFO] 正在自动定位 Trae ...
  for /f "delims=" %%i in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\locate-trae.ps1" 2^>nul') do set "TRAECHECKIN_EXE=%%i"
  if "%TRAECHECKIN_EXE%"=="" (
    echo [ERROR] 未找到 Trae 可执行文件，请先设置 TRAECHECKIN_EXE 环境变量。
    pause >nul
    exit /b 1
  )
)

echo [INFO] 使用 Trae 路径: "%TRAECHECKIN_EXE%"
echo [INFO] 启动调试端口: %TRAECHECKIN_PORT%

start "" "%TRAECHECKIN_EXE%" --remote-debugging-port=%TRAECHECKIN_PORT%
echo [INFO] Trae 已启动，正在等待调试端口就绪...

powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 30;$i++){ try { $r=Invoke-WebRequest -Uri 'http://127.0.0.1:%TRAECHECKIN_PORT%/json/version' -TimeoutSec 1 -UseBasicParsing; if($r.StatusCode -eq 200){$ok=$true; break} } catch {} ; Start-Sleep -Milliseconds 500 }; if($ok){Write-Host '[OK] 调试端口已开放，可以运行：node src/auto-checkin.mjs'} else {Write-Host '[WARN] 端口未就绪，请确认 Trae 已完全启动后再运行签到脚本'}"

echo 可按 Enter 关闭本窗口。
pause >nul
