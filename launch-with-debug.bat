@echo off
chcp 65001 >nul
rem ============================================================
rem Launch Trae SOLO CN with the remote debugging port enabled.
rem Usage:
rem   1) Double-click this file: auto-locate Trae and launch (port 9222).
rem   2) Custom path: set TRAECHECKIN_EXE="your\path\TRAE SOLO CN.exe" then double-click.
rem   3) Custom port: set TRAECHECKIN_PORT=9223 then double-click.
rem NOTE: If Trae is already running it will be closed first, otherwise the
rem Electron single-instance lock silently swallows the relaunch and the
rem debug port never opens. After launch it polls the debug port.
rem ============================================================

if "%TRAECHECKIN_PORT%"=="" set TRAECHECKIN_PORT=9222

rem If path not set, auto-locate via scripts\locate-trae.ps1
rem NOTE: the for /f loop and the emptiness check MUST be in separate
rem parenthesized blocks. cmd expands %VAR% when a block is parsed, not
rem when it runs, so a nested check would always see the old (empty) value.
if "%TRAECHECKIN_EXE%"=="" (
  echo [INFO] Auto-locating Trae ...
  for /f "delims=" %%i in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\locate-trae.ps1" 2^>nul') do set "TRAECHECKIN_EXE=%%i"
)
if "%TRAECHECKIN_EXE%"=="" (
  echo [ERROR] Trae executable not found. Please set TRAECHECKIN_EXE.
  pause >nul
  exit /b 1
)

echo [INFO] Using Trae: "%TRAECHECKIN_EXE%"

rem Close any running Trae first (single-instance lock blocks a no-op relaunch)
echo [INFO] Closing any running Trae instance ...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*TRAE SOLO CN*' -or $_.Name -eq 'agent-tool-host.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
timeout /t 3 >nul

echo [INFO] Launching debug port: %TRAECHECKIN_PORT%

start "" "%TRAECHECKIN_EXE%" --remote-debugging-port=%TRAECHECKIN_PORT%
echo [INFO] Trae launched, waiting for debug port ...

powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 30;$i++){ try { $r=Invoke-WebRequest -Uri 'http://127.0.0.1:%TRAECHECKIN_PORT%/json/version' -TimeoutSec 1 -UseBasicParsing; if($r.StatusCode -eq 200){$ok=$true; break} } catch {} ; Start-Sleep -Milliseconds 500 }; if($ok){Write-Host '[OK] Debug port open. You can now run: node src/auto-checkin.mjs'} else {Write-Host '[WARN] Port not ready. Confirm Trae fully started, then run the check-in script'}"

echo Press Enter to close this window.
pause >nul
