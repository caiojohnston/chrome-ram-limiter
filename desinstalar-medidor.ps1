# Remove o registro do medidor de RAM do Chrome.
$key = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.ramlimiter.host'
if (Test-Path $key) {
    Remove-Item -Path $key -Force
    Write-Host 'Medidor removido do Chrome.' -ForegroundColor Green
} else {
    Write-Host 'O medidor nao estava registrado.'
}
