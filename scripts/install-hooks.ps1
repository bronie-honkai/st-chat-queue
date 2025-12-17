param([ool]$Force = $false)
# Install tracked hooks into this repo's .git\hooks directory (PowerShell)
# Run from the extension root: .\scripts\install-hooks.ps1

$RepoRoot = Split-Path -Parent $PSScriptRoot
$HooksSrc = Join-Path $RepoRoot 'scripts\hooks'
$GitDir = (& git rev-parse --git-dir) 2>$null
if (-not $GitDir) { $GitDir = '.git' }
$HooksDst = Join-Path $GitDir 'hooks'

Write-Host "Installing hooks from $HooksSrc to $HooksDst"
if (-not (Test-Path $HooksDst)) { New-Item -ItemType Directory -Path $HooksDst | Out-Null }

Get-ChildItem -Path $HooksSrc -File | ForEach-Object {
    $dest = Join-Path $HooksDst $_.Name
    Copy-Item -Path $_.FullName -Destination $dest -Force:$Force
}

Write-Host "Hooks installed. If you use Git for Windows, ensure hooks are executable in your environment (Git Bash)."
