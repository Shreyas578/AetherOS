# AetherOS ML Services — Windows venv setup
# Usage: .\setup-venv.ps1 sentiment|forecast|rl|all
# Prefers Python 3.12 or 3.11 (Prophet/FinBERT are unreliable on 3.13)

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("sentiment", "forecast", "rl", "all")]
    [string]$Service
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

function Find-Python {
    foreach ($cmd in @("py -3.12", "py -3.11", "python3.12", "python3.11", "python")) {
        try {
            $ver = Invoke-Expression "$cmd --version 2>&1"
            if ($ver -match "3\.(11|12)") { return $cmd }
        } catch {}
    }
    Write-Warn "No Python 3.11/3.12 found — using default python (3.13 may fail for Prophet/FinBERT)"
    return "python"
}

function Setup-Service($Name) {
    $dir = Join-Path $Root "$Name-service"
    if (-not (Test-Path $dir)) { throw "Missing $dir" }
    $py = Find-Python
    Write-Host "`n=== Setting up $Name-service with $py ===" -ForegroundColor Cyan
    Push-Location $dir
    if (Test-Path venv) { Remove-Item -Recurse -Force venv }
    Invoke-Expression "$py -m venv venv"
    & .\venv\Scripts\python.exe -m pip install --upgrade pip
    & .\venv\Scripts\pip.exe install -r requirements.txt
    Write-Host "Done. Run: cd $Name-service; .\venv\Scripts\python.exe main.py" -ForegroundColor Green
    Pop-Location
}

switch ($Service) {
    "sentiment" { Setup-Service "sentiment" }
    "forecast"  { Setup-Service "forecast" }
    "rl"        { Setup-Service "rl-policy" }
    "all" {
        Setup-Service "sentiment"
        Setup-Service "forecast"
        Setup-Service "rl-policy"
    }
}
