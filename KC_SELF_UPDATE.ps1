param([Parameter(Mandatory=$true)][string]$Root,[int]$Port=8765)
$ErrorActionPreference='Stop'
$zip=Join-Path $env:TEMP ("kc-system-check-"+[guid]::NewGuid().ToString("N")+".zip")
$tmp=Join-Path $env:TEMP ("kc-system-check-"+[guid]::NewGuid().ToString("N"))
try {
  Start-Sleep -Seconds 2
  Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/Sire65/KC-System-Check/archive/refs/heads/main.zip' -OutFile $zip
  Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
  $src=Join-Path $tmp 'KC-System-Check-main'
  if(-not (Test-Path (Join-Path $src 'version.json'))){throw 'Updatepaket unvollstaendig'}
  $preserve=@('.env','config.local.json')
  Get-ChildItem -LiteralPath $src -Force | ForEach-Object {
    if($preserve -contains $_.Name){return}
    $dest=Join-Path $Root $_.Name
    if($_.PSIsContainer){Copy-Item -LiteralPath $_.FullName -Destination $dest -Recurse -Force}
    else{Copy-Item -LiteralPath $_.FullName -Destination $dest -Force}
  }
  Start-Process powershell.exe -WorkingDirectory $Root -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + (Join-Path $Root 'KC_LOCAL_SERVER.ps1') + '"'))
} catch {
  Add-Type -AssemblyName PresentationFramework -ErrorAction SilentlyContinue
  [System.Windows.MessageBox]::Show("KC System Check Update fehlgeschlagen:`n"+$_.Exception.Message,'KC Update') | Out-Null
} finally {
  Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
