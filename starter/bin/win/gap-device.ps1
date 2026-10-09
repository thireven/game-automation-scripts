# Host-side device operations for Windows. Dot-sourced by gap.ps1 and
# gap-menu.ps1.
#
# Everything specific to *this machine* lives here. The launch algorithm does
# not: that is device/gap-service.sh, running on the device, and this file only
# pushes and invokes it. See device/PROTOCOL.md.

$global:Package     = 'com.generalautomation.platform'
$global:StageDir    = '/data/local/tmp/gap'
# Beside the stage dir, not in it: /data/local/tmp is the adb shell's own
# on every Android, while a rooted device's app makes the stage dir root's.
$global:DeviceScript= '/data/local/tmp/gap-service.sh'
$global:ProtoWant   = '1'

# The folder the app owns on shared storage: Config.Storage.PARENT plus FOLDER
# in the app source, which tools/build-starter.sh gates this literal against.
# It is not a protocol key -- copying and deleting a script's own files needs
# neither root nor the device script. A service started with --root=PATH needs
# GAP_STORAGE_ROOT set to the same path.
$global:DeviceStorage = if ($env:GAP_STORAGE_ROOT) { $env:GAP_STORAGE_ROOT }
                        else { '/sdcard/Download/GeneralAutomationPlatform' }

# Where `update` looks for the published APKs. /releases/latest/download/ is a
# plain redirect to the newest non-draft release, so the asset names have to be
# stable -- tools/package-release.sh uploads gap-<abi>.apk beside the stamped
# ones for exactly this. No api.github.com, so no rate limit to hit.
$global:DefaultReleaseBase = 'https://github.com/game-automation-platform/game-automation-catalogue/releases/latest/download'
$global:ManifestName = 'gap-latest.txt'

# A pre-release channel: one line in channel.txt, the folder URL that holds a
# tester build's gap-latest.txt and APKs. -Channel URL writes it, -Channel off
# deletes it, and GAP_RELEASE_BASE still wins over both. Twin of the POSIX
# set_channel; same shape as last-device.txt.
$global:ChannelFile = Join-Path $Bundle 'channel.txt'

function Get-SavedChannel {
  if (Test-Path -LiteralPath $global:ChannelFile) {
    return ((Get-Content -LiteralPath $global:ChannelFile -TotalCount 1) | Out-String).Trim()
  }
  return ''
}

$global:ReleaseBase = if ($env:GAP_RELEASE_BASE) { $env:GAP_RELEASE_BASE } else { Get-SavedChannel }
if (-not $global:ReleaseBase) { $global:ReleaseBase = $global:DefaultReleaseBase }

function Test-ChannelActive { return $global:ReleaseBase -ne $global:DefaultReleaseBase }

# The folder a URL names: a trailing .json or .txt is dropped (the manifest sits
# beside the catalogue), and a query string is refused.
function Get-ChannelFolder {
  param([string]$Url)
  $u = $Url.TrimEnd('/')
  if ($u -notmatch '^https?://[^/?#]+/[^?#]+$') { return $null }
  if ($u -match '\.(json|txt)$') { $u = $u.Substring(0, $u.LastIndexOf('/')) }
  return $u
}

# A channel.txt written by hand, or by an older build, may hold the catalogue
# address (.../alpha.json); read it as the folder it sits in.
$folder = Get-ChannelFolder $global:ReleaseBase
if ($folder) { $global:ReleaseBase = $folder }

# Pins the channel, or with 'off' returns to the release page. $true on success.
function Set-Channel {
  param([string]$Url)
  if ($Url -eq 'off') {
    Remove-Item -LiteralPath $global:ChannelFile -ErrorAction SilentlyContinue
    $global:ReleaseBase = $global:DefaultReleaseBase
    Write-Host 'release channel: back to the published releases'
    return $true
  }
  $folder = Get-ChannelFolder -Url $Url
  if (-not $folder) {
    Write-Host 'error: -Channel takes an http(s) folder URL with no ?query, or off.'
    return $false
  }
  Set-Content -LiteralPath $global:ChannelFile -Value $folder
  $global:ReleaseBase = $folder
  Write-Host "release channel: $folder (kept in channel.txt; -Channel off undoes it)"
  return $true
}

