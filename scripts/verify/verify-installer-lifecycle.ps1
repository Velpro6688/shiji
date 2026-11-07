[CmdletBinding()]
param([string]$ReuseRunId='', [switch]$FastCompression)

$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$runId=if($ReuseRunId){$ReuseRunId}else{'lifecycle-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff')}
$appName='时迹验证-'+$runId
$work=Join-Path $root ('artifacts/installer-lifecycle-'+$runId)
$target=Join-Path $work 'installed'
$dataDir=Join-Path $work 'user-data'
$desktop=[Environment]::GetFolderPath('Desktop')
$programs=[Environment]::GetFolderPath('Programs')
$desktopLink=Join-Path $desktop ($appName+'.lnk')
$startMenu=Join-Path $programs $appName
$startAppLink=Join-Path $startMenu ($appName+'.lnk')
$startUninstallLink=Join-Path $startMenu ('卸载 '+$appName+'.lnk')
$regPath='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\'+$appName
$compiler=Join-Path $env:LOCALAPPDATA 'electron-builder/Cache/nsis/nsis-3.0.4.1/Bin/makensis.exe'
$result=[ordered]@{ok=$false;runId=$runId;appName=$appName;steps=@();officialInstallTouched=$false;physicalDisplays=$null;error=$null}
function Step([string]$name){$result.steps+=$name;Write-Host ('PASS '+$name)}
function Assert([bool]$condition,[string]$name){if(!$condition){throw $name};Step $name}
function Invoke-Installer([string]$exe){
  $process=Start-Process -FilePath $exe -ArgumentList '/S',('/D='+$target) -Wait -PassThru -WindowStyle Hidden
  return $process.ExitCode
}
function Build-TestInstaller([string]$version){
  $stage=Join-Path $root ('artifacts/installer-staging-'+$version)
  $script=Join-Path $stage ('installer-test-'+$runId+'.nsi')
  $outName=$appName+'-'+$version+'-Setup.exe'
  $text=Get-Content -LiteralPath (Join-Path $stage 'installer.nsi') -Raw -Encoding UTF8
  if($FastCompression){$text=$text.Replace('SetCompressor /SOLID lzma','SetCompressor zlib');$text=[regex]::Replace($text,'(?m)^SetCompressorDictSize .*\r?\n','')}
  $text=[regex]::Replace($text,'!define APP_NAME\s+"[^"]+"','!define APP_NAME      "'+$appName+'"')
  $text=[regex]::Replace($text,'!define APP_VERSION\s+"[^"]+"','!define APP_VERSION   "'+$version+'"')
  $text=[regex]::Replace($text,'!define DATA_DIR\s+"[^"]+"','!define DATA_DIR      "'+$dataDir+'"')
  $text=[regex]::Replace($text,'OutFile\s+"[^"]+"','OutFile           "'+$outName+'"')
  [IO.File]::WriteAllText($script,$text,(New-Object Text.UTF8Encoding($true)))
  $compile=Start-Process -FilePath $compiler -ArgumentList @('/V2',$script) -WorkingDirectory $stage -Wait -PassThru -WindowStyle Hidden
  if($compile.ExitCode -ne 0){throw "NSIS compile failed: $version"}
  $out=Join-Path $stage $outName
  if(!(Test-Path -LiteralPath $out)){throw "Test installer missing: $out"}
  return $out
}
try{
  New-Item -ItemType Directory -Path $work -Force | Out-Null
  foreach($path in @($desktopLink,$startMenu,$regPath,$target,$dataDir)){
    if(Test-Path -LiteralPath $path){throw "Isolation collision: $path"}
  }
  if(!(Test-Path -LiteralPath $compiler)){throw "NSIS compiler missing: $compiler"}
  if($ReuseRunId){
    $v300=Join-Path $root ('artifacts/installer-staging-3.1.4/'+$appName+'-3.1.4-Setup.exe')
    $v301=Join-Path $root ('artifacts/installer-staging-1.0.0/'+$appName+'-1.0.0-Setup.exe')
    if(!(Test-Path -LiteralPath $v300) -or !(Test-Path -LiteralPath $v301)){throw 'Requested isolated installers are missing'}
    Step 'reused isolated 3.1.4 and 1.0.0 installers compiled from the same production NSIS scripts'
  }else{
    $v300=Build-TestInstaller '3.1.4'
    $v301=Build-TestInstaller '1.0.0'
    Step 'isolated 3.1.4 and 1.0.0 installers compiled from the same production NSIS scripts'
  }

  $code=Invoke-Installer $v300
  Assert ($code -eq 0) '3.1.4 silent installation exits successfully'
  Assert (Test-Path -LiteralPath (Join-Path $target '时迹.exe')) '3.1.4 executable installed'
  Assert (Test-Path -LiteralPath (Join-Path $target 'resources/app.asar')) '3.1.4 application archive installed'
  Assert (Test-Path -LiteralPath (Join-Path $target 'uninst.exe')) 'uninstaller installed'
  Assert ((Get-ItemProperty -LiteralPath $regPath).DisplayVersion -eq '3.1.4') '3.1.4 uninstall registry has the correct version'
  Assert (Test-Path -LiteralPath $desktopLink) 'desktop shortcut created'
  Assert (Test-Path -LiteralPath $startAppLink) 'start menu application shortcut created'
  Assert (Test-Path -LiteralPath $startUninstallLink) 'start menu uninstall shortcut created'

  New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $dataDir 'preserve.marker'),'keep',[Text.Encoding]::UTF8)
  $testData=Join-Path $dataDir 'data.json'
  [IO.File]::WriteAllText($testData,'{"profile":{"name":"Test"},"memoNotes":[{"id":"upgrade-note","text":"preserve this note"}]}',[Text.Encoding]::UTF8)
  $dataHash=(Get-FileHash -LiteralPath $testData -Algorithm SHA256).Hash
  $code=Invoke-Installer $v301
  Assert ($code -eq 0) '1.0.0 silent upgrade exits successfully'
  Assert ((Get-ItemProperty -LiteralPath $regPath).DisplayVersion -eq '1.0.0') 'upgrade updates uninstall registry to 1.0.0'
  Assert ((Get-FileHash -LiteralPath (Join-Path $target 'resources/app.asar') -Algorithm SHA256).Hash -eq (Get-FileHash -LiteralPath (Join-Path $root 'artifacts/portable-staging-1.0.0/win-unpacked/resources/app.asar') -Algorithm SHA256).Hash) 'upgrade installs the verified 1.0.0 application archive'
  Assert (Test-Path -LiteralPath (Join-Path $dataDir 'preserve.marker')) 'upgrade preserves user data'
  Assert ((Get-FileHash -LiteralPath $testData -Algorithm SHA256).Hash -eq $dataHash) 'upgrade preserves exact test note data bytes'

  [IO.File]::WriteAllText((Join-Path $target 'user-keep.txt'),'preserve',[Text.Encoding]::UTF8)
  $process=Start-Process -FilePath (Join-Path $target 'uninst.exe') -ArgumentList '/S' -Wait -PassThru -WindowStyle Hidden
  Assert ($process.ExitCode -eq 0) 'silent uninstall exits successfully'
  for($i=0;$i -lt 40 -and (Test-Path -LiteralPath $regPath);$i++){Start-Sleep -Milliseconds 250}
  Assert (!(Test-Path -LiteralPath $regPath)) 'uninstall removes registry entry'
  Assert (!(Test-Path -LiteralPath $desktopLink)) 'uninstall removes desktop shortcut'
  Assert (!(Test-Path -LiteralPath $startMenu)) 'uninstall removes start menu folder and shortcuts'
  Assert (!(Test-Path -LiteralPath (Join-Path $target '时迹.exe'))) 'uninstall removes installed executable'
  Assert (!(Test-Path -LiteralPath (Join-Path $target 'resources/app.asar'))) 'uninstall removes application archive'
  Assert (Test-Path -LiteralPath (Join-Path $target 'user-keep.txt')) 'uninstall preserves unknown files in the installation directory'
  Assert (Test-Path -LiteralPath (Join-Path $dataDir 'preserve.marker')) 'silent uninstall preserves user data by default'
  Assert ((Get-FileHash -LiteralPath $testData -Algorithm SHA256).Hash -eq $dataHash) 'uninstall preserves exact test note data bytes'
  $result.ok=$true
}catch{
  $result.error=$_.Exception.Message
  Write-Error $_
}finally{
  try{
    foreach($path in @($desktopLink,$startMenu,$regPath)){
      if(Test-Path -LiteralPath $path){
        if($path -eq $regPath){Remove-Item -LiteralPath $path -Recurse -Force}
        elseif((Get-Item -LiteralPath $path).PSIsContainer){Remove-Item -LiteralPath $path -Recurse -Force}
        else{Remove-Item -LiteralPath $path -Force}
      }
    }
    foreach($path in @($target,$dataDir)){
      $full=[IO.Path]::GetFullPath($path)
      if($full.StartsWith([IO.Path]::GetFullPath($work)+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $full)){
        Remove-Item -LiteralPath $full -Recurse -Force
      }
    }
    if(Test-Path -LiteralPath $work){Remove-Item -LiteralPath $work -Recurse -Force}
    foreach($version in @('3.1.4','1.0.0')){
      $stage=Join-Path $root ('artifacts/installer-staging-'+$version)
      foreach($file in @((Join-Path $stage ($appName+'-'+$version+'-Setup.exe')),(Join-Path $stage ('installer-test-'+$runId+'.nsi')))){
        if(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file -Force}
      }
    }
  }catch{
    $result.cleanupError=$_.Exception.Message
  }
  $reportDir=Join-Path $root 'artifacts/verification/1.0.0'
  $result.root=$root
  $result.work=$work
  $result.reportDir=$reportDir
  try{
    [IO.Directory]::CreateDirectory($reportDir) | Out-Null
    $result.reportDirExists=[IO.Directory]::Exists($reportDir)
    [IO.File]::WriteAllText((Join-Path $reportDir 'installer-lifecycle-result.json'),($result | ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))
  }catch{
    $result.reportError=$_.Exception.Message
    [IO.File]::WriteAllText((Join-Path $root 'installer-lifecycle-result.json'),($result | ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))
  }
}
$result | ConvertTo-Json -Depth 5
if(!$result.ok){exit 1}
