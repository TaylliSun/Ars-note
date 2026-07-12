param(
  [switch]$SkipInstaller,
  [switch]$SkipTypecheck,
  [switch]$SkipTests,
  [switch]$SkipAudit,
  [switch]$SkipDesktopBuild,
  [switch]$SkipServerBuild,
  [switch]$NoArchive,
  [string]$OutputDir
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$PackageJson = Get-Content -LiteralPath (Join-Path $Root "package.json") -Raw | ConvertFrom-Json
$Version = [string]$PackageJson.version
$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$ReleaseRoot = if ($OutputDir) { [System.IO.Path]::GetFullPath($OutputDir) } else { Join-Path $Root "release" }
$ReleaseName = "ars-note-release-v$Version-$Stamp"
$ReleaseOut = Join-Path $ReleaseRoot $ReleaseName
$DesktopOut = Join-Path $ReleaseOut "desktop"
$DocsOut = Join-Path $ReleaseOut "docs"
$NasStage = Join-Path $ReleaseOut "nas-server-update"
$ServerStage = Join-Path $NasStage "server"
$ManifestPath = Join-Path $ReleaseOut "release-manifest.json"
$NasTarName = "ars-note-nas-server-update-v$Version-$Stamp.tar.gz"
$NasZipName = "ars-note-nas-server-update-v$Version-$Stamp.zip"
$NasTarPath = Join-Path $ReleaseRoot $NasTarName
$NasZipPath = Join-Path $ReleaseRoot $NasZipName
$LatestTarPath = Join-Path $ReleaseRoot "ars-note-nas-server-update.tar.gz"
$LatestZipPath = Join-Path $ReleaseRoot "ars-note-nas-server-update.zip"
$ChecksumsPath = Join-Path $ReleaseOut "CHECKSUMS-SHA256.txt"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Invoke-CheckedCommand {
  param(
    [string]$Label,
    [string]$WorkingDirectory,
    [string]$Exe,
    [string[]]$CommandArgs = @()
  )

  Write-Step $Label
  Push-Location $WorkingDirectory
  try {
    & $Exe @CommandArgs
    if ($LASTEXITCODE -ne 0) {
      throw "$Label failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

function New-CleanDirectory {
  param([string]$Path)
  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Copy-Directory {
  param(
    [string]$Source,
    [string]$Destination
  )
  if (-not (Test-Path -LiteralPath $Source)) {
    throw "Missing required directory: $Source"
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
  Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
}

Set-Location $Root
New-CleanDirectory $ReleaseOut
New-Item -ItemType Directory -Force -Path $DesktopOut | Out-Null
New-Item -ItemType Directory -Force -Path $DocsOut | Out-Null

$commandsRun = New-Object System.Collections.Generic.List[string]
$installer = $null

Invoke-CheckedCommand "Generate third-party notices" $Root "node" @("scripts/generate-third-party-notices.mjs")
$commandsRun.Add("node scripts/generate-third-party-notices.mjs")

if (-not $SkipAudit) {
  Invoke-CheckedCommand "Audit all npm dependencies" $Root "npm.cmd" @("audit", "--audit-level=low")
  $commandsRun.Add("npm audit --audit-level=low")
} else {
  Write-Step "Skipping dependency audit"
}

if (-not $SkipTypecheck) {
  Invoke-CheckedCommand "Type check desktop app" $Root "npm.cmd" @("run", "typecheck")
  $commandsRun.Add("npm run typecheck")
  Invoke-CheckedCommand "Type check sync server" (Join-Path $Root "server") "npm.cmd" @("run", "typecheck")
  $commandsRun.Add("cd server; npm run typecheck")
} else {
  Write-Step "Skipping type checks"
}

if (-not $SkipTests) {
  Invoke-CheckedCommand "Test desktop app" $Root "npm.cmd" @("test")
  $commandsRun.Add("npm test")
  Invoke-CheckedCommand "Test sync server" (Join-Path $Root "server") "npm.cmd" @("test")
  $commandsRun.Add("cd server; npm test")
} else {
  Write-Step "Skipping tests"
}

if (-not $SkipDesktopBuild) {
  Invoke-CheckedCommand "Build desktop app" $Root "npm.cmd" @("run", "build")
  $commandsRun.Add("npm run build")
  $requiredRendererFiles = @(
    (Join-Path $Root "dist\excalidraw-bootstrap.js"),
    (Join-Path $Root "dist\dist\excalidraw-assets\Virgil.woff2")
  )
  foreach ($requiredRendererFile in $requiredRendererFiles) {
    if (-not (Test-Path -LiteralPath $requiredRendererFile -PathType Leaf)) {
      throw "Missing required packaged renderer asset: $requiredRendererFile"
    }
  }
  $excalidrawVendor = Get-ChildItem -LiteralPath (Join-Path $Root "dist\dist\excalidraw-assets") -Filter "vendor-*.js" -File -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $excalidrawVendor) {
    throw "Missing packaged Excalidraw vendor asset."
  }
} else {
  Write-Step "Skipping desktop build"
}

if (-not $SkipServerBuild) {
  Invoke-CheckedCommand "Build sync server" (Join-Path $Root "server") "npm.cmd" @("run", "build")
  $commandsRun.Add("cd server; npm run build")
} else {
  Write-Step "Skipping sync server build"
}

if (-not $SkipInstaller) {
  Invoke-CheckedCommand "Package Windows installer" $Root "npm.cmd" @("run", "dist")
  $commandsRun.Add("npm run dist")

  $installer = Get-ChildItem -LiteralPath $ReleaseRoot -Filter "Ars-note-Setup-*.exe" -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if ($installer) {
    Copy-Item -LiteralPath $installer.FullName -Destination (Join-Path $DesktopOut $installer.Name) -Force
  } else {
    Write-Warning "No Windows installer was found in $ReleaseRoot."
  }
} else {
  Write-Step "Skipping Windows installer"
}

Write-Step "Prepare NAS server update package"
New-CleanDirectory $NasStage
New-Item -ItemType Directory -Force -Path $ServerStage | Out-Null
Copy-Item -LiteralPath (Join-Path $Root "docker-compose.nas.yml") -Destination (Join-Path $NasStage "docker-compose.nas.yml") -Force
Copy-Item -LiteralPath (Join-Path $Root ".env.example") -Destination (Join-Path $NasStage ".env.example") -Force
Copy-Directory (Join-Path $Root "server\dist") (Join-Path $ServerStage "dist")

$serverChecksumLines = Get-ChildItem -LiteralPath (Join-Path $ServerStage "dist") -File -Recurse |
  Sort-Object FullName |
  ForEach-Object {
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
    $relative = $_.FullName.Substring($NasStage.Length + 1).Replace("\", "/")
    "$hash  $relative"
  }
$serverChecksumLines | Set-Content -LiteralPath (Join-Path $NasStage "SERVER-DIST-SHA256.txt") -Encoding UTF8

$deployGuide = @"
# Ars-note NAS Server Update

Build: $Stamp
Version: $Version

This package updates only the self-hosted sync server code. It includes compiled `server/dist` files and does not include `sync-data`.

## Quick NAS update

If your existing Docker Compose already starts `ars-note-sync`, keep that compose file and only replace its mounted `server/dist` folder. Never replace or delete `sync-data` during an update.

For a first deployment, copy `.env.example` to `.env` and set a unique random `ARS_NOTE_SERVER_API_KEY` of at least 16 characters (32+ recommended). The supplied compose file refuses to start without it.

1. Upload this package, zip, or tar.gz to your NAS deploy directory.
2. Replace the existing `server/dist` with this package's `server/dist`.
3. Keep the existing `sync-data` directory unchanged and make a NAS snapshot or backup before upgrading.
4. Confirm `.env` contains the same strong API key used by every authorized client.
5. Recreate or restart the container from the NAS host or NAS container UI:

   docker compose -f docker-compose.nas.yml up -d --force-recreate

6. Verify:

   http://YOUR_NAS:8787/health
   http://YOUR_NAS:8787/admin

Client server URL must be only scheme + host + port:

   http://YOUR_NAS:8787

Do not append `/admin`.

Do not expose port 8787 directly to the public Internet. Prefer Tailscale or another trusted VPN. If Internet access is unavoidable, use HTTPS through a restricted reverse proxy and keep the server API key private.

## If your current compose uses absolute paths

Keep your current docker compose file if it already works.
Only copy this package's server/dist to your configured server/dist path.
Do not delete or overwrite your sync-data directory.

## Expected compose mounts

   ./server/dist:/app/dist:ro
   ./sync-data:/app/server-data

## Live sync safety policy

This server blocks legacy live-sync writes by default:

   ARS_NOTE_ALLOW_LEGACY_LIVE_WRITES=false

Keep every desktop client updated to the matching release before enabling real-time sync. This prevents old clients from overwriting newer server snapshots.

After upgrading, rotate any API key that was used with Ars-note before v1.5.64, then update every authorized client with the new key.

## AI memory and team workspace check

After updating, open Ars-note Team Workspace and run:

1. Refresh server status.
2. Sync memory and Skill.
3. Check the server admin page shows team schedule, team docs, AI memory files, and AI Skill coverage.

"@

Set-Content -LiteralPath (Join-Path $NasStage "NAS_DEPLOY_STEPS.md") -Value $deployGuide -Encoding UTF8

$publicDocNames = @(
  "LICENSE",
  "README.md",
  "BUILD.md",
  "PRIVACY.md",
  "SECURITY.md",
  "CHANGELOG.md",
  "PUBLIC_RELEASE_CHECKLIST.md",
  "SELF_HOSTED_SERVER.md",
  "SELF_HOSTED_OPERATIONS.md",
  "NAS_DEPLOY_STEPS.md",
  "THIRD_PARTY_NOTICES.md"
)
foreach ($docName in $publicDocNames) {
  $sourceDoc = Join-Path $Root $docName
  if (Test-Path -LiteralPath $sourceDoc) {
    Copy-Item -LiteralPath $sourceDoc -Destination (Join-Path $DocsOut $docName) -Force
    Copy-Item -LiteralPath $sourceDoc -Destination (Join-Path $ReleaseOut $docName) -Force
  }
}
Copy-Item -LiteralPath (Join-Path $Root "SECURITY.md") -Destination (Join-Path $NasStage "SECURITY.md") -Force
Copy-Item -LiteralPath (Join-Path $Root "LICENSE") -Destination (Join-Path $NasStage "LICENSE") -Force

if (-not $NoArchive) {
  Write-Step "Create NAS archives"
  if (Test-Path -LiteralPath $NasTarPath) { Remove-Item -LiteralPath $NasTarPath -Force }
  if (Test-Path -LiteralPath $NasZipPath) { Remove-Item -LiteralPath $NasZipPath -Force }
  if (Test-Path -LiteralPath $LatestTarPath) { Remove-Item -LiteralPath $LatestTarPath -Force }
  if (Test-Path -LiteralPath $LatestZipPath) { Remove-Item -LiteralPath $LatestZipPath -Force }

  tar -czf $NasTarPath -C $NasStage .
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to create tar.gz NAS package"
  }

  Compress-Archive -Path (Join-Path $NasStage "*") -DestinationPath $NasZipPath -Force
  Copy-Item -LiteralPath $NasTarPath -Destination $LatestTarPath -Force
  Copy-Item -LiteralPath $NasZipPath -Destination $LatestZipPath -Force
}

$checksumTargets = New-Object System.Collections.Generic.List[System.IO.FileInfo]
if ($installer) {
  $desktopInstaller = Join-Path $DesktopOut $installer.Name
  if (Test-Path -LiteralPath $desktopInstaller) {
    $checksumTargets.Add((Get-Item -LiteralPath $desktopInstaller))
  }
}
if (-not $NoArchive) {
  foreach ($archivePath in @($NasTarPath, $NasZipPath)) {
    if (Test-Path -LiteralPath $archivePath) {
      $checksumTargets.Add((Get-Item -LiteralPath $archivePath))
    }
  }
}
$checksumLines = $checksumTargets | ForEach-Object {
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
  "$hash  $($_.Name)"
}
$checksumLines | Set-Content -LiteralPath $ChecksumsPath -Encoding UTF8

$signatureStatus = "NotBuilt"
$signatureSubject = $null
if ($installer) {
  $desktopInstaller = Join-Path $DesktopOut $installer.Name
  if (Test-Path -LiteralPath $desktopInstaller) {
    $signature = Get-AuthenticodeSignature -LiteralPath $desktopInstaller
    $signatureStatus = [string]$signature.Status
    if ($signature.SignerCertificate) {
      $signatureSubject = [string]$signature.SignerCertificate.Subject
    }
  }
}

$installerFiles = @()
if (Test-Path -LiteralPath $DesktopOut) {
  $installerFiles = @(Get-ChildItem -LiteralPath $DesktopOut -File | ForEach-Object { $_.FullName.Replace($Root + "\", "") })
}

$manifest = [ordered]@{
  app = "Ars-note"
  version = $Version
  builtAt = (Get-Date).ToString("o")
  releaseDirectory = $ReleaseOut.Replace($Root + "\", "")
  commandsRun = $commandsRun.ToArray()
  desktop = [ordered]@{
    installerSkipped = [bool]$SkipInstaller
    files = $installerFiles
  }
  nasServer = [ordered]@{
    packageDirectory = $NasStage.Replace($Root + "\", "")
    tarGz = if ($NoArchive) { $null } else { $NasTarPath.Replace($Root + "\", "") }
    zip = if ($NoArchive) { $null } else { $NasZipPath.Replace($Root + "\", "") }
    latestTarGz = if ($NoArchive) { $null } else { $LatestTarPath.Replace($Root + "\", "") }
    latestZip = if ($NoArchive) { $null } else { $LatestZipPath.Replace($Root + "\", "") }
    dataDirectoryPolicy = "Keep sync-data unchanged. This release only updates server/dist."
  }
  publicRelease = [ordered]@{
    releaseCandidate = $true
    checksumsFile = $ChecksumsPath.Replace($Root + "\", "")
    windowsSignatureStatus = $signatureStatus
    windowsSigner = $signatureSubject
    license = "GPL-3.0-only"
    licenseDecisionRequired = $false
    privacyAndSecurityDocsIncluded = $true
    excalidrawAssetsLocal = $true
  }
}

$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8

Write-Host ""
Write-Host "Release build complete." -ForegroundColor Green
Write-Host "Release directory: $ReleaseOut"
if (-not $SkipInstaller) {
  Write-Host "Desktop installer copy: $DesktopOut"
}
Write-Host "NAS package folder: $NasStage"
if (-not $NoArchive) {
  Write-Host "NAS latest tar.gz: $LatestTarPath"
  Write-Host "NAS latest zip:    $LatestZipPath"
}
Write-Host "Manifest: $ManifestPath"
Write-Host "Checksums: $ChecksumsPath"
if (-not $SkipInstaller -and $signatureStatus -ne "Valid") {
  Write-Warning "Windows installer is not Authenticode-signed. Publish as a release candidate until a trusted code-signing certificate is configured."
}
Write-Host ""
Write-Host "Recommended NAS update:"
Write-Host "1. Upload release\ars-note-nas-server-update.zip or .tar.gz to the NAS."
Write-Host "2. Extract it over the deploy folder or copy only server/dist to the configured path."
Write-Host "3. Keep sync-data unchanged."
Write-Host "4. Run: docker compose -f docker-compose.nas.yml up -d --force-recreate"
