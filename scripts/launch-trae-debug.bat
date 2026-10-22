@echo off
rem Launch Trae with the CDP debug port (called by launchTraeWithDebug
rem in auto-checkin.mjs). Must be a .bat file: Node passing a quoted string
rem to cmd /c gets mangled by libuv escaping (backslashes swallowed).
rem Args: %1=exe path  %2=port  %3=user-data-dir (may be empty)
if "%~3"=="" (
  start "" "%~1" --remote-debugging-port=%~2
) else (
  start "" "%~1" --remote-debugging-port=%~2 --user-data-dir="%~3"
)