# The device chosen in the menu last time, so the same emulator is not picked
# again on every run. One line, its serial, beside the README where a person
# can see it and delete it. The menu writes it on every pick and reads it on
# start; the command line reads it when several devices are connected and
# -Serial names none.
$global:LastDeviceName = 'last-device.txt'

$global:Adb         = $null
$global:AdbSource   = ''
$global:AdbWarning  = ''

# Commentary goes straight to the terminal, which is also the log pane.
function Write-Log {
  param([string]$Text)
  Write-Host $Text
}

# ---------------------------------------------------------------------- adb

# PowerShell 5.1 mangles arguments to native commands -- quotes and trailing
# backslashes especially -- and the bundle path routinely contains spaces. So
# every adb call is built through one quoting helper and run through
# System.Diagnostics.Process rather than the shell.
function Format-NativeArgs {
  param([string[]]$Arguments)
  $parts = foreach ($a in $Arguments) {
    if ($a -eq $null) { continue }
    if ($a.Length -gt 0 -and $a -notmatch '[\s"]') {
      $a
    } else {
      # Double any backslashes that precede the closing quote, then escape
      # embedded quotes -- the CommandLineToArgvW rules.
      $e = $a -replace '(\\*)"', '$1$1\"'
      $e = $e -replace '(\\+)$', '$1$1'
      '"' + $e + '"'
    }
  }
  return ($parts -join ' ')
}

function Invoke-Adb {
  param([string[]]$Arguments, [int]$TimeoutMs = 120000)

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName               = $global:Adb
  $psi.Arguments              = Format-NativeArgs $Arguments
  $psi.UseShellExecute        = $false
  # stdin too, closed at once: `adb shell` reads it otherwise, and an answer
  # typed while a scan runs would be swallowed instead of reaching the menu's
  # next prompt. The POSIX twin's </dev/null.
  $psi.RedirectStandardInput  = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError  = $true
  $psi.CreateNoWindow         = $true

  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi
  try { [void]$p.Start() } catch {
    return [pscustomobject]@{ Out = ''; Err = $_.Exception.Message; Code = -1 }
  }
  $p.StandardInput.Close()
  # Read both streams asynchronously; reading one to the end while the other
  # fills its buffer is the classic way to deadlock a redirected child.
  $so = $p.StandardOutput.ReadToEndAsync()
  $se = $p.StandardError.ReadToEndAsync()
  if (-not $p.WaitForExit($TimeoutMs)) {
    try { $p.Kill() } catch { }
    return [pscustomobject]@{ Out = ''; Err = 'timed out'; Code = -2 }
  }
  [pscustomobject]@{
    # adb line endings vary by transport; strip CR once, here, for everyone.
    Out  = ($so.Result -replace "`r", '')
    Err  = ($se.Result -replace "`r", '')
    Code = $p.ExitCode
  }
}

function Get-AdbRevision {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return 0 }
  try {
    $out = & $Path version 2>$null | Out-String
  } catch { return 0 }
  # -cmatch, anchored: `adb version` opens with "Android Debug Bridge version
  # 1.0.41", and the case-insensitive -match would read that as revision 1 for
  # every adb ever built -- making the comparison below always a tie.
  if ($out -cmatch '(?m)^Version\s+(\d+)\.') { return [int]$Matches[1] }
  return 0
}

# The bundle carries no adb. platform-tools.txt beside the README says where
# Google publishes it and what the archive must hash to; the first run
# downloads it into adb\windows\, and every run after that finds it there.
function Get-PlatformToolsPin {
  param([string]$Bundle, [string]$Key)
  $f = Join-Path $Bundle 'platform-tools.txt'
  if (-not (Test-Path -LiteralPath $f)) { return '' }
  try { return (Get-Kv (Get-Content -LiteralPath $f -Raw) $Key) } catch { return '' }
}

# What has to come out of the archive for adb to run. adb.exe is a 32-bit
# MinGW build, which is why libwinpthread-1.dll travels with it.
$global:AdbMembers = @('adb.exe', 'AdbWinApi.dll', 'AdbWinUsbApi.dll',
                       'libwinpthread-1.dll', 'NOTICE.txt')

