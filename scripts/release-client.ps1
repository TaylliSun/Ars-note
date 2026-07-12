param(
  [switch]$SkipChecks,
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
  Invoke-Checked "Build desktop client" "npm.cmd" @("run", "build")
}

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
