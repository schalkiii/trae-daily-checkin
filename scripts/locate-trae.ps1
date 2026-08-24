# scripts/locate-trae.ps1
# Locate the Trae executable path (helper only; does not launch or close anything)
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\locate-trae.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\locate-trae.ps1 -ExePath "D:\My\TRAE SOLO CN\TRAE SOLO CN.exe"
# Priority: -ExePath param > TRAECHECKIN_EXE env > running process > registry > common install dirs
param(
  [string]$ExePath = ''
)

if ($ExePath) {
  if (Test-Path -LiteralPath $ExePath) { Write-Output (Resolve-Path -LiteralPath $ExePath).Path; exit 0 }
  Write-Error "Specified path does not exist: $ExePath"; exit 1
}
if ($env:TRAECHECKIN_EXE) {
  if (Test-Path -LiteralPath $env:TRAECHECKIN_EXE) { Write-Output (Resolve-Path -LiteralPath $env:TRAECHECKIN_EXE).Path; exit 0 }
  Write-Error "TRAECHECKIN_EXE env path does not exist: $($env:TRAECHECKIN_EXE)"; exit 1
}

# 1) Running Trae main process (match exe names starting with TRAE, avoid browser-bridge etc.)
$proc = Get-CimInstance Win32_Process |
  Where-Object {
    $_.ExecutablePath -and
    ((Split-Path $_.ExecutablePath -Leaf) -match '^TRAE.*\.exe$') -and
    ($_.ExecutablePath -notmatch 'agent-tool-host')
  } |
  Select-Object -First 1 -ExpandProperty ExecutablePath
if ($proc) {
  Write-Output $proc
  Write-Verbose "[INFO] Located Trae from running process: $proc"
  exit 0
}

# 2) Registry uninstall entries' InstallLocation
$roots = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
)
foreach ($r in $roots) {
  if (Test-Path $r) {
    foreach ($child in Get-ChildItem $r) {
      try {
        $v = Get-ItemProperty $child.PSPath -ErrorAction SilentlyContinue
        if ($v.DisplayName -like '*Trae*' -and $v.InstallLocation) {
          foreach ($n in @('TRAE SOLO CN.exe', 'Trae.exe', 'TRAE.exe')) {
            $candidate = Join-Path $v.InstallLocation $n
            if (Test-Path -LiteralPath $candidate) {
              Write-Output $candidate
              Write-Verbose "[INFO] Located Trae from registry: $candidate"
              exit 0
            }
          }
        }
      } catch { }
    }
  }
}

# 3) Common install directories (limited-depth scan)
$bases = @(
  'C:\Program Files', 'C:\Program Files (x86)',
  "$env:LOCALAPPDATA\Programs",
  "$env:USERPROFILE"
)
foreach ($base in $bases) {
  if (-not (Test-Path -LiteralPath $base)) { continue }
  $found = Get-ChildItem -LiteralPath $base -Recurse -Depth 3 -Filter '*.exe' -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^TRAE( SOLO CN)?\.exe$' } |
    Select-Object -First 1
  if ($found) {
    Write-Output $found.FullName
    Write-Verbose "[INFO] Auto-scanned Trae: $($found.FullName)"
    exit 0
  }
}

Write-Error "Trae executable not found. Specify via -ExePath or TRAECHECKIN_EXE env var."
exit 1