# Prefer the user's own adb when it is at least as new as ours. Two adb clients
# of different versions cannot share one server -- the newer kills the older's
# server and restarts it, yanking the device out from under Android Studio or
# scrcpy. Using theirs when it is new enough means that never happens -- and
# means a machine that already has a current adb never downloads one.
function Resolve-Adb {
  param([string]$Bundle)

  $own    = Join-Path $Bundle 'adb\windows\adb.exe'
  $ownRev = Get-AdbRevision $own
  # Nothing downloaded yet: measure theirs against what would be.
  if ($ownRev -le 0) {
    $pin = Get-PlatformToolsPin -Bundle $Bundle -Key 'revision'
    if ($pin -match '^(\d+)\.') { $ownRev = [int]$Matches[1] }
  }

  if ($env:GAP_ADB -and (Test-Path -LiteralPath $env:GAP_ADB)) {
    $global:Adb = $env:GAP_ADB; $global:AdbSource = 'GAP_ADB'; return $true
  }

  $global:OlderAdb = ''
  $candidates = @()
  $onPath = Get-Command adb.exe -ErrorAction SilentlyContinue
  if ($onPath) { $candidates += $onPath.Source }
  foreach ($root in @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT,
                      "$env:LOCALAPPDATA\Android\Sdk")) {
    if ($root) { $candidates += (Join-Path $root 'platform-tools\adb.exe') }
  }
  foreach ($c in $candidates) {
    if (-not $c -or -not (Test-Path -LiteralPath $c)) { continue }
    $rev = Get-AdbRevision $c
    if ($rev -ge $ownRev -and $rev -gt 0) {
      $global:Adb = $c; $global:AdbSource = "system r$rev"; return $true
    }
    if ($rev -gt 0) { $global:OlderAdb = "$c (r$rev)" }
  }

  if (-not (Test-Path -LiteralPath $own)) {
    if (-not (Get-PlatformToolsAdb -Bundle $Bundle)) { return $false }
    $ownRev = Get-AdbRevision $own
  }
  $global:Adb = $own; $global:AdbSource = "downloaded r$ownRev"
  return $true
}

