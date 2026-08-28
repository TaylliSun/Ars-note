param(
  [switch]$SkipChecks,
  [switch]$SkipSmoke,
  [string]$OutputDir
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Package = Get-Content -LiteralPath (Join-Path $Root "package.json") -Raw | ConvertFrom-Json
$Version = [string]$Package.version
$ReleaseOut = if ($OutputDir) {
  [System.IO.Path]::GetFullPath($OutputDir)
} else {
  Join-Path $Root "release-$Version"
}

function Invoke-Checked {
  param([string]$Label, [string]$Exe, [string[]]$Arguments)
  Write-Host ""
  Write-Host "==> $Label" -ForegroundColor Cyan
  Push-Location $Root
  try {
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "$Label failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

if (-not $SkipChecks) {
  Invoke-Checked "Run client regression tests" "npm.cmd" @("test")
  Invoke-Checked "Type check desktop client" "npm.cmd" @("run", "typecheck")
}

# A release must always rebuild production assets. SkipChecks only skips the
# slower validation commands; it must never allow stale dist files into NSIS.
Invoke-Checked "Build desktop client" "npm.cmd" @("run", "build")

New-Item -ItemType Directory -Force -Path $ReleaseOut | Out-Null
$Builder = Join-Path $Root "node_modules\.bin\electron-builder.cmd"
if (-not (Test-Path -LiteralPath $Builder -PathType Leaf)) {
  throw "electron-builder is not installed at $Builder"
}

$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
Invoke-Checked "Package Windows desktop installer" $Builder @(
  "--win",
  "--x64",
  "--config.directories.output=$ReleaseOut"
)

if (-not $SkipSmoke) {
  $PackagedExecutable = Join-Path $ReleaseOut "win-unpacked\Ars-note.exe"
  if (-not (Test-Path -LiteralPath $PackagedExecutable -PathType Leaf)) {
    throw "Packaged executable is missing: $PackagedExecutable"
  }
  $PreviousSmokeExecutable = $env:ARS_NOTE_SMOKE_EXECUTABLE
  $PreviousLargeDocumentSmoke = $env:ARS_NOTE_LARGE_DOCUMENT_SMOKE
  try {
    $env:ARS_NOTE_SMOKE_EXECUTABLE = $PackagedExecutable
    $env:ARS_NOTE_LARGE_DOCUMENT_SMOKE = "1"
    try {
      Invoke-Checked "Run packaged large-document smoke test" "node.exe" @("scripts/electron-smoke.mjs")
    } catch {
      Write-Warning "The first packaged smoke launch failed. Waiting for Windows file scanning to settle, then retrying once."
      Start-Sleep -Milliseconds 1500
      Invoke-Checked "Retry packaged large-document smoke test" "node.exe" @("scripts/electron-smoke.mjs")
    }
  } finally {
    $env:ARS_NOTE_SMOKE_EXECUTABLE = $PreviousSmokeExecutable
    $env:ARS_NOTE_LARGE_DOCUMENT_SMOKE = $PreviousLargeDocumentSmoke
  }
}

$InstallerPath = Join-Path $ReleaseOut "Ars-note-Setup-$Version.exe"
& powershell.exe -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "verify-client-release.ps1") `
  -SkipChecks `
  -InstallerPath $InstallerPath `
  -ManifestPath (Join-Path $ReleaseOut "client-release-manifest.json")
if ($LASTEXITCODE -ne 0) {
  throw "Client release verification failed with exit code $LASTEXITCODE"
}

Write-Host ""
Write-Host "Client-only release complete: $InstallerPath" -ForegroundColor Green
Write-Host "The sync server was not built or packaged."
