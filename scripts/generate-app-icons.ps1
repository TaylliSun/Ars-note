param(
  [string]$OutputDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) "build")
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

function New-PetalPath {
  param([ScriptBlock]$Draw)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  & $Draw $path
  $path.CloseFigure()
  return $path
}

function New-ArsNoteIconPng {
  param([int]$Size)

  $bitmap = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.ScaleTransform($Size / 128.0, $Size / 128.0)

  $primary = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    [System.Drawing.PointF]::new(10, 16),
    [System.Drawing.PointF]::new(118, 112),
    [System.Drawing.ColorTranslator]::FromHtml('#5965d8'),
    [System.Drawing.ColorTranslator]::FromHtml('#6f78e8')
  )
  $secondary = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    [System.Drawing.PointF]::new(64, 30),
    [System.Drawing.PointF]::new(64, 112),
    [System.Drawing.ColorTranslator]::FromHtml('#8a78ed'),
    [System.Drawing.ColorTranslator]::FromHtml('#7168d8')
  )

  $paths = @(
    @{ Brush = $primary; Path = (New-PetalPath { param($p) $p.StartFigure(); $p.AddBezier(54,91,34,91,17,82,10,67); $p.AddBezier(10,67,29,66,46,72,59,85) }) },
    @{ Brush = $primary; Path = (New-PetalPath { param($p) $p.StartFigure(); $p.AddBezier(74,91,94,91,111,82,118,67); $p.AddBezier(118,67,99,66,82,72,69,85) }) },
    @{ Brush = $secondary; Path = (New-PetalPath { param($p) $p.StartFigure(); $p.AddBezier(59,88,39,79,28,60,29,34); $p.AddBezier(29,34,49,40,61,56,63,82) }) },
    @{ Brush = $secondary; Path = (New-PetalPath { param($p) $p.StartFigure(); $p.AddBezier(69,88,89,79,100,60,99,34); $p.AddBezier(99,34,79,40,67,56,65,82) }) },
    @{ Brush = $secondary; Path = (New-PetalPath { param($p) $p.StartFigure(); $p.AddBezier(62,91,49,108,31,113,15,104); $p.AddBezier(15,104,29,94,46,90,63,90) }) },
    @{ Brush = $secondary; Path = (New-PetalPath { param($p) $p.StartFigure(); $p.AddBezier(66,91,79,108,97,113,113,104); $p.AddBezier(113,104,99,94,82,90,65,90) }) },
    @{ Brush = $primary; Path = (New-PetalPath { param($p) $p.StartFigure(); $p.AddLine(64,14,91,73); $p.AddLine(91,73,77,73); $p.AddLine(77,73,64,43); $p.AddLine(64,43,51,73); $p.AddLine(51,73,37,73) }) }
  )

  foreach ($item in $paths) {
    $graphics.FillPath($item.Brush, $item.Path)
    $item.Path.Dispose()
  }

  $cursorPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#6686a8'), 7)
  $cursorPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $cursorPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawLine($cursorPen, 64, 54, 64, 93)

  $tipPath = New-PetalPath {
    param($p)
    $p.StartFigure()
    $p.AddLine(64,91,72,101)
    $p.AddLine(72,101,64,111)
    $p.AddLine(64,111,56,101)
  }
  $tipBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#766ce0'))
  $graphics.FillPath($tipBrush, $tipPath)

  $stream = New-Object System.IO.MemoryStream
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $stream.ToArray()

  $stream.Dispose()
  $tipBrush.Dispose()
  $tipPath.Dispose()
  $cursorPen.Dispose()
  $primary.Dispose()
  $secondary.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()

  return $bytes
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$png512 = New-ArsNoteIconPng -Size 512
[System.IO.File]::WriteAllBytes((Join-Path $OutputDirectory "icon.png"), $png512)

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = foreach ($size in $sizes) {
  [PSCustomObject]@{ Size = $size; Bytes = (New-ArsNoteIconPng -Size $size) }
}

$iconPath = Join-Path $OutputDirectory "icon.ico"
$iconStream = New-Object System.IO.FileStream($iconPath, [System.IO.FileMode]::Create)
$writer = New-Object System.IO.BinaryWriter($iconStream)
$writer.Write([uint16]0)
$writer.Write([uint16]1)
$writer.Write([uint16]$images.Count)

$offset = 6 + (16 * $images.Count)
foreach ($image in $images) {
  $dimension = if ($image.Size -ge 256) { 0 } else { $image.Size }
  $writer.Write([byte]$dimension)
  $writer.Write([byte]$dimension)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([uint16]1)
  $writer.Write([uint16]32)
  $writer.Write([uint32]$image.Bytes.Length)
  $writer.Write([uint32]$offset)
  $offset += $image.Bytes.Length
}

foreach ($image in $images) {
  $writer.Write([byte[]]$image.Bytes)
}

$writer.Dispose()
$iconStream.Dispose()

Write-Host "Generated Ars-note icons:"
Write-Host "  $(Join-Path $OutputDirectory 'icon.png')"
Write-Host "  $iconPath ($($sizes -join ', ') px)"