# Fetch Google's platform-tools into adb\windows\ and keep adb out of it.
# Asks first: it is the one thing this tool ever downloads without being
# told to. -Yes answers for a caller with no console.
function Get-PlatformToolsAdb {
  param([string]$Bundle)

  # Nothing half-done is left behind, not even the empty folder.
  function Remove-AdbDownload {
    param([string]$Dir)
    Remove-Item -LiteralPath $Dir -Recurse -Force -ErrorAction SilentlyContinue
    try { [IO.Directory]::Delete((Split-Path -Parent $Dir)) } catch { }
  }

  $url  = Get-PlatformToolsPin -Bundle $Bundle -Key 'url_windows'
  $want = Get-PlatformToolsPin -Bundle $Bundle -Key 'sha256_windows'
  $size = Get-PlatformToolsPin -Bundle $Bundle -Key 'size_windows'
  $rev  = Get-PlatformToolsPin -Bundle $Bundle -Key 'revision'
  $dir  = Join-Path $Bundle 'adb\windows'

  if (-not $url -or -not $want) {
    Write-Log "error: no adb found, and $(Join-Path $Bundle 'platform-tools.txt')"
    Write-Log '  does not say where to download one for Windows. Re-extract the bundle, or set'
    Write-Log '  GAP_ADB to the full path of an adb you have.'
    return $false
  }

  $mb = 0
  if ($size -match '^\d+$') { $mb = [int][math]::Round([double]$size / 1MB) }
  Write-Log "This tool needs Google's adb, and none is in this folder yet."
  Write-Log "  fetch : $url"
  if ($mb -gt 0) { Write-Log "  size  : about $mb MB" }
  Write-Log "  into  : $dir"
  Write-Log '  check : sha256 from platform-tools.txt, recorded when this tool was built'
  Write-Log 'Only adb is kept out of the archive; the rest is deleted.'
  if ($global:OlderAdb) {
    Write-Log "(An older adb is on this computer, $($global:OlderAdb) -- this tool wants r$rev or newer. Set GAP_ADB to use it anyway.)"
  }
  if (-not ($global:AssumeYes -or $env:GAP_ASSUME_YES -eq '1')) {
    try {
      $ans = Read-Host "`n  download it now? [Y/n]"
    } catch {
      Write-Log 'Refusing to download without a confirmation -- add -Yes, or set GAP_ADB.'
      return $false
    }
    if ($ans -notmatch '^(|y|yes)$') {
      Write-Log 'Nothing was downloaded. Set GAP_ADB to the full path of an adb you have, or run this again.'
      return $false
    }
  }

  try { New-Item -ItemType Directory -Force -Path $dir | Out-Null } catch {
    Write-Log "error: cannot write into $dir."
    Write-Log '  Move this folder somewhere you can write to (Downloads, Desktop), or set GAP_ADB.'
    return $false
  }
  $zip = Join-Path $dir 'platform-tools.zip'
  Write-Log "downloading platform-tools r$rev ..."
  if (-not (Get-UrlToFile -Url $url -Dest $zip)) {
    Remove-AdbDownload $dir
    Write-Log 'Could not download it. Check the internet connection, or set GAP_ADB to the'
    Write-Log 'full path of an adb you have.'
    return $false
  }

  # Fail closed: this is a program about to be run, not a file to be looked at.
  if ((Get-Sha256 $zip) -ne $want) {
    Remove-AdbDownload $dir
    Write-Log 'The download did not match its checksum and was deleted. Nothing was kept.'
    Write-Log 'Try again; if it keeps failing, get the newest gap-starter-scripts bundle --'
    Write-Log 'the pin in platform-tools.txt may be stale.'
    return $false
  }
  Write-Log '  sha256 ok'

  # Only the named members, straight out of the archive: .NET's ZipFile is on
  # every PowerShell this runs on, and Expand-Archive would unpack fastboot
  # and friends only for them to be deleted.
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $z = [IO.Compression.ZipFile]::OpenRead($zip)
    try {
      foreach ($m in $global:AdbMembers) {
        $e = $z.GetEntry("platform-tools/$m")
        if (-not $e) { throw "the archive had no $m in it" }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($e, (Join-Path $dir $m), $true)
      }
    } finally { $z.Dispose() }
  } catch {
    Remove-AdbDownload $dir
    Write-Log "error: could not unpack it -- $($_.Exception.Message). Nothing was kept."
    Write-Log '  Set GAP_ADB to the full path of an adb you have.'
    return $false
  }
  Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
  # Files out of a zip carry no Mark-of-the-Web, but this costs nothing.
  Get-ChildItem -LiteralPath $dir | Unblock-File -ErrorAction SilentlyContinue
  Write-Log "  adb r$(Get-AdbRevision (Join-Path $dir 'adb.exe')) is ready in adb\windows"
  return $true
}

function Start-AdbServer {
  $r = Invoke-Adb @('start-server')
  if ($r.Err -match "killing|doesn't match") {
    $global:AdbWarning = "Replaced the running ADB server with $($global:AdbSource). " +
      'Android Studio, scrcpy or your emulator manager may briefly lose the device -- they reconnect automatically.'
  }
  # Never `adb kill-server` on exit: leaving a working server behind is
  # strictly better than tearing down the user's other tools.
}

# ------------------------------------------------------- the remembered device

function Get-RememberedDevice {
  param([string]$Bundle)
  $f = Join-Path $Bundle $global:LastDeviceName
  if (-not (Test-Path -LiteralPath $f)) { return '' }
  try { return ((Get-Content -LiteralPath $f -TotalCount 1) -join '').Trim() } catch { return '' }
}

# Best effort: a bundle on read-only media just forgets between runs.
# WriteAllText, not Set-Content: no BOM, so Start-Linux.sh under Git Bash reads
# the same file back.
function Set-RememberedDevice {
  param([string]$Bundle, [string]$Serial)
  try { [IO.File]::WriteAllText((Join-Path $Bundle $global:LastDeviceName), "$Serial`n") } catch { }
}

# ----------------------------------------------------------------- discovery

