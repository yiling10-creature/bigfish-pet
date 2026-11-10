<#
.SYNOPSIS
  从仓库内固定的 desktop 源码构建桌面页，不下载浮动上游版本，也不打包角色美术。
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$desktop = Join-Path $root 'desktop'
$pnpmCommand = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
if (-not $pnpmCommand) { throw '请先安装 pnpm，或将 DSH 提供的 pnpm 加入 PATH。' }
Push-Location $desktop
try {
  & $pnpmCommand.Source install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw '桌面源码依赖安装失败' }
  & $pnpmCommand.Source run check
  if ($LASTEXITCODE -ne 0) { throw '桌面源码类型检查失败' }
  & $pnpmCommand.Source test
  if ($LASTEXITCODE -ne 0) { throw '桌面回归测试失败' }
  & $pnpmCommand.Source run build
  if ($LASTEXITCODE -ne 0) { throw '桌面页构建失败' }
} finally { Pop-Location }
$target = Join-Path $root 'shell\resources\pet.html'
if (-not (Test-Path -LiteralPath $target)) { throw '缺少构建产物 pet.html' }
if ((Get-Item -LiteralPath $target).Length -gt 3MB) { throw '桌面页超过 3 MB，请检查是否意外内联了美术素材。' }
Write-Host "完成：$target"
