# scripts/close-trae.ps1
# 关闭 Trae 主进程及其后台 agent-tool-host 进程。
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts\close-trae.ps1
# 说明：以 -File 方式调用，而非 -Command 内联脚本。后者在输出被重定向
#       或由任务计划调用时会触发 "Input redirection is not supported"，
#       导致关闭步骤静默失败，进而引发 Electron 单实例锁竞态。

$targets = Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -like '*TRAE SOLO CN*' -or $_.Name -eq 'agent-tool-host.exe'
}

if ($targets) {
    $targets | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "[INFO] Closed PID $($_.ProcessId) ($($_.Name))"
    }
} else {
    Write-Host '[INFO] No running Trae process found.'
}

# Wait until every Trae process is really gone. A fixed sleep is not enough:
# while a process lingers, Electron's singleton lock is still held, and the next
# launch hands --remote-debugging-port to the dead instance and exits silently,
# leaving the port unbound (intermittent "port ready, then fetch failed").
$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
    $remaining = Get-CimInstance Win32_Process | Where-Object {
        $_.ExecutablePath -like '*TRAE SOLO CN*' -or $_.Name -eq 'agent-tool-host.exe'
    }
    if (-not $remaining) {
        Write-Host '[INFO] All Trae processes exited.'
        exit 0
    }
    Start-Sleep -Milliseconds 500
}

# Processes still alive: escalate with taskkill to reap the whole tree.
Write-Host '[WARN] Trae processes still alive after 30s, forcing taskkill...'
& taskkill /F /IM 'TRAE SOLO CN.exe' /T 2>$null | Out-Null
& taskkill /F /IM 'agent-tool-host.exe' /T 2>$null | Out-Null
Start-Sleep -Seconds 2

exit 0
