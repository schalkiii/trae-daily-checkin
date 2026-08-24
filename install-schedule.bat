@echo off
chcp 65001 >nul
rem ============================================================
rem Install a daily Windows Task Scheduler job for auto check-in.
rem Usage:
rem   install-schedule.bat           default daily at 12:00
rem   install-schedule.bat 09:30     custom time (24h)
rem The job calls scheduled-run.bat, which closes Trae, relaunches
rem it with the debug port (no singleton race), waits, then signs in.
rem Node absolute path is embedded so the non-interactive scheduler
rem can find node even without it on PATH.
rem ============================================================

set "TASK_NAME=TraeDailyCheckin"
set "TIME=12:00"
if not "%1"=="" set "TIME=%1"

rem Project directory = folder of this bat
set "PROJECT_DIR=%~dp0"
set "RUNNER=%PROJECT_DIR%scheduled-run.bat"

rem Resolve node absolute path (scheduler env may lack node in PATH)
set "NODE_EXE=node"
for /f "delims=" %%i in ('where node 2^>nul') do (
  set "NODE_EXE=%%i"
  goto :found_node
)
:found_node
if "%NODE_EXE%"=="node" (
  echo [ERROR] Node.js not found. Please install Node.js and add it to PATH.
  pause >nul
  exit /b 1
)

rem Remove existing task first to avoid duplicate-registration errors
schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>nul

rem Create daily task that calls the non-interactive runner.
schtasks /Create /TN "%TASK_NAME%" /TR "\"%RUNNER%\"" /SC DAILY /ST "%TIME%" /F

if errorlevel 1 (
  echo [ERROR] Task creation failed. Run as Administrator or check schtasks permissions.
  pause >nul
  exit /b 1
)

echo [OK] Daily check-in task created:
echo   Task name : %TASK_NAME%
echo   Time      : daily at %TIME%
echo   Command   : "%RUNNER%"
echo.
echo View details with: schtasks /Query /TN "%TASK_NAME%" /V
echo Remove with: uninstall-schedule.bat
echo.
set "RUN_NOW="
set /p "RUN_NOW=Run once now for a test? (Y/N, default N): "
if /i "%RUN_NOW%"=="Y" (
  echo [INFO] Running check-in test now ...
  call "%RUNNER%"
)
echo Press Enter to close this window.
pause >nul
