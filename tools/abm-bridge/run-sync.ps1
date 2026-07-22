param(
  [string]$BridgePath = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
$BridgePath = (Resolve-Path $BridgePath).Path
$LogDirectory = Join-Path $BridgePath 'logs'
New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
$LogFile = Join-Path $LogDirectory ("scheduler-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))

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
  Pop-Location
}
