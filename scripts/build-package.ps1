<#
.SYNOPSIS
  一键打包：编译启动器 → 生成 pet.html → electron-builder → 校验产物。
.DESCRIPTION
  打包结果在 dist\BigFishPet-<version>-x64.zip。
  - 启动器缺失或源码比产物新时会重新编译；
  - 默认从仓库中的 desktop 源码重新构建 pet.html；
  - 打包后校验 zip 内确实包含启动器，且 app.asar 不含素材。
#>
[CmdletBinding()]
param(
  [switch]$SkipLauncher,
  [switch]$SkipPet,
  [string]$ElectronDist = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$shell = Join-Path $root 'shell'
$launcherExe = Join-Path $root 'launcher\out\BigFishPetLauncher.exe'
$launcherSrc = Join-Path $root 'launcher\Launcher.cs'
$petHtml = Join-Path $shell 'resources\pet.html'

function Need-Launcher {
  if ($SkipLauncher) { return $false }
  if (-not (Test-Path $launcherExe)) { return $true }
  return (Get-Item $launcherSrc).LastWriteTime -gt (Get-Item $launcherExe).LastWriteTime
}

function Need-Pet {
  if ($SkipPet) { return $false }
  return $true # 默认始终从当前源码重建，避免旧页面进入新安装包
}

if (Need-Launcher) {
  Write-Host '[1/4] 编译启动器…' -ForegroundColor Cyan
  & powershell -ExecutionPolicy Bypass -File (Join-Path $root 'launcher\build-launcher.ps1') | Out-Host
  if ($LASTEXITCODE -ne 0) { throw '启动器编译失败' }
} else {
  Write-Host '[1/4] 跳过启动器（已是最新）' -ForegroundColor DarkGray
}

if (Need-Pet) {
  Write-Host '[2/4] 生成 pet.html…' -ForegroundColor Cyan
  & powershell -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\build-pet.ps1') | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'pet.html 构建失败' }
} else {
  Write-Host ("[2/4] 跳过 pet.html（已存在 {0:N2} MB）" -f ((Get-Item $petHtml).Length / 1MB)) -ForegroundColor DarkGray
}

Write-Host '[3/4] 打包…' -ForegroundColor Cyan
Push-Location $shell
try {
  & node --test tests/*.test.cjs
  if ($LASTEXITCODE -ne 0) { throw '主进程回归测试失败' }
  if (-not (Test-Path (Join-Path $shell 'node_modules\electron'))) {
    Write-Host '  安装依赖…'
    & npm.cmd ci --no-audit --no-fund 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'npm install 失败' }
  }
  $args = @('electron-builder', '--win', 'zip')
  if ($ElectronDist) { $args += "--config.electronDist=$ElectronDist" }
  & npx.cmd @args 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'electron-builder 失败' }
}
finally {
  Pop-Location
}

Write-Host '[4/4] 校验产物…' -ForegroundColor Cyan
$version = (Get-Content (Join-Path $shell 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$zip = Join-Path $root "dist\BigFishPet-$version-x64.zip"
if (-not (Test-Path $zip)) { throw "没找到产物：$zip" }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($zip)
try {
  $launcherEntry = $archive.Entries | Where-Object { $_.FullName -match '大肥鱼桌宠\.exe$' } | Select-Object -First 1
  if (-not $launcherEntry) { throw 'zip 里没有启动器（大肥鱼桌宠.exe）' }

  $stream = New-Object System.IO.MemoryStream
  $entryStream = $launcherEntry.Open()
  $entryStream.CopyTo($stream)
  $entryStream.Close()
  $hash = [System.Security.Cryptography.SHA256]::Create()
  $actualHash = [BitConverter]::ToString($hash.ComputeHash($stream.ToArray())).Replace('-', '')
  $stream.Dispose()
  $expectedHash = (Get-FileHash -LiteralPath $launcherExe -Algorithm SHA256).Hash
  $hash.Dispose()
  if ($actualHash -ne $expectedHash) { throw 'zip 内启动器与本次编译结果不一致' }

  $asar = $archive.Entries | Where-Object { $_.FullName -match 'resources/app\.asar$' } | Select-Object -First 1
  $privateData = $archive.Entries | Where-Object { $_.FullName -match '(^|/)(bigfish-profile/|deepseek\.json$)' } | Select-Object -First 1
  if ($privateData) { throw '安装包中发现用户运行资料，请检查 after-pack.cjs 是否生效' }
  if (-not $asar) { throw 'zip 中缺少 app.asar' }
  if ($asar.Length -gt 5MB) {
    throw ("app.asar 有 {0:N1} MB，素材可能又被内联进去了" -f ($asar.Length / 1MB))
  }

  Write-Host ("  启动器 {0:N0} KB ✓    app.asar {1:N2} MB ✓" -f ($launcherEntry.Length / 1KB), ($asar.Length / 1MB)) -ForegroundColor Green
  Write-Host ("  产物：{0}  ({1:N0} MB)" -f $zip, ((Get-Item $zip).Length / 1MB)) -ForegroundColor Green
}
finally {
  $archive.Dispose()
}
