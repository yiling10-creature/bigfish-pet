<#
.SYNOPSIS
  从上游 dsh-bigfish 源码构建宠物页 shell\resources\pet.html（不含素材）。
.DESCRIPTION
  流程：浅克隆上游 → 应用 patches\ 下的两个运行时素材补丁 → 构建 → 复制产物。
  产物约 0.4 MB（原版内联素材时约 34.6 MB），角色素材由程序运行时读取。
  需要：git、node、pnpm（或复用 DSH 自带运行时）。
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
$patches = Join-Path $root 'patches'
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

Write-Host '[1/5] 克隆上游源码…'
git clone --depth 1 --branch $Ref $Upstream $work 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) { throw "克隆失败：$Upstream ($Ref)" }

$pnpm = Find-Pnpm

Write-Host '[2/5] 安装上游依赖…'
Push-Location $work
try {
  & $pnpm.Exe @($pnpm.Args) install --frozen-lockfile 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'pnpm install 失败' }
}
finally {
  Pop-Location
}

Write-Host '[3/5] 应用运行时素材补丁…'
Copy-Item (Join-Path $patches 'sprite-assets.runtime.ts') (Join-Path $work 'src\client\sprite-assets.ts') -Force
Copy-Item (Join-Path $patches 'builtin-extension.runtime.ts') (Join-Path $work 'src\client\builtin-extension.ts') -Force
$renderer = Join-Path $work 'src\client\renderer.ts'
$text = Get-Content $renderer -Raw
$text = $text -replace 'void loadBuiltinExtension\(\)\.then\(', 'void loadBuiltinExtension().catch(() => {}).then('
[IO.File]::WriteAllText($renderer, $text, (New-Object System.Text.UTF8Encoding($false)))

Write-Host '[4/5] 构建桌面宠物页…'
Push-Location $work
try {
  & $pnpm.Exe @($pnpm.Args) exec tsx scripts/build-desktop.ts 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { throw '构建失败（上游脚本 build-desktop.ts）' }
}
finally {
  Pop-Location
}

$built = Join-Path (Split-Path $work -Parent) 'shell\resources\pet.html'
if (-not (Test-Path $built)) { throw "构建产物没找到：$built" }

Write-Host '[5/5] 复制并校验体积…'
New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
Copy-Item $built $target -Force
$mb = [math]::Round((Get-Item $target).Length / 1MB, 2)
if ($mb -gt 3) {
  throw "pet.html 仍有 $mb MB，说明素材没被剥离；请检查 patches 是否生效。"
}

if (-not $KeepTemp) { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue }
Write-Host "完成：$target ($mb MB)"
