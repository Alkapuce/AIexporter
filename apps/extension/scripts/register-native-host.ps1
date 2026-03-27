param(
  [string]$ExtensionId = "mllibebijafamehilmldnodfkkimmpdf"
)

$ErrorActionPreference = "Stop"

$hostName = "com.aiexporter.shell"
$nativeHostDir = Split-Path -Parent $MyInvocation.MyCommand.Path | Join-Path -ChildPath "..\\native-host"
$nativeHostDir = [System.IO.Path]::GetFullPath($nativeHostDir)
$manifestPath = Join-Path $nativeHostDir "manifest.json"
$hostCmdPath = Join-Path $nativeHostDir "host.cmd"

if (-not (Test-Path $hostCmdPath)) {
  throw "Native host launcher not found: $hostCmdPath"
}

$manifest = @{
  name = $hostName
  description = "AIexporter shell bridge"
  path = $hostCmdPath
  type = "stdio"
  allowed_origins = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json -Depth 4

Set-Content -Path $manifestPath -Value $manifest -Encoding UTF8

$registryPath = "HKCU:\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\$hostName"
New-Item -Path $registryPath -Force | Out-Null
Set-ItemProperty -Path $registryPath -Name "(default)" -Value $manifestPath

Write-Host "Registered native host $hostName for $ExtensionId"
Write-Host "Manifest: $manifestPath"