# An emulator never registers itself with adb: it is a plain TCP endpoint that
# has to be connected to by port. Every family numbers its instances, so
# probing one port per family finds instance 0 and nothing else -- which is why
# a second emulator seems invisible and has to be installed to by hand.
#
#   MuMu 12/Nx  16384 + 32*i, and 5555 + 2*i
#   LDPlayer     5555 + 2*i
#   Nox         62001, then 62025 + i
#   MEmu        21503 + 10*i
#
# 7555 is MuMu's legacy port and every instance claims it, so the first one
# started binds it and the rest silently do not -- it can never stand in for a
# per-instance port. Four instances per family is the practical ceiling.
$global:EmuPorts = @(
  16384, 16416, 16448, 16480,   # MuMu
  7555,                         # MuMu legacy, whichever instance won it
  5555, 5557, 5559, 5561,       # LDPlayer, and MuMu's second port
  62001, 62025, 62026, 62027,   # Nox
  21503, 21513, 21523           # MEmu
)

# Knock on the port first with a 200 ms TCP probe and only run `adb connect`
# where something answers. A closed port refuses instantly, but an open port
# belonging to something that is not adb can stall the handshake for seconds,
# and that is exactly what makes a Refresh feel broken.
function Test-TcpPort {
  param([int]$Port, [int]$TimeoutMs = 200)
  $c = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $c.BeginConnect('127.0.0.1', $Port, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) { return $false }
    $c.EndConnect($iar)
    return $true
  } catch { return $false } finally { $c.Close() }
}

# An offline row is a connection whose adb handshake never finished: the port
# answered while the emulator's adbd did not (booting, wedged, restarting).
# adb never retries it, and `adb connect` on a serial already listed is a
# no-op -- so it sits in the server, which outlives this tool, and comes back
# on every Refresh looking like one more emulator. Kick those first: a port
# still open is dialed again below, a dead one just leaves. The kick is
# asynchronous, hence the short wait -- `adb connect` finding the corpse still
# listed would say "already connected" and dial nothing.
function Reset-OfflineDevices {
  $stale = @(Get-Devices | Where-Object { $_.State -eq 'offline' } | ForEach-Object { $_.Serial })
  if ($stale.Count -eq 0) { return }
  foreach ($s in $stale) { [void](Invoke-Adb @('-s', $s, 'reconnect') -TimeoutMs 8000) }
  for ($i = 0; $i -lt 10; $i++) {
    $left = @(Get-Devices | Where-Object { $_.State -eq 'offline' -and $stale -contains $_.Serial })
    if ($left.Count -eq 0) { break }
    Start-Sleep -Milliseconds 300
  }
}

function Connect-Emulators {
  Reset-OfflineDevices
  $ports = @($global:EmuPorts)
  if ($env:GAP_EXTRA_PORTS) {
    $ports += ($env:GAP_EXTRA_PORTS -split '[,\s]+' | Where-Object { $_ } | ForEach-Object { [int]$_ })
  }
  foreach ($p in $ports) {
    if (Test-TcpPort -Port $p) { [void](Invoke-Adb @('connect', "127.0.0.1:$p") -TimeoutMs 8000) }
  }
}

# Every state is kept -- unauthorized and offline devices are listed with the
# reason, because "no devices found" while the phone sits there plugged in is
# the most confusing thing this tool could say.
function Get-Devices {
  $r = Invoke-Adb @('devices', '-l')
  $rows = @()
  foreach ($line in ($r.Out -split "`n")) {
    $line = $line.Trim()
    if (-not $line -or $line -match '^List of devices') { continue }
    $f = $line -split '\s+'
    if ($f.Count -lt 2) { continue }
    $model = '-'
    foreach ($tok in $f) { if ($tok -like 'model:*') { $model = $tok.Substring(6) -replace '_', ' ' } }
    $rows += [pscustomobject]@{ Serial = $f[0]; State = $f[1]; Model = $model }
  }
  return $rows
}

# One emulator can listen on several ports and shows up once per port. boot_id
# is per running device and identical across its ports, so it collapses those
# without hiding a genuine second device. (tools/deploy.sh lines 87-100.)
function Merge-Duplicates {
  param($Rows)
  $seen = @{}
  $out = @()
  foreach ($row in $Rows) {
    if ($row.State -ne 'device') { $out += $row; continue }
    $r = Invoke-Adb @('-s', $row.Serial, 'shell', 'cat', '/proc/sys/kernel/random/boot_id') -TimeoutMs 10000
    $id = $r.Out.Trim()
    if (-not $id) { $id = $row.Serial }
    if ($seen.ContainsKey($id)) { continue }
    $seen[$id] = $true
    $out += $row
  }
  return $out
}

