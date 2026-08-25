@echo off
chcp 65001 >nul
rem ============================================================
rem One-click check-in: close Trae -> launch with debug port -> wait -> sign in
rem Suitable for manual testing, or a daily manual run instead of Task Scheduler.
rem NOTE: closes the current Trae window (unsaved work may be lost); save first.
rem ============================================================

set "PROJECT_DIR=%~dp0"
set "PORT=9222"
if not "%TRAECHECKIN_PORT%"=="" set "PORT=%TRAECHECKIN_PORT%"

rem 1) Close Trae and its background host processes
echo [INFO] Closing Trae ...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*TRAE SOLO CN*' -or $_.Name -eq 'agent-tool-host.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
timeout /t 3 >nul

rem 2) Locate and launch Trae with debug port (Trae already closed => no singleton race)
if "%TRAECHECKIN_EXE%"=="" (
  for /f "delims=" %%i in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_DIR%scripts\locate-trae.ps1" 2^>nul') do set "TRAECHECKIN_EXE=%%i"
)
if "%TRAECHECKIN_EXE%"=="" (
  echo [ERROR] Trae executable not found. Set TRAECHECKIN_EXE env var.
  pause >nul
  exit /b 1
)
echo [INFO] Using Trae: "%TRAECHECKIN_EXE%"
start "" "%TRAECHECKIN_EXE%" --remote-debugging-port=%PORT%

rem 3) Wait for the debug port (up to ~20s)
echo [INFO] Waiting for debug port %PORT% ...
powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 40;$i++){ try { $r=Invoke-WebRequest -Uri 'http://127.0.0.1:%PORT%/json/version' -TimeoutSec 1 -UseBasicParsing; if($r.StatusCode -eq 200){$ok=$true; break} } catch {} ; Start-Sleep -Milliseconds 500 }; if($ok){Write-Host '[OK] Port ready'} else {Write-Host '[ERROR] Port timeout, ensure Trae fully started'; exit 1 }"
if errorlevel 1 (
  echo [ERROR] Debug port not available. Aborting check-in.
  pause >nul
  exit /b 1
)

rem 4) Run check-in (port is open, no --force needed)
echo [INFO] Running check-in ...
node "%PROJECT_DIR%src\auto-checkin.mjs"
pause >nul
