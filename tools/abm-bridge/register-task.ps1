param(
  [string]$TaskName = 'Lumisland-ABM-Sync',
  [ValidateRange(15, 1440)]
  [int]$IntervalMinutes = 15,
  [string]$BridgePath = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
$BridgePath = (Resolve-Path $BridgePath).Path
$Runner = Join-Path $BridgePath 'run-sync.ps1'

if (-not (Test-Path $Runner)) {
  throw "Script não encontrado: $Runner"
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw 'npm.cmd não foi encontrado no PATH. Instale o Node.js antes de registar a tarefa.'
}

$PowerShellArguments = "-NoProfile -ExecutionPolicy Bypass -File `"$Runner`" -BridgePath `"$BridgePath`""
$Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $PowerShellArguments -WorkingDirectory $BridgePath
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
$CurrentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$Principal = New-ScheduledTaskPrincipal -UserId $CurrentUser -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Principal $Principal `
  -Description 'Sincroniza a ABM Protege com o Locadora Brasil a cada 15 minutos.' `
  -Force | Out-Null

Write-Host "Tarefa '$TaskName' registada para executar a cada $IntervalMinutes minutos."
Write-Host 'A tarefa usa a sessão do utilizador atual e só executa quando esse utilizador estiver autenticado no Windows.'
Write-Host 'Execute npm run login manualmente sempre que a sessão ABM expirar.'
