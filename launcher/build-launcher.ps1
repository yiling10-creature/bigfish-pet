$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $PSScriptRoot 'out'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$pngPath = Join-Path $root 'shell\resources\icon.png'
$icoPath = Join-Path $outDir 'launcher.ico'
$exePath = Join-Path $outDir 'BigFishPetLauncher.exe'

Add-Type -AssemblyName System.Drawing
$source = [System.Drawing.Image]::FromFile($pngPath)
$sizes = @(256, 64, 32, 16)
$payloads = New-Object System.Collections.Generic.List[byte[]]
foreach ($size in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $graphics = [System.Drawing.Graphics]::FromImage($bmp)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.DrawImage($source, 0, 0, $size, $size)
  $graphics.Dispose()
  $stream = New-Object System.IO.MemoryStream
  $bmp.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $payloads.Add($stream.ToArray())
  $stream.Dispose()
  $bmp.Dispose()
}
$source.Dispose()

$offset = 6 + 16 * $payloads.Count
$file = [System.IO.File]::Create($icoPath)
$writer = New-Object System.IO.BinaryWriter($file)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]$payloads.Count)
for ($i = 0; $i -lt $payloads.Count; $i++) {
  $size = $sizes[$i]
  $dimension = if ($size -ge 256) { 0 } else { $size }
  $writer.Write([byte]$dimension)
  $writer.Write([byte]$dimension)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]32)
  $writer.Write([UInt32]$payloads[$i].Length)
  $writer.Write([UInt32]$offset)
  $offset += $payloads[$i].Length
}
foreach ($payload in $payloads) {
  $writer.Write($payload)
}
$writer.Dispose()
$file.Dispose()

$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc /nologo /target:winexe /codepage:65001 /optimize+ /win32icon:$icoPath /out:$exePath (Join-Path $PSScriptRoot 'Launcher.cs')
if ($LASTEXITCODE -ne 0) { throw "csc failed with exit code $LASTEXITCODE" }

Get-Item $exePath | Select-Object Name, Length