# -------------------------------------------------------- the device protocol

function Invoke-Verb {
  param([string]$Serial, [string]$Verb, [string[]]$Flags = @(), [string]$Bundle)

  $local = Join-Path $Bundle 'device\gap-service.sh'
  $push  = Invoke-Adb @('-s', $Serial, 'push', $local, $global:DeviceScript) -TimeoutMs 30000
  if ($push.Code -ne 0) {
    return "proto=$global:ProtoWant`nerr=push-failed`nmsg=could not push the device script to $Serial`nrc=1"
  }
  $cmd = "sh $global:DeviceScript $Verb $($Flags -join ' ')"
  $r = Invoke-Adb @('-s', $Serial, 'shell', $cmd) -TimeoutMs 90000
  return ($r.Out + $r.Err)
}

# Last occurrence wins, which is what makes `running` correct after a start:
# the device script emits it before and after the launch.
function Get-Kv {
  param([string]$Text, [string]$Key)
  $v = ''
  foreach ($line in ($Text -split "`n")) {
    if ($line -match "^$([regex]::Escape($Key))=(.*)$") { $v = $Matches[1] }
  }
  return $v.Trim()
}

function Get-KvAll {
  param([string]$Text, [string]$Key)
  $out = @()
  foreach ($line in ($Text -split "`n")) {
    if ($line -match "^$([regex]::Escape($Key))=(.*)$") { $out += $Matches[1].Trim() }
  }
  return $out
}

function Test-Proto {
  param([string]$Text)
  $got = Get-Kv $Text 'proto'
  if ($got -eq $global:ProtoWant) { return $true }
  Write-Log "error: device script speaks proto '$(if($got){$got}else{'none'})', this tool speaks $global:ProtoWant."
  Write-Log 'The bundle is inconsistent -- re-extract it.'
  return $false
}

function Get-LogBlock {
  param([string]$Text)
  $lines = $Text -split "`n"
  $keep = $false
  $out = @()
  foreach ($l in $lines) {
    if ($l -match '^---BEGIN service\.log---') { $keep = $true; continue }
    if ($l -match '^---END service\.log---')   { $keep = $false; continue }
    if ($keep) { $out += $l }
  }
  return ($out -join "`n")
}

# ----------------------------------------------------------------- the APK

# An APK built for this ABI alone. The ABI is matched as a substring so the APK
# may be named anything; arm64-v8a is tried before armeabi-v7a so it never
# loses to it. Separate from Find-ApkFor because this is the only one that
# answers "is there a build this device can load".
function Find-ApkExact {
  param([string]$Abi, [string]$Bundle)
  $dir = Join-Path $Bundle 'apk'
  if (-not (Test-Path -LiteralPath $dir)) { return $null }
  $hit = Get-ChildItem -LiteralPath $dir -Filter "*$Abi*.apk" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($hit) { return $hit.FullName }
  return $null
}

# Best APK in apk\ for a device ABI. The fat APK is a fallback and never a
# match: installing it leaves the ABI to the device, and an emulator that
# translates ARM picks arm64 on x86_64 hardware.
function Find-ApkFor {
  param([string]$Abi, [string]$Bundle)
  $exact = Find-ApkExact -Abi $Abi -Bundle $Bundle
  if ($exact) { return $exact }
  $dir = Join-Path $Bundle 'apk'
  if (-not (Test-Path -LiteralPath $dir)) { return $null }
  $hit = Get-ChildItem -LiteralPath $dir -Filter '*universal*.apk' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($hit) { return $hit.FullName }
  $hit = Get-ChildItem -LiteralPath $dir -Filter '*.apk' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($hit) { return $hit.FullName }
  return $null
}

# Every APK in apk\, the given one first so the picker can offer it as choice
# 1. Sorted by name explicitly: the POSIX twin gets glob order and the two
# lists are numbered, so a folder that enumerates differently would give the
# same number to different APKs on the two platforms.
function Get-ApkChoices {
  param([string]$First, [string]$Bundle)
  $out = @()
  if ($First) { $out += $First }
  $dir = Join-Path $Bundle 'apk'
  if (Test-Path -LiteralPath $dir) {
    foreach ($f in (Get-ChildItem -LiteralPath $dir -Filter '*.apk' -ErrorAction SilentlyContinue | Sort-Object Name)) {
      if ($f.FullName -ne $First) { $out += $f.FullName }
    }
  }
  return $out
}

