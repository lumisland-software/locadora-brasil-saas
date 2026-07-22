param(
  [string]$TaskName = 'Lumisland-ABM-Sync',
  [ValidateRange(15, 1440)]
  [int]$IntervalMinutes = 15,
  [switch]$SkipSeed,
  [switch]$IncludePossibleDuplicateCharge
)

function Convert-SecureStringToPlainText {
  param([Parameter(Mandatory)][SecureString]$SecureValue)
  $Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer) }
}

function Protect-LocalMachineData {
  param(
    [Parameter(Mandatory)][string]$Text,
    [Parameter(Mandatory)][string]$Path
  )
  $Bytes = [Text.Encoding]::UTF8.GetBytes($Text)
  $Encrypted = [Security.Cryptography.ProtectedData]::Protect(
    $Bytes,
    $null,
    [Security.Cryptography.DataProtectionScope]::LocalMachine
  )
  [IO.File]::WriteAllBytes($Path, $Encrypted)
  [Array]::Clear($Bytes, 0, $Bytes.Length)
}

function Protect-LocalDirectory {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$CurrentUser
  )
  New-Item -ItemType Directory -Path $Path -Force | Out-Null
  $Acl = New-Object Security.AccessControl.DirectorySecurity
  $Acl.SetAccessRuleProtection($true, $false)
  $Inheritance = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
  $Propagation = [Security.AccessControl.PropagationFlags]::None
  $Access = [Security.AccessControl.AccessControlType]::Allow
  $Rights = [Security.AccessControl.FileSystemRights]::FullControl
  $Acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($CurrentUser, $Rights, $Inheritance, $Propagation, $Access)))
  $Acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('NT AUTHORITY\SYSTEM', $Rights, $Inheritance, $Propagation, $Access)))
  Set-Acl -Path $Path -AclObject $Acl
}

$ErrorActionPreference = 'Stop'
$BridgePath = $PSScriptRoot
$RepoRoot = (Resolve-Path (Join-Path $BridgePath '..\..')).Path
$SecretDirectory = Join-Path $BridgePath '.secrets'
$SecretFile = Join-Path $SecretDirectory 'autonomous.bin'
$ProfileDirectory = Join-Path $BridgePath '.abm-profile'
$BrowsersPath = Join-Path $BridgePath '.playwright-browsers'
$EnvFile = Join-Path $BridgePath '.env'

$Identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$Principal = New-Object System.Security.Principal.WindowsPrincipal($Identity)
if (-not $Principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Execute este script numa janela do PowerShell aberta como Administrador.'
}

$NpmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
$NpxCommand = Get-Command npx.cmd -ErrorAction SilentlyContinue
if (-not $NpmCommand) { throw 'npm.cmd não foi encontrado. Instale o Node.js antes de continuar.' }
if (-not $NpxCommand) { throw 'npx.cmd não foi encontrado. Instale o Node.js antes de continuar.' }
$NpmPath = $NpmCommand.Source
$NpxPath = $NpxCommand.Source

Write-Host 'Configuração autónoma do bridge ABM Protege' -ForegroundColor Cyan
Write-Host 'As credenciais serão cifradas com DPAPI no próprio computador e não serão gravadas em texto simples.'

$AbmUsername = (Read-Host 'Utilizador/e-mail do portal ABM').Trim()
if (-not $AbmUsername) { throw 'O utilizador ABM é obrigatório.' }
$AbmPasswordSecure = Read-Host 'Senha do portal ABM' -AsSecureString
$IngestTokenSecure = Read-Host 'ABM_INGEST_TOKEN configurado no Worker' -AsSecureString
$WorkshopId = (Read-Host 'WORKSHOP_ID da locadora').Trim()
if (-not $WorkshopId) { throw 'O WORKSHOP_ID é obrigatório.' }

$DefaultIngestUrl = 'https://locadora-brasil-saas.michael-claro-ext.workers.dev/api/integrations/abm/ingest'
$IngestUrlInput = (Read-Host "Endpoint de ingestão [$DefaultIngestUrl]").Trim()
$IngestUrl = if ($IngestUrlInput) { $IngestUrlInput } else { $DefaultIngestUrl }
$PortalUrl = 'https://abmtecnologia.abmprotege.net/relatorios/rotas'
$LoginUrlInput = (Read-Host "URL de login ABM, deixe vazio para usar $PortalUrl").Trim()
$LoginUrl = if ($LoginUrlInput) { $LoginUrlInput } else { $PortalUrl }

$AbmPassword = Convert-SecureStringToPlainText $AbmPasswordSecure
$IngestToken = Convert-SecureStringToPlainText $IngestTokenSecure
if (-not $AbmPassword) { throw 'A senha ABM é obrigatória.' }
if (-not $IngestToken) { throw 'O ABM_INGEST_TOKEN é obrigatório.' }

