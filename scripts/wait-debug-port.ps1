# scripts/wait-debug-port.ps1
# 等待 CDP 调试端口就绪（/json/version 返回 200）。
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts\wait-debug-port.ps1 -Port 9222 -TimeoutSec 40
# 说明：与 close-trae.ps1 同理，使用 -File 调用以规避重定向环境下
#       "Input redirection is not supported" 导致的等待逻辑失效。
# 注意：端口就绪仅代表 CDP 端点可用，不代表主窗口 page 已创建，
#       后者由 auto-checkin.mjs 的 connectCDP() 负责轮询等待。

param(
    [int]$Port = 9222,
    [int]$TimeoutSec = 40
)

$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ((Get-Date) -lt $deadline) {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 1 -UseBasicParsing
        if ($r.StatusCode -eq 200) {
            Write-Host "[OK] Debug port $Port ready"
            exit 0
        }
    } catch { }
    Start-Sleep -Milliseconds 500
}

Write-Host "[ERROR] Debug port $Port timeout after $TimeoutSec s"
exit 1
