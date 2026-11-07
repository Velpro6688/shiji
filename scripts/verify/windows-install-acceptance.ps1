param([Parameter(Mandatory=$true)][string]$Installer,[string]$BaselineInstaller,[string]$Output='C:\ShijiAcceptance\results')
$ErrorActionPreference='Stop'
if($env:HB_DISPOSABLE_WINDOWS -ne '1'){throw '仅允许在 Windows Sandbox 或一次性虚拟机中执行。请在隔离系统中显式设置 HB_DISPOSABLE_WINDOWS=1。'}
$target='C:\ShijiAcceptance\App'
$resolved=[IO.Path]::GetFullPath($target)
if($resolved -ne 'C:\ShijiAcceptance\App'){throw '验收目录不符合固定安全边界'}
New-Item -ItemType Directory -Path $target,$Output -Force | Out-Null
$steps=[Collections.Generic.List[string]]::new()
function Install-Package([string]$File){
  $process=Start-Process -FilePath $File -ArgumentList @('/S',"/D=$target") -Wait -PassThru -WindowStyle Hidden
  if($process.ExitCode -ne 0){throw "安装失败：$($process.ExitCode)"}
  if(!(Test-Path -LiteralPath "$target\时迹.exe")){throw '安装后缺少主程序'}
}
try{
  if($BaselineInstaller){Install-Package $BaselineInstaller;$steps.Add('旧版安装成功')}
  New-Item -ItemType Directory -Path "$target\data","$env:APPDATA\habit-lab" -Force | Out-Null
  Set-Content -LiteralPath "$target\data\acceptance-sentinel.txt" -Value 'portable-data-must-survive'
  Set-Content -LiteralPath "$target\unknown-user-file.txt" -Value 'unknown-file-must-survive'
  Set-Content -LiteralPath "$env:APPDATA\habit-lab\acceptance-sentinel.txt" -Value 'default-data-must-survive'
  $sample='{"days":{"2026-10-14":{"h":true}},"habits":[{"key":"h","name":"acceptance","type":"bool"}],"meta":{"version":2}}'
  Set-Content -LiteralPath "$target\data\data.json" -Value $sample -Encoding utf8
  Set-Content -LiteralPath "$env:APPDATA\habit-lab\data.json" -Value $sample -Encoding utf8
  $preservedFiles=@("$target\data\acceptance-sentinel.txt","$target\unknown-user-file.txt","$env:APPDATA\habit-lab\acceptance-sentinel.txt","$target\data\data.json","$env:APPDATA\habit-lab\data.json")
  $hashes=@{};foreach($file in $preservedFiles){$hashes[$file]=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash}
  Install-Package $Installer;$steps.Add('新版静默安装成功')
  if(!(Test-Path -LiteralPath "$target\resources\app.asar")){throw '缺少程序归档'}
  $version=(Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\时迹').DisplayVersion
  if(!$version){throw '卸载注册信息缺失'}
  $steps.Add("版本注册成功：$version")
  Install-Package $Installer;$steps.Add('重复安装 / 覆盖升级成功')
  $uninstall=Start-Process -FilePath "$target\uninst.exe" -ArgumentList @('/S',"_?=$target") -Wait -PassThru -WindowStyle Hidden
  if($uninstall.ExitCode -ne 0){throw "卸载失败：$($uninstall.ExitCode)"}
  foreach($file in $preservedFiles){
    if(!(Test-Path -LiteralPath $file)){throw "卸载误删数据：$file"}
    if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $hashes[$file]){throw "升级或卸载改变了数据：$file"}
  }
  if(Test-Path -LiteralPath "$target\时迹.exe"){throw '卸载后主程序残留'}
  $steps.Add('静默卸载保留便携数据、默认存档和未知用户文件')
  @{ok=$true;steps=$steps;version=$version;ts=(Get-Date).ToString('o')} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath "$Output\install-result.json" -Encoding utf8
}catch{
  @{ok=$false;steps=$steps;error=$_.Exception.Message;ts=(Get-Date).ToString('o')} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath "$Output\install-result.json" -Encoding utf8
  throw
}
