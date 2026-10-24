# Registra o medidor de RAM (native messaging host) no Chrome para o usuario atual.
$ErrorActionPreference = 'Stop'
$hostName = 'com.ramlimiter.host'
$extensionId = 'cbdlcpndhkmalkcbfchlkgodhmnhdigj'
$hostDir = Join-Path $PSScriptRoot 'host'

$python = $null
try { $python = (& py -3 -c "import sys; print(sys.executable)" 2>$null | Select-Object -First 1) } catch {}
if (-not $python) { $python = (Get-Command python.exe -ErrorAction SilentlyContinue).Source }
if (-not $python -or -not (Test-Path $python) -or $python -match 'WindowsApps') {
    throw 'Python 3 nao encontrado. Instale em https://www.python.org e rode de novo.'
}

$bat = Join-Path $hostDir 'host.bat'
@"
@echo off
"$python" -I "%~dp0host.py"
"@ | Set-Content $bat -Encoding ASCII

$manifest = Join-Path $hostDir "$hostName.json"
[ordered]@{
    name            = $hostName
    description     = 'Medidor de RAM do Chrome para a extensao Limitador de RAM'
    path            = $bat
    type            = 'stdio'
    allowed_origins = @("chrome-extension://$extensionId/")
} | ConvertTo-Json | Set-Content $manifest -Encoding ASCII

$key = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
New-Item -Path $key -Force | Out-Null
Set-Item -Path $key -Value $manifest

Write-Host "Medidor instalado." -ForegroundColor Green
Write-Host "  Python:    $python"
Write-Host "  Manifesto: $manifest"
Write-Host "  Registro:  $key"
