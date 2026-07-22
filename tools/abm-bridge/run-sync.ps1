param(
  [string]$BridgePath = $PSScriptRoot,
  [string]$SecretFile = (Join-Path $PSScriptRoot '.secrets\autonomous.bin')
)

$ErrorActionPreference = 'Stop'
$BridgePath = (Resolve-Path $BridgePath).Path
$SecretFile = [IO.Path]::GetFullPath($SecretFile)
$LogDirectory = Join-Path $BridgePath 'logs'
New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
Get-ChildItem -Path $LogDirectory -Filter 'scheduler-*.log' -File -ErrorAction SilentlyContinue |
  Where-Object LastWriteTime -lt (Get-Date).AddDays(-30) |
  Remove-Item -Force -ErrorAction SilentlyContinue
$LogFile = Join-Path $LogDirectory ("scheduler-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))

if (-not (Test-Path $SecretFile)) {
  "[$(Get-Date -Format o)] Credenciais cifradas não encontradas. Execute setup-autonomous.ps1." | Out-File -FilePath $LogFile -Append -Encoding utf8
  exit 2
}

$Config = Unprotect-LocalMachineData -Path $SecretFile
if (-not $Config.abm_username -or -not $Config.abm_password -or -not $Config.ingest_token) {
  "[$(Get-Date -Format o)] Ficheiro de credenciais incompleto." | Out-File -FilePath $LogFile -Append -Encoding utf8
  exit 2
}

$env:ABM_USERNAME = [string]$Config.abm_username
$env:ABM_PASSWORD = [string]$Config.abm_password
$env:ABM_INGEST_TOKEN = [string]$Config.ingest_token
$env:ABM_INGEST_URL = [string]$Config.ingest_url
$env:WORKSHOP_ID = [string]$Config.workshop_id

Push-Location $BridgePath
try {
  "[$(Get-Date -Format o)] Início da sincronização agendada." | Out-File -FilePath $LogFile -Append -Encoding utf8
  & npm.cmd run sync *>> $LogFile
  $ExitCode = $LASTEXITCODE
  "[$(Get-Date -Format o)] Fim da sincronização. ExitCode=$ExitCode" | Out-File -FilePath $LogFile -Append -Encoding utf8
  exit $ExitCode
}
catch {
  "[$(Get-Date -Format o)] Erro: $($_.Exception.Message)" | Out-File -FilePath $LogFile -Append -Encoding utf8
  exit 1
}
finally {
  Remove-Item Env:ABM_USERNAME -ErrorAction SilentlyContinue
  Remove-Item Env:ABM_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:ABM_INGEST_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:ABM_INGEST_URL -ErrorAction SilentlyContinue
  Remove-Item Env:WORKSHOP_ID -ErrorAction SilentlyContinue
  $Config = $null
  [GC]::Collect()
  Pop-Location
}

function Unprotect-LocalMachineData {
  param([Parameter(Mandatory)][string]$Path)
  $Encrypted = [IO.File]::ReadAllBytes($Path)
  $Bytes = [Security.Cryptography.ProtectedData]::Unprotect(
    $Encrypted,
    $null,
    [Security.Cryptography.DataProtectionScope]::LocalMachine
  )
  try {
    $Json = [Text.Encoding]::UTF8.GetString($Bytes)
    return $Json | ConvertFrom-Json
  }
  finally {
    [Array]::Clear($Bytes, 0, $Bytes.Length)
  }
}
