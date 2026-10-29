param(
    [string]$CompilerPath,
    [string]$Version,
    [switch]$BootstrapCompiler
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
if (-not $Version) { $Version = $package.version }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw '安装版本必须为 x.y.z。' }
$releaseRoot = Join-Path $root 'release'
$source = Join-Path $releaseRoot "控小助-$Version-win32-x64"
$manifestPath = Join-Path $source '发布清单.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.app -ne $package.name -or $manifest.version -ne $Version -or $manifest.platform -ne 'win32-x64' -or -not $manifest.finalizedAt) {
    throw '发行包身份不符，或尚未完成 finalize-release.mjs。'
}
$smoke = Get-Content -LiteralPath (Join-Path $source '验证证据\packaged-smoke.json') -Raw | ConvertFrom-Json
if (-not $smoke.passed -or [IO.Path]::GetFullPath((Split-Path -Parent $smoke.executablePath)) -ne [IO.Path]::GetFullPath($source)) {
    throw '此发行包尚未通过对应的打包运行验证。'
}

function Assert-PlainPath([string]$Path, [string]$Parent) {
    $absolute = [IO.Path]::GetFullPath($Path)
    $parentAbsolute = [IO.Path]::GetFullPath($Parent).TrimEnd('\')
    if (-not $absolute.StartsWith($parentAbsolute + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "路径越界：$Path" }
    $current = $absolute
    while ($current.Length -ge $parentAbsolute.Length) {
        $item = Get-Item -LiteralPath $current -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "不允许链接或重解析点：$current" }
        $current = Split-Path -Parent $current
    }
    return $absolute
}
function Quote-Iss([string]$Value) { return $Value.Replace('"', '""').Replace('{', '{{') }

# 只允许清单内的文件进入安装器，并在编译前核对每个文件。
$lines = [Collections.Generic.List[string]]::new()
$seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($file in $manifest.files) {
    if ($file.path -match '[\r\n";:{}]' -or [IO.Path]::IsPathRooted($file.path) -or $file.path -match '(^|[/\\])\.\.?([/\\]|$)') { throw "清单路径非法：$($file.path)" }
    if (-not $seen.Add($file.path)) { throw "清单路径重复：$($file.path)" }
    $absolute = Assert-PlainPath (Join-Path $source $file.path) $source
    $item = Get-Item -LiteralPath $absolute
    if ($item.PSIsContainer -or $item.Length -ne $file.bytes -or (Get-FileHash -LiteralPath $absolute -Algorithm SHA256).Hash -ne $file.sha256) { throw "发行文件校验失败：$($file.path)" }
    $relativeDirectory = Split-Path -Parent $file.path.Replace('/', '\')
    $targetDirectory = if ($relativeDirectory) { '{app}\' + (Quote-Iss $relativeDirectory) } else { '{app}' }
    $lines.Add('Source: "' + (Quote-Iss $absolute) + '"; DestDir: "' + $targetDirectory + '"; Flags: ignoreversion')
}
foreach ($required in @('控小助.exe', 'resources/app/package.json', 'resources/app/desktop/compute-worker.mjs', 'resources/app/dist/index.html', 'resources/app/dist/brand/app.ico')) {
    if (-not $seen.Contains($required)) { throw "发行清单缺少必需文件：$required" }
}
$appMetadata = Get-Content -LiteralPath (Join-Path $source 'resources\app\package.json') -Raw | ConvertFrom-Json
if ($appMetadata.name -ne $package.name -or $appMetadata.version -ne $Version) { throw '打包应用元数据不匹配。' }
$null = Assert-PlainPath $manifestPath $source
$lines.Add('Source: "' + (Quote-Iss $manifestPath) + '"; DestDir: "{app}"; Flags: ignoreversion')
$brandIcon = Join-Path $source 'resources\app\dist\brand\app.ico'
$iconVerification = (& (Join-Path $PSScriptRoot 'windows-icon.ps1') -Executable (Join-Path $source '控小助.exe') -Icon $brandIcon -VerifyOnly | Out-String) | ConvertFrom-Json
if (-not $iconVerification.Passed) { throw '应用内嵌图标核对失败。' }

if (-not $CompilerPath) { $CompilerPath = Join-Path $root '.cache\installer-toolchain\inno-setup-6.7.3\ISCC.exe' }
if (-not (Test-Path -LiteralPath $CompilerPath)) {
    if (-not $BootstrapCompiler) { throw '未找到编译器。请先运行 scripts/bootstrap-installer-toolchain.ps1，或指定 -CompilerPath。' }
    & (Join-Path $PSScriptRoot 'bootstrap-installer-toolchain.ps1') | Out-Null
}
if (-not (Test-Path -LiteralPath $CompilerPath)) { throw '找不到指定编译器。' }
$buildDirectory = Join-Path $root ".cache\installer-build\$Version"
New-Item -ItemType Directory -Path $buildDirectory -Force | Out-Null
$include = Join-Path $buildDirectory 'release-files.iss'
# Inno Setup 对 UTF-8 BOM 支持稳定；PowerShell 5.1/7 均显式写入。
[IO.File]::WriteAllLines($include, $lines, [Text.UTF8Encoding]::new($true))
$setupName = "控小助-$Version-安装包"
$output = Join-Path $releaseRoot ($setupName + '.exe')
if (Test-Path -LiteralPath $output) { throw "安装包已经存在，请保留旧文件并明确移动后再构建：$output" }
$arguments = @('/Qp', "/DAppVersion=$Version", "/DReleaseDirectory=$source", "/DReleaseInclude=$include", "/DOutputDirectory=$releaseRoot", "/DSetupFileName=$setupName", "/DBrandIconFile=$brandIcon", (Join-Path $PSScriptRoot 'installer\kongxiaozhu.iss'))
& $CompilerPath @arguments
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $output)) { throw "安装包编译失败：$LASTEXITCODE" }
$artifact = Get-Item -LiteralPath $output
$setupIconVerification = (& (Join-Path $PSScriptRoot 'windows-icon.ps1') -Executable $output -Icon $brandIcon -VerifyOnly -AllowOtherIcons | Out-String) | ConvertFrom-Json
if (-not $setupIconVerification.Passed) { throw '安装器内嵌图标核对失败。' }
$record = [ordered]@{
    app = $package.name
    version = $Version
    createdAt = [DateTime]::UtcNow.ToString('o')
    installer = $output
    bytes = $artifact.Length
    sha256 = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
    compiler = [ordered]@{
        path = [IO.Path]::GetFullPath($CompilerPath)
        version = if ([IO.Path]::GetFullPath($CompilerPath) -eq (Join-Path $root '.cache\installer-toolchain\inno-setup-6.7.3\ISCC.exe')) { '6.7.3' } else { (Get-Item -LiteralPath $CompilerPath).VersionInfo.FileVersion }
        sha256 = (Get-FileHash -LiteralPath $CompilerPath -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    releaseDirectory = $source
    releaseManifestSha256 = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
    verifiedPayloadFiles = @($manifest.files).Count + 1
    icon = [ordered]@{ sizes = $iconVerification.Sizes; applicationEmbedded = $true; installerEmbedded = $true; sha256 = (Get-FileHash -LiteralPath $brandIcon -Algorithm SHA256).Hash.ToLowerInvariant() }
    installerLifecycleTested = $false
}
$record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $releaseRoot "控小助-$Version-安装包.build.json") -Encoding utf8
$record | ConvertTo-Json