# A signature or downgrade mismatch is the one failure worth retrying, since the
# fix is always the same and the app's own state is a scripts folder on shared
# storage that the uninstall leaves alone. (tools/deploy.sh lines 158-163.)
function Install-Apk {
  param([string]$Serial, [string]$Apk)
  $r = Invoke-Adb @('-s', $Serial, 'install', '-r', $Apk) -TimeoutMs 300000
  $text = $r.Out + $r.Err
  if ($text -match 'Success') { return @{ Ok = $true; Text = $text } }
  if ($text -match 'UPDATE_INCOMPATIBLE|VERSION_DOWNGRADE|SIGNATURE') {
    Write-Log "install failed; uninstalling $global:Package and retrying"
    [void](Invoke-Adb @('-s', $Serial, 'uninstall', $global:Package) -TimeoutMs 60000)
    $r2 = Invoke-Adb @('-s', $Serial, 'install', $Apk) -TimeoutMs 300000
    $t2 = $r2.Out + $r2.Err
    return @{ Ok = ($t2 -match 'Success'); Text = $text + "`n" + $t2 }
  }
  return @{ Ok = $false; Text = $text }
}

# versionName of the installed app, or ''. Read with dumpsys rather than added
# to the probe reply on purpose: a new protocol key would mean touching
# device/gap-service.sh, PROTOCOL.md and ProtoWant, and this needs no root.
function Get-InstalledVersion {
  param([string]$Serial)
  $r = Invoke-Adb @('-s', $Serial, 'shell', "dumpsys package $global:Package") -TimeoutMs 30000
  foreach ($line in ($r.Out -split "`n")) {
    if ($line -match '^\s*versionName=(.*)$') { return $Matches[1].Trim() }
  }
  return ''
}

# ------------------------------------------------------ the Tsum Tsum library

# The catalogue GAP lists Tsum Tsum releases from. GAP ships with no
# third-party source, so the starter offers this one after an install.
$global:SourceUrl = 'https://tsumtsumscripts.github.io/tsum-tsum-catalogue/catalogue.json'

# Opens GAP's gap://add-source link on the device; the player taps Add there.
# Code 0: the dialog is up. 1: am failed. 2: this GAP has no such link (an
# older one, which lists the library by itself).
function Invoke-SourceOffer {
  param([string]$Serial)
  $r = Invoke-Adb @('-s', $Serial, 'shell', "am start -a android.intent.action.VIEW -d 'gap://add-source?url=$global:SourceUrl' -p $global:Package") -TimeoutMs 30000
  $text = ($r.Out + $r.Err).Trim()
  if ($text -match 'unable to resolve') { return @{ Code = 2; Text = '' } }
  if ($text -match 'Error|Exception') { return @{ Code = 1; Text = $text } }
  return @{ Code = 0; Text = '' }
}

# --------------------------------------------------------- the published APK

# .NET rather than Get-FileHash: in Windows PowerShell 5.1 that cmdlet lives
# in a script module found through PSModulePath, and a 5.1 started from a
# pwsh 7 terminal inherits pwsh's PSModulePath, under which it does not load.
# Started that way, every checksum would have come back blank.
function Get-Sha256 {
  param([string]$Path)
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $fs  = [IO.File]::OpenRead($Path)
    try { return ([BitConverter]::ToString($sha.ComputeHash($fs)) -replace '-', '').ToLower() }
    finally { $fs.Dispose(); $sha.Dispose() }
  } catch { return '' }
}

