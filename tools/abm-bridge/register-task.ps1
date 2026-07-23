param(
  [string]$TaskName = 'Lumisland-ABM-Sync',
  [ValidateRange(15, 1440)]
  [int]$IntervalMinutes = 15,
  [string]$BridgePath = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
$BridgePath = (Resolve-Path $BridgePath).Path
$Runner = Join-Path $BridgePath 'run-sync.ps1'
$SecretFile = Join-Path $BridgePath '.secrets\autonomous.bin'

$Identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$PrincipalCheck = New-Object System.Security.Principal.WindowsPrincipal($Identity)
if (-not $PrincipalCheck.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Execute este script numa janela do PowerShell aberta como Administrador.'
}
if (-not (Test-Path $Runner)) {
  throw "Script não encontrado: $Runner"
}
if (-not (Test-Path $SecretFile)) {
  throw 'Credenciais cifradas não encontradas. Execute setup-autonomous.ps1 antes de registar a tarefa.'
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw 'npm.cmd não foi encontrado no PATH. Instale o Node.js antes de registar a tarefa.'
}

$PowerShellArguments = "-NoProfile -ExecutionPolicy Bypass -File `"$Runner`" -BridgePath `"$BridgePath`" -SecretFile `"$SecretFile`""
$Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $PowerShellArguments -WorkingDirectory $BridgePath
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -WakeToRun `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
$TaskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Principal $TaskPrincipal `
  -Description 'Sincroniza a ABM Protege com o Locadora Brasil a cada 15 minutos, com renovação automática da sessão.' `
  -Force | Out-Null

Write-Host "Tarefa '$TaskName' registada para executar a cada $IntervalMinutes minutos."
Write-Host 'A tarefa é executada como SYSTEM, mesmo sem um utilizador com sessão iniciada no Windows.'
Write-Host 'As credenciais são descriptografadas apenas em memória no momento da execução.'
