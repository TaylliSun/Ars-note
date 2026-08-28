param(
  [switch]$SkipChecks,
  [string]$InstallerPath,
  [string]$ManifestPath
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$PackagePath = Join-Path $Root "package.json"
$LockPath = Join-Path $Root "package-lock.json"
$Package = Get-Content -LiteralPath $PackagePath -Raw | ConvertFrom-Json
$Version = [string]$Package.version
$CommandsRun = New-Object System.Collections.Generic.List[string]

function Invoke-CheckedNpm {
  param([string[]]$Arguments)
  Push-Location $Root
  try {
    & npm.cmd @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "npm $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

function Assert-File {
  param([string]$Path, [string]$Label)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Missing $Label at $Path"
  }
}

function Get-Sha256Hex {
  param([string]$Path)
  $Stream = [System.IO.File]::OpenRead($Path)
  try {
    $Hasher = [System.Security.Cryptography.SHA256]::Create()
    try {
      return ([System.BitConverter]::ToString($Hasher.ComputeHash($Stream))).Replace("-", "").ToLowerInvariant()
    } finally {
      $Hasher.Dispose()
    }
  } finally {
    $Stream.Dispose()
  }
}

if (-not $SkipChecks) {
  Invoke-CheckedNpm @("test")
  $CommandsRun.Add("npm test")
  Invoke-CheckedNpm @("run", "typecheck")
  $CommandsRun.Add("npm run typecheck")
  Invoke-CheckedNpm @("run", "build")
  $CommandsRun.Add("npm run build")
}

$LockVersionsJson = & node.exe -e "const lock=require(process.argv[1]); process.stdout.write(JSON.stringify([lock.version, lock.packages?.['']?.version]));" $LockPath
if ($LASTEXITCODE -ne 0) {
  throw "Unable to parse package-lock.json"
}
$LockVersions = $LockVersionsJson | ConvertFrom-Json
if ([string]$LockVersions[0] -ne $Version -or [string]$LockVersions[1] -ne $Version) {
  throw "package-lock.json version does not match package.json ($Version)"
}

$RendererVersionPath = Join-Path $Root "src\appVersion.ts"
$MainPath = Join-Path $Root "electron\main.ts"
Assert-File $RendererVersionPath "renderer version source"
Assert-File $MainPath "Electron main source"
$RendererVersionText = Get-Content -LiteralPath $RendererVersionPath -Raw
$MainText = Get-Content -LiteralPath $MainPath -Raw
if ($RendererVersionText -notmatch [regex]::Escape("APP_VERSION = '$Version'")) {
  throw "src/appVersion.ts does not match package version $Version"
}
if ($MainText -notmatch [regex]::Escape("app.getVersion() || '$Version'")) {
  throw "electron/main.ts fallback version does not match package version $Version"
}

$DistIndex = Join-Path $Root "dist\index.html"
$ElectronMain = Join-Path $Root "dist-electron\main.js"
$ElectronPreload = Join-Path $Root "dist-electron\preload.js"
$ExcalidrawBootstrap = Join-Path $Root "dist\excalidraw-bootstrap.js"
$ExcalidrawAssets = Join-Path $Root "dist\dist\excalidraw-assets"
Assert-File $DistIndex "renderer build"
Assert-File $ElectronMain "Electron main build"
Assert-File $ElectronPreload "Electron preload build"
Assert-File $ExcalidrawBootstrap "Excalidraw asset bootstrap"
Assert-File (Join-Path $ExcalidrawAssets "Virgil.woff2") "Excalidraw font asset"
$ExcalidrawVendor = Get-ChildItem -LiteralPath $ExcalidrawAssets -Filter "vendor-*.js" -File -ErrorAction SilentlyContinue |
  Select-Object -First 1
if (-not $ExcalidrawVendor) {
  throw "Missing Excalidraw vendor asset in $ExcalidrawAssets"
}

$AssetsDir = Join-Path $Root "dist\assets"
$AssetNames = @(Get-ChildItem -LiteralPath $AssetsDir -File | ForEach-Object { $_.Name })
$RequiredLazyChunks = @("RightPanel", "RightPanelGameView", "RightPanelAIView", "RightPanelBackupView", "RightPanelSettingsView", "GraphView", "CanvasEditor", "ExcalidrawEditor", "AIFivePillarPanel", "TeamSchedulePanel", "BalanceLab", "TemplateBrowserPanel", "ProductionCommandCenter", "designQualityWorker")
$MissingLazyChunks = @($RequiredLazyChunks | Where-Object {
  $ChunkName = $_
  -not ($AssetNames | Where-Object { $_ -like "$ChunkName-*.js" })
})
if ($MissingLazyChunks.Count -gt 0) {
  throw "Missing expected lazy chunks: $($MissingLazyChunks -join ', ')"
}

$RequiredLazyStyles = @("RightPanelBackupView")
$MissingLazyStyles = @($RequiredLazyStyles | Where-Object {
  $StyleName = $_
  -not ($AssetNames | Where-Object { $_ -like "$StyleName-*.css" })
})
if ($MissingLazyStyles.Count -gt 0) {
  throw "Missing expected lazy styles: $($MissingLazyStyles -join ', ')"
}

$BundleBudgets = [ordered]@{
  RightPanel = 140KB
  RightPanelGameView = 48KB
  RightPanelAIView = 48KB
  RightPanelBackupView = 48KB
  RightPanelSettingsView = 128KB
}
$BundleBudgetReport = [ordered]@{}
foreach ($ChunkName in $BundleBudgets.Keys) {
  $Chunk = Get-ChildItem -LiteralPath $AssetsDir -Filter "$ChunkName-*.js" -File |
    Sort-Object Length -Descending |
    Select-Object -First 1
  if (-not $Chunk) {
    throw "Missing budgeted lazy chunk: $ChunkName"
  }
  $BudgetBytes = [long]$BundleBudgets[$ChunkName]
  if ($Chunk.Length -gt $BudgetBytes) {
    throw "$ChunkName bundle is $($Chunk.Length) bytes, above the $BudgetBytes byte release budget"
  }
  $BundleBudgetReport[$ChunkName] = [ordered]@{
    file = $Chunk.Name
    sizeBytes = $Chunk.Length
    maxBytes = $BudgetBytes
  }
}

$CssAsset = Get-ChildItem -LiteralPath $AssetsDir -Filter "*.css" -File |
  Sort-Object Length -Descending |
  Select-Object -First 1
$CssBudgetBytes = 530KB
if (-not $CssAsset) {
  throw "Missing renderer CSS asset"
}
if ($CssAsset.Length -gt $CssBudgetBytes) {
  throw "Renderer CSS is $($CssAsset.Length) bytes, above the $CssBudgetBytes byte release budget"
}
$BundleBudgetReport["rendererCss"] = [ordered]@{
  file = $CssAsset.Name
  sizeBytes = $CssAsset.Length
  maxBytes = $CssBudgetBytes
}

if (-not $InstallerPath) {
  $DefaultReleaseDir = Join-Path $Root "release-$Version"
  $Installer = Get-ChildItem -LiteralPath $DefaultReleaseDir -Filter "Ars-note-Setup-$Version.exe" -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($Installer) { $InstallerPath = $Installer.FullName }
}

$InstallerInfo = $null
if ($InstallerPath) {
  $InstallerPath = [System.IO.Path]::GetFullPath($InstallerPath)
  Assert-File $InstallerPath "Windows installer"
  $InstallerFile = Get-Item -LiteralPath $InstallerPath
  if ($InstallerFile.Length -lt 50MB) {
    throw "Installer is unexpectedly small: $($InstallerFile.Length) bytes"
  }
  $ProductVersion = [string]$InstallerFile.VersionInfo.ProductVersion
  if (-not $ProductVersion.StartsWith($Version, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Installer ProductVersion '$ProductVersion' does not match $Version"
  }
  $InstallerInfo = [ordered]@{
    path = $InstallerPath
    sizeBytes = $InstallerFile.Length
    productVersion = $ProductVersion
    sha256 = Get-Sha256Hex -Path $InstallerPath
  }
}

if (-not $ManifestPath) {
  $ManifestDirectory = if ($InstallerPath) { Split-Path -Parent $InstallerPath } else { Join-Path $Root "release-$Version" }
  $ManifestPath = Join-Path $ManifestDirectory "client-release-manifest.json"
}
$ManifestPath = [System.IO.Path]::GetFullPath($ManifestPath)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ManifestPath) | Out-Null

$Manifest = [ordered]@{
  app = "Ars-note"
  version = $Version
  verifiedAt = (Get-Date).ToString("o")
  scope = "desktop-client-only"
  syncServer = [ordered]@{
    built = $false
    packaged = $false
    note = "Server and Live Sync are intentionally outside this verification."
  }
  commandsRun = $CommandsRun.ToArray()
  artifacts = [ordered]@{
    renderer = $DistIndex
    electronMain = $ElectronMain
    electronPreload = $ElectronPreload
    excalidrawBootstrap = $ExcalidrawBootstrap
    excalidrawVendor = $ExcalidrawVendor.FullName
    lazyChunks = $RequiredLazyChunks
    lazyStyles = $RequiredLazyStyles
    bundleBudgets = $BundleBudgetReport
    installer = $InstallerInfo
  }
}
$Manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8

Write-Host "Client release verification passed." -ForegroundColor Green
Write-Host "Version: $Version"
Write-Host "Scope: desktop client only (server skipped)"
if ($InstallerInfo) {
  Write-Host "Installer: $($InstallerInfo.path)"
  Write-Host "SHA256: $($InstallerInfo.sha256)"
}
Write-Host "Manifest: $ManifestPath"