# curl.exe ships in System32 on Windows 10+ and is markedly faster than
# Invoke-WebRequest for a 30 MB file. -s -S keeps the progress bar off stderr,
# which $ErrorActionPreference = 'Stop' in gap.ps1 would otherwise trip over.
function Get-UrlToFile {
  param([string]$Url, [string]$Dest)

  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($curl) {
    # Not $args: that is an automatic variable, and writing it inside a
    # function is asking for trouble.
    $curlArgs = Format-NativeArgs @('-fL', '--retry', '2', '--connect-timeout', '15',
                                    '-s', '-S', '-o', $Dest, $Url)
    $p = Start-Process -FilePath $curl.Source -ArgumentList $curlArgs `
                       -NoNewWindow -PassThru -Wait
    return ($p.ExitCode -eq 0)
  }

  # Fallback for older Windows. The progress bar makes Invoke-WebRequest around
  # ten times slower on a large file, and PS 5.1 can still default to TLS 1.0.
  $prev = $ProgressPreference
  try {
    $ProgressPreference = 'SilentlyContinue'
    try {
      [Net.ServicePointManager]::SecurityProtocol =
        [Net.SecurityProtocolType]::Tls12 -bor [Net.ServicePointManager]::SecurityProtocol
    } catch { }
    Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing -TimeoutSec 120
    return $true
  } catch {
    return $false
  } finally {
    $ProgressPreference = $prev
  }
}

# The release manifest, as protocol-shaped key=value text Get-Kv can read.
function Get-ReleaseManifest {
  $tmp = Join-Path ([IO.Path]::GetTempPath()) "gap-latest.$PID.txt"
  try {
    if (-not (Get-UrlToFile -Url "$global:ReleaseBase/$global:ManifestName" -Dest $tmp)) {
      return $null
    }
    return (Get-Content -LiteralPath $tmp -Raw)
  } catch {
    return $null
  } finally {
    Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
  }
}

# ------------------------------------------ a script's own files, on device

# Matching absolute paths under the storage root. `find` is toybox and is on
# every Android this app runs on; the glob fallback covers the storage root and
# one level under it, which is where a script's own folder sits.
function Get-DeviceFiles {
  param([string]$Serial, [string]$Pattern)

  $root = $global:DeviceStorage
  $r = Invoke-Adb @('-s', $Serial, 'shell',
                    "find '$root' -type f -name '$Pattern' 2>/dev/null") -TimeoutMs 60000
  $text = $r.Out + $r.Err
  if ($text -notmatch [regex]::Escape("$root/")) {
    $r = Invoke-Adb @('-s', $Serial, 'shell',
                      "ls -1d '$root/$Pattern' '$root'/*/'$Pattern' 2>/dev/null") -TimeoutMs 60000
    $text = $r.Out + $r.Err
  }
  $out = @()
  foreach ($l in ($text -split "`n")) {
    $l = $l.Trim()
    # Real paths only: a missing `find`, a permission error and an unmatched
    # glob echoed back all arrive on the same stream.
    if ($l.StartsWith("$root/") -and $l -notmatch '[*?]') { $out += $l }
  }
  return $out
}

# A serial as a folder name -- 127.0.0.1:16384 has a colon in it, and Windows
# refuses that.
function Get-SafeName {
  param([string]$Text)
  return ($Text -replace '[^A-Za-z0-9._-]', '_')
}

# What landed on disk is the verdict, not adb's exit status: `adb pull` writes
# progress to stderr and its status is not uniform across platform-tools
# revisions.
function Copy-DeviceFile {
  param([string]$Serial, [string]$Remote, [string]$Local)

  $dir = Split-Path -Parent $Local
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    [void](New-Item -ItemType Directory -Path $dir -Force)
  }
  Remove-Item -LiteralPath $Local -ErrorAction SilentlyContinue
  [void](Invoke-Adb @('-s', $Serial, 'pull', $Remote, $Local) -TimeoutMs 120000)
  return (Test-Path -LiteralPath $Local)
}

# One rm for the batch. It reports nothing about what went: `adb shell` does not
# forward the remote exit status on older platform-tools (PROTOCOL.md rule 4),
# so the caller re-lists instead.
function Remove-DeviceFiles {
  param([string]$Serial, [string[]]$Paths)

  # A quote in a path is not quotable for the device shell, and is not worth a
  # second quoting scheme.
  $keep = @($Paths | Where-Object { $_ -and ($_ -notmatch "'") })
  if ($keep.Count -eq 0) { return }
  $quoted = ($keep | ForEach-Object { "'$_'" }) -join ' '
  [void](Invoke-Adb @('-s', $Serial, 'shell', "rm -f $quoted") -TimeoutMs 120000)
}
