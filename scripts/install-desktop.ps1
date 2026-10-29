[CmdletBinding()]
param([switch]$NoLaunch)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$releaseRoot = Join-Path $projectRoot 'release'
$sourceDir = Join-Path $releaseRoot ("控小助-{0}-win32-x64" -f $package.version)
$desktopDir = [Environment]::GetFolderPath('Desktop')
$installDir = [IO.Path]::GetFullPath((Join-Path $desktopDir '控小助程序'))
$shortcutPath = Join-Path $desktopDir '控小助.lnk'
$executablePath = Join-Path $installDir '控小助.exe'
$manifest = Get-Content -LiteralPath (Join-Path $sourceDir '发布清单.json') -Raw -Encoding UTF8 | ConvertFrom-Json

function Assert-ChildPath([string]$Path, [string]$Parent) {
    $fullPath = [IO.Path]::GetFullPath($Path)
    $prefix = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
    if (-not $fullPath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "路径不在预期目录内：$fullPath"
    }
    return $fullPath
}

function Assert-PlainDirectory([string]$Path) {
    if (Test-Path -LiteralPath $Path) {
        $item = Get-Item -LiteralPath $Path -Force
        if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "目标不是普通目录：$Path"
        }
    }
}

if ($manifest.app -ne $package.name -or $manifest.version -ne $package.version -or $manifest.platform -ne 'win32-x64') {
    throw '发行包身份与项目版本不一致。'
}
$verification = Get-Content -LiteralPath (Join-Path $sourceDir '验证证据\packaged-smoke.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $verification.passed -or [IO.Path]::GetDirectoryName($verification.executablePath) -ne $sourceDir) {
    throw '此发行包尚未通过打包程序验证。'
}
$null = Assert-ChildPath $installDir $desktopDir
$null = Assert-ChildPath $sourceDir $releaseRoot
Assert-PlainDirectory $installDir
$oldVersion = $null
if (Test-Path -LiteralPath $installDir) {
    $oldManifest = Get-Content -LiteralPath (Join-Path $installDir '发布清单.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($oldManifest.app -ne $package.name) { throw '桌面目标目录不是控小助安装目录，已停止。' }
    $oldVersion = $oldManifest.version
}

$shortcutShell = New-Object -ComObject WScript.Shell
if (Test-Path -LiteralPath $shortcutPath) {
    $existingShortcut = $shortcutShell.CreateShortcut($shortcutPath)
    if ($existingShortcut.TargetPath -ne $executablePath) { throw '桌面已有同名但指向其他位置的快捷方式，已停止。' }
}

# 先在项目内准备并核验完整副本，成功后才替换桌面程序。
$stageDir = [IO.Path]::GetFullPath((Join-Path $releaseRoot ('.desktop-install-' + [Guid]::NewGuid().ToString('N'))))
$null = Assert-ChildPath $stageDir $releaseRoot
New-Item -ItemType Directory -Path $stageDir | Out-Null
foreach ($file in $manifest.files) {
    $sourceFile = Assert-ChildPath (Join-Path $sourceDir $file.path) $sourceDir
    $stageFile = Assert-ChildPath (Join-Path $stageDir $file.path) $stageDir
    $sourceItem = Get-Item -LiteralPath $sourceFile
    if ($sourceItem.PSIsContainer -or ($sourceItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "发行文件类型无效：$($file.path)" }
    if ($sourceItem.Length -ne $file.bytes -or (Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash -ne $file.sha256) { throw "发行文件校验失败：$($file.path)" }
    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($stageFile)) -Force | Out-Null
    Copy-Item -LiteralPath $sourceFile -Destination $stageFile
    if ((Get-FileHash -LiteralPath $stageFile -Algorithm SHA256).Hash -ne $file.sha256) { throw "复制校验失败：$($file.path)" }
}
Copy-Item -LiteralPath (Join-Path $sourceDir '发布清单.json') -Destination (Join-Path $stageDir '发布清单.json')
if (-not (Test-Path -LiteralPath (Join-Path $stageDir '控小助.exe'))) { throw '发行包缺少启动程序。' }

# 正常关闭会触发软件的保存流程；不强制终止任何进程。
$running = @(Get-Process -Name '控小助' -ErrorAction SilentlyContinue)
foreach ($process in $running) {
    if (-not $process.Path -or (-not $process.Path.StartsWith($releaseRoot + '\', [StringComparison]::OrdinalIgnoreCase) -and $process.Path -ne $executablePath)) {
        throw '另一个位置的控小助正在运行，请先关闭后重试。'
    }
}
foreach ($process in @($running | Where-Object { $_.MainWindowHandle -ne 0 })) {
    if (-not $process.CloseMainWindow()) { throw '无法正常关闭控小助，未替换桌面程序。' }
    if (-not $process.WaitForExit(20000)) { throw '控小助尚未完成保存或关闭，未替换桌面程序。' }
}
foreach ($process in $running) {
    if (-not $process.HasExited -and -not $process.WaitForExit(5000)) { throw '控小助仍在运行，未替换桌面程序。' }
}

$backupDir = $null
if (Test-Path -LiteralPath $installDir) {
    $backupRoot = Join-Path $releaseRoot 'desktop-backups'
    Assert-PlainDirectory $backupRoot
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    $backupDir = Assert-ChildPath (Join-Path $backupRoot (Get-Date -Format 'yyyyMMdd-HHmmss-fff')) $backupRoot
    Move-Item -LiteralPath $installDir -Destination $backupDir
}
try {
    Move-Item -LiteralPath $stageDir -Destination $installDir
} catch {
    if ($backupDir -and -not (Test-Path -LiteralPath $installDir)) { Move-Item -LiteralPath $backupDir -Destination $installDir }
    throw
}

$shortcut = $shortcutShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $executablePath
$shortcut.Arguments = ''
$shortcut.WorkingDirectory = $installDir
$shortcut.IconLocation = (Join-Path $installDir 'resources\app\dist\brand\app.ico') + ',0'
$shortcut.Description = '控小助 AI 控制实验工作台'
$shortcut.WindowStyle = 1
$shortcut.Save()

if (-not $NoLaunch) { Start-Process -FilePath $executablePath -WorkingDirectory $installDir -WindowStyle Hidden | Out-Null }
[pscustomobject]@{
    Version = $package.version
    PreviousVersion = $oldVersion
    InstallDirectory = $installDir
    Shortcut = $shortcutPath
    VerifiedFiles = @($manifest.files).Count
    BackupDirectory = $backupDir
    UserDataDirectory = Join-Path ([Environment]::GetFolderPath('ApplicationData')) '控小助'
} | ConvertTo-Json