Protect-LocalDirectory -Path $SecretDirectory -CurrentUser $Identity.Name
Protect-LocalDirectory -Path $ProfileDirectory -CurrentUser $Identity.Name
Protect-LocalDirectory -Path $BrowsersPath -CurrentUser $Identity.Name

$Payload = [ordered]@{
  version = 2
  created_at = (Get-Date).ToString('o')
  abm_username = $AbmUsername
  abm_password = $AbmPassword
  ingest_token = $IngestToken
  workshop_id = $WorkshopId
  ingest_url = $IngestUrl
  npm_path = $NpmPath
  playwright_browsers_path = $BrowsersPath
} | ConvertTo-Json -Compress
Protect-LocalMachineData -Text $Payload -Path $SecretFile

$EnvContent = @"
ABM_PORTAL_URL=$PortalUrl
ABM_LOGIN_URL=$LoginUrl
ABM_REPORT_DATE=
ABM_VEHICLE_ID=
ABM_LIVE_TIMEOUT_MS=15000
ABM_SESSION_CHECK_TIMEOUT_MS=30000
ABM_LOGIN_TIMEOUT_MS=90000
ABM_OUTPUT=./abm-snapshot.json
ABM_HEADLESS=true
ABM_INGEST_URL=$IngestUrl
"@
Set-Content -Path $EnvFile -Value $EnvContent -Encoding UTF8

$AbmPassword = $null
$IngestToken = $null
$Payload = $null
[GC]::Collect()

Write-Host 'A instalar dependências e validar o código...' -ForegroundColor Cyan
$PreviousBrowsersPath = $env:PLAYWRIGHT_BROWSERS_PATH
$env:PLAYWRIGHT_BROWSERS_PATH = $BrowsersPath
Push-Location $RepoRoot
try {
  & $NpmPath install
  if ($LASTEXITCODE -ne 0) { throw 'npm install falhou na raiz do projeto.' }

  Push-Location $BridgePath
  try {
    & $NpmPath install
    if ($LASTEXITCODE -ne 0) { throw 'npm install falhou no bridge ABM.' }
    & $NpxPath playwright install chromium
    if ($LASTEXITCODE -ne 0) { throw 'A instalação do Chromium do Playwright falhou.' }
  }
  finally { Pop-Location }

  & $NpmPath run check
  if ($LASTEXITCODE -ne 0) { throw 'npm run check encontrou erros.' }

  if (-not $SkipSeed) {
    Write-Host 'A executar o seed remoto duas vezes para validar a idempotência...' -ForegroundColor Cyan
    $env:WORKSHOP_ID = $WorkshopId
    $SeedArguments = @('run', 'seed:locadora-teste', '--', '--remote')
    if ($IncludePossibleDuplicateCharge) { $SeedArguments += '--include-possible-duplicate-charge' }

    & $NpmPath @SeedArguments
    if ($LASTEXITCODE -ne 0) { throw 'A primeira execução do seed remoto falhou.' }
    & $NpmPath @SeedArguments
    if ($LASTEXITCODE -ne 0) { throw 'A segunda execução do seed remoto falhou.' }
  }
}
finally {
  Remove-Item Env:WORKSHOP_ID -ErrorAction SilentlyContinue
  if ($null -eq $PreviousBrowsersPath) { Remove-Item Env:PLAYWRIGHT_BROWSERS_PATH -ErrorAction SilentlyContinue }
  else { $env:PLAYWRIGHT_BROWSERS_PATH = $PreviousBrowsersPath }
  Pop-Location
}

Write-Host 'A testar a autenticação automática e a sincronização...' -ForegroundColor Cyan
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $BridgePath 'run-sync.ps1') -BridgePath $BridgePath -SecretFile $SecretFile
if ($LASTEXITCODE -ne 0) {
  throw 'O primeiro sync autónomo falhou. O portal pode exigir CAPTCHA/MFA ou os seletores do formulário podem precisar de ajuste.'
}

Write-Host 'A registar a tarefa automática no Windows...' -ForegroundColor Cyan
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $BridgePath 'register-task.ps1') `
  -TaskName $TaskName -IntervalMinutes $IntervalMinutes -BridgePath $BridgePath
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível registar a tarefa no Agendador do Windows.' }

Write-Host ''
Write-Host 'Configuração concluída.' -ForegroundColor Green
Write-Host "Seed: $(-not $SkipSeed)"
Write-Host "Tarefa: $TaskName, a cada $IntervalMinutes minutos, executada como SYSTEM."
Write-Host "Segredos cifrados em: $SecretFile"
Write-Host "Chromium partilhado com SYSTEM em: $BrowsersPath"
Write-Host 'Não é necessário manter um navegador aberto nem uma sessão do utilizador iniciada no Windows.'
