<#
.SYNOPSIS
  从上游 dsh-bigfish 源码构建宠物页 shell\resources\pet.html。
.DESCRIPTION
  产物含角色素材，已被 .gitignore 排除，不随仓库分发。
  需要：git、node、pnpm（或使用 DSH 自带的 pnpm）。
#>
[CmdletBinding()]
param(
  [string]$Upstream = 'https://github.com/gosomea/dsh-bigfish.git',
  [string]$Ref = 'main',
  [switch]$KeepTemp
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$target = Join-Path $root 'shell\resources\pet.html'
$work = Join-Path $env:TEMP ('bigfish-upstream-' + [guid]::NewGuid().ToString('N').Substring(0, 8))

function Find-Pnpm {
  $cmd = Get-Command pnpm -ErrorAction SilentlyContinue
  if ($cmd) { return @{ Exe = $cmd.Source; Args = @() } }

  $runtimes = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes'
  if (Test-Path $runtimes) {
    $pnpmMjs = Get-ChildItem $runtimes -Recurse -Filter 'pnpm.mjs' -File -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match '\\pnpm\\bin\\pnpm\.mjs$' } | Select-Object -First 1
    $nodeExe = Get-ChildItem $runtimes -Recurse -Filter 'node.exe' -File -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match '\\node\\bin\\node\.exe$' } | Select-Object -First 1
    if ($pnpmMjs -and $nodeExe) {
      Write-Host "使用 DSH 运行时的 pnpm：$($pnpmMjs.FullName)"
      return @{ Exe = $nodeExe.FullName; Args = @($pnpmMjs.FullName) }
    }
  }
  throw '找不到 pnpm。请安装 pnpm（npm i -g pnpm），或先安装 DeepSeek Harness 以复用其运行时。'
}

Write-Host '[1/4] 克隆上游源码…'
git clone --depth 1 --branch $Ref $Upstream $work 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) { throw "克隆失败：$Upstream ($Ref)" }

$pnpm = Find-Pnpm

Push-Location $work
try {
  Write-Host '[2/4] 安装上游依赖…'
  & $pnpm.Exe @($pnpm.Args) install --frozen-lockfile 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'pnpm install 失败' }

  Write-Host '[3/4] 构建桌面宠物页…'
  & $pnpm.Exe @($pnpm.Args) exec tsx scripts/build-desktop.ts 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { throw '构建失败（上游脚本 build-desktop.ts）' }
}
finally {
  Pop-Location
}

$built = Join-Path (Split-Path $work -Parent) 'shell\resources\pet.html'
if (-not (Test-Path $built)) { throw "构建产物没找到：$built" }

Write-Host '[4/4] 复制到 shell\resources\pet.html…'
New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
Copy-Item $built $target -Force

if (-not $KeepTemp) { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue }

$size = [math]::Round((Get-Item $target).Length / 1MB, 2)
Write-Host "完成：$target ($size MB)"
Write-Host '提醒：该文件含角色素材，已在 .gitignore 中，请勿提交。'
