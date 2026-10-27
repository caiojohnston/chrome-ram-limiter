# Compila o medidor de RAM (native messaging host) e registra no Chrome para o usuario atual.
# Nao precisa de administrador nem de Python: usa o compilador C# que ja vem no Windows.
$ErrorActionPreference = 'Stop'
$hostName = 'com.ramlimiter.host'
$extensionId = 'cbdlcpndhkmalkcbfchlkgodhmnhdigj'
$hostDir = Join-Path $PSScriptRoot 'host'
$source = Join-Path $hostDir 'host.cs'
$exe = Join-Path $hostDir 'ramlimiter-host.exe'

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "Compilador C# nao encontrado em $csc" }

# Fecha medidores antigos em execucao para poder recompilar o arquivo.
Get-Process -Name 'ramlimiter-host' -ErrorAction SilentlyContinue | Stop-Process -Force

& $csc /nologo /target:winexe /platform:x64 /optimize /out:$exe $source
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $exe)) { throw 'Falha ao compilar o medidor.' }

$manifest = Join-Path $hostDir "$hostName.json"
[ordered]@{
    name            = $hostName
    description     = 'Medidor de RAM do Chrome para a extensao Limitador de RAM'
    path            = $exe
    type            = 'stdio'
    allowed_origins = @("chrome-extension://$extensionId/")
} | ConvertTo-Json | Set-Content $manifest -Encoding ASCII

$key = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
New-Item -Path $key -Force | Out-Null
Set-Item -Path $key -Value $manifest

Write-Host 'Medidor instalado.' -ForegroundColor Green
Write-Host "  Executavel: $exe"
Write-Host "  Manifesto:  $manifest"
Write-Host "  Registro:   $key"
