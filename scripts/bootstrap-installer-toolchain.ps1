param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$version = '6.7.3'
$expectedHash = '9c73c3bae7ed48d44112a0f48e66742c00090bdb5bef71d9d3c056c66e97b732'
$url = "https://github.com/jrsoftware/issrc/releases/download/is-6_7_3/innosetup-$version.exe"
$cache = Join-Path $root '.cache\installer-toolchain'
$destination = Join-Path $cache "inno-setup-$version"
$compiler = Join-Path $destination 'ISCC.exe'
$download = Join-Path $cache "innosetup-$version.exe"
$language = Join-Path $destination 'Languages\ChineseSimplified.isl'
$languageUrl = 'https://raw.githubusercontent.com/jrsoftware/issrc/6ef32198ef1f7b7b375cd4b6b90896c2a58eb4c2/Files/Languages/ChineseSimplified.isl'
$languageHash = 'e0b0b350e2245f3c5e65586dfe43d574f6e7f06f2261149aba284954b3fc9a8d'
New-Item -ItemType Directory -Path $cache -Force | Out-Null

if (-not (Test-Path -LiteralPath $download)) {
    Invoke-WebRequest -Uri $url -OutFile $download
}
if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ne $expectedHash) {
    throw '官方编译器下载文件 SHA-256 不匹配，未执行。请检查缓存文件。'
}
$signature = Get-AuthenticodeSignature -LiteralPath $download
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Pyrsys B\.V\.') {
    throw "官方编译器数字签名验证失败：$($signature.Status)，未执行。"
}

if (-not (Test-Path -LiteralPath $compiler)) {
    if (Test-Path -LiteralPath $destination) { throw '编译器目录已经存在但不完整，请人工检查后重试。' }
    $arguments = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/CURRENTUSER', '/NOICONS', '/TASKS=""', "/DIR=`"$destination`"")
    $process = Start-Process -FilePath $download -ArgumentList $arguments -PassThru -Wait -WindowStyle Hidden
    if ($process.ExitCode -ne 0) { throw "Inno Setup 安装失败，退出码 $($process.ExitCode)。" }
}
if (-not (Test-Path -LiteralPath $language)) {
    Invoke-WebRequest -Uri $languageUrl -OutFile $language
}
if ((Get-FileHash -LiteralPath $language -Algorithm SHA256).Hash -ne $languageHash) {
    throw '官方中文语言文件 SHA-256 不匹配。'
}
if (-not (Test-Path -LiteralPath $compiler)) {
    throw '编译器或中文语言文件缺失。'
}
$record = [ordered]@{
    version = $version
    source = $url
    sha256 = $expectedHash
    signatureStatus = [string]$signature.Status
    signer = $signature.SignerCertificate.Subject
    languageSource = $languageUrl
    languageSha256 = $languageHash
    compiler = $compiler
    verifiedAt = [DateTime]::UtcNow.ToString('o')
}
$record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $cache 'toolchain-verification.json') -Encoding utf8
Write-Output $compiler
