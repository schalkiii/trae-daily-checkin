@echo off
chcp 65001 >nul
rem ============================================================
rem Non-interactive check-in runner for Task Scheduler.
rem Closes Trae, relaunches with the debug port, waits, then
rem runs the check-in script (no --force, avoids the electron
rem singleton-lock race). Auto-closes Trae after check-in; no pause; safe for scheduled runs.
rem The Feishu webhook is read by auto-checkin.mjs from config.json
rem (or TRAECHECKIN_FEISHU_WEBHOOK env); not hardcoded here.
rem ============================================================

set "PROJECT_DIR=%~dp0"
set "PORT=9222"
if not "%TRAECHECKIN_PORT%"=="" set "PORT=%TRAECHECKIN_PORT%"

rem 0a) Self-relaunch with output appended to logs\checkin.log.
rem     Task Scheduler discards stdout, so without this a failing run leaves
rem     no trace at all. Guarded by an env flag to relaunch only once.
set "LOG_DIR=%PROJECT_DIR%logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
set "LOG_FILE=%LOG_DIR%\checkin.log"
if not "%TRAECHECKIN_LOGGING%"=="" goto :main
set "TRAECHECKIN_LOGGING=1"
echo ===== Run at %DATE% %TIME% =====>> "%LOG_FILE%"
call "%~f0" %* >> "%LOG_FILE%" 2>&1
set "RUN_EXIT=%errorlevel%"
echo ===== Exit code: %RUN_EXIT% =====>> "%LOG_FILE%"
exit /b %RUN_EXIT%
:main

rem 0b) Resolve node absolute path (scheduler env may lack node in PATH)
set "NODE_EXE=node"
for /f "delims=" %%i in ('where node 2^>nul') do (
  set "NODE_EXE=%%i"
  goto :found_node
)
:found_node
if "%NODE_EXE%"=="node" (
  echo [ERROR] Node.js not found in PATH. Please add node to PATH.
  exit /b 1
)

rem 1) Close Trae and its background host processes
rem    Use -File with a .ps1 instead of inline -Command: the latter fails with
rem    "Input redirection is not supported" when stdout is redirected (scheduler),
rem    which silently skipped this step and caused the singleton-lock race.
echo [INFO] Closing Trae ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_DIR%scripts\close-trae.ps1"
rem Give Windows a moment to release the Electron singleton lock before relaunch.
rem `timeout /t` cannot be used here: it needs stdin and aborts with
rem "Input redirection is not supported" whenever stdout is redirected.
powershell -NoProfile -Command "Start-Sleep -Seconds 3"

rem 2) Locate and launch Trae with debug port (Trae already closed)
if "%TRAECHECKIN_EXE%"=="" (
  for /f "delims=" %%i in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_DIR%scripts\locate-trae.ps1" 2^>nul') do set "TRAECHECKIN_EXE=%%i"
)
if "%TRAECHECKIN_EXE%"=="" (
  echo [ERROR] Trae executable not found. Set TRAECHECKIN_EXE env var.
  exit /b 1
)
echo [INFO] Using Trae: "%TRAECHECKIN_EXE%"
start "" "%TRAECHECKIN_EXE%" --remote-debugging-port=%PORT%

rem 3) Wait for the debug port (up to ~40s)
rem    Note: port ready only means the CDP endpoint answers; the workbench page
rem    may not exist yet, so auto-checkin.mjs keeps waiting for the page target.
echo [INFO] Waiting for debug port %PORT% ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_DIR%scripts\wait-debug-port.ps1" -Port %PORT% -TimeoutSec 40
if errorlevel 1 (
  echo [ERROR] Debug port not available. Aborting check-in.
  exit /b 1
)

rem 4) Run check-in (port is open, no --force needed).
rem    --close makes the script auto-close Trae (incl. agent-tool-host) after check-in.
echo [INFO] Running check-in ...
"%NODE_EXE%" "%PROJECT_DIR%src\auto-checkin.mjs" --close
exit /b %errorlevel%
