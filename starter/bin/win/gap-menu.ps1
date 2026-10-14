# The numbered menu -- the bundle's only front-end on Windows.
#
# There is deliberately no window any more: a terminal is the one thing every
# machine that can run adb already has, and it is also the log pane. Every
# option here has a command-line twin (gap.ps1 -Action), so nothing is
# reachable only by menu.
#
# Two pages. The device list, and the page of the one device chosen from it,
# where every action runs. That device stays chosen -- across runs too, through
# last-device.txt -- until "d" asks for the list again, so nobody picks the
# same emulator after every action. Each page says what it is for and what to
# do next, because the terminal is all the guidance there is.
#
# gap-device.ps1 and gap-actions.ps1 do the work and word every message the
# same way their POSIX twins do, so nothing is implemented twice here -- this
# file only asks the questions.

param(
  [string]$Bundle,
  [string]$Serial,
  [string]$Action,
  [switch]$Yes
)

# Read by Invoke-Action, which is where the delete confirmation lives. Global,
# not $script:, because a dot-sourced function resolves $script: against
# whichever file is executing rather than the one it was written in.
if ($Yes) { $global:AssumeYes = $true }

if (-not $Bundle) { $Bundle = Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }

# Run directly rather than through gap.ps1: bootstrap what is missing.
if (-not (Get-Command Invoke-Verb -ErrorAction SilentlyContinue)) {
  . "$Bundle\bin\win\gap-device.ps1"
  . "$Bundle\bin\win\gap-actions.ps1"
  if (-not (Resolve-Adb -Bundle $Bundle)) { exit 1 }
  Start-AdbServer
}

function Write-Rule { Write-Host ('  ' + ('-' * 73)) }

function Write-Header {
  Write-Host ''
  Write-Host '  Tsum Tsum Script -- service starter'
  Write-Host "  adb: $global:AdbSource"
  if ($global:AdbWarning) { Write-Host "  note: $global:AdbWarning" }
  Write-Rule
}

function Show-Table {
  param($Rows)
  Write-Host ('  {0,-3} {1,-20} {2,-18} {3,-11} {4}' -f '#', 'SERIAL', 'MODEL', 'ABI', 'SERVICE')
  Write-Rule
  for ($i = 0; $i -lt $Rows.Count; $i++) {
    $r = $Rows[$i]
    Write-Host ('  {0,-3} {1,-20} {2,-18} {3,-11} {4}' -f "$($i + 1))", $r.Serial, $r.Model, $r.Abi, $r.Service)
  }
  Write-Rule
}

# What to do next, read off the Service column. Worded the same as
# menu_next_step in gap-menu.sh.
function Write-NextStep {
  param($Row, [bool]$HasApk)

  switch ($Row.Service) {
    'running' {
      Write-Host '  Next: nothing -- the service is up. Use the app on the device. After'
      Write-Host '  the device reboots, come back here and choose 1 again.'
    }
    'stopped' {
      Write-Host '  Next: choose 1 to start the service. The app needs it running before'
      Write-Host '  a script can run.'
    }
    'not installed' {
      if ($HasApk) {
        Write-Host '  Next: install the app -- 6 for the APK in this bundle, or 8 for the'
        Write-Host '  latest published one -- then 1 to start the service.'
      } else {
        Write-Host '  Next: choose 8 to download and install the app, then 1 to start the'
        Write-Host '  service.'
      }
    }
    'wrong ABI' {
      Write-Host '  Next: the installed app was built for another processor. Choose 8,'
      Write-Host "  which fetches the build for $($Row.Abi), then 1 to start the service."
    }
    'unreadable' {
      Write-Host '  Next: the device answered, but not in a way this tool could read.'
      Write-Host '  Choose r to try again; if it stays like this, reconnect the device.'
    }
    'unauthorized' {
      Write-Host '  Next: look at the device and tap Allow on the "Allow USB debugging?"'
      Write-Host '  prompt, then choose r.'
    }
    'offline' {
      Write-Host '  Next: choose 7 to reconnect, then r. If it stays offline, restart the'
      Write-Host '  emulator, or unplug the phone and plug it in again.'
    }
    default {
      Write-Host "  Next: adb reports this device as `"$($Row.State)`". Put that right on the"
      Write-Host '  device, then choose r.'
    }
  }
}

function Wait-Enter {
  Write-Host ''
  Read-Host '  [enter] to continue' | Out-Null
}

# The page of one device. Loops here, re-probing that device alone after every
# action so the Service line is current, until d (the list) or q. Returns
# 'list' or 'quit'.
function Show-DevicePage {
  param($Row, [string]$Bundle)

  $serial = $Row.Serial
  $map = @{ '1' = 'start'; '2' = 'restart'; '3' = 'stop'; '4' = 'log'
            '5' = 'follow'; '6' = 'install'; '7' = 'reconnect'; '8' = 'update'
            '9' = 'copy-script'; '10' = 'delete-script'; '11' = 'add-source' }
  while ($true) {
    $hasApk = Test-Path -LiteralPath (Join-Path $Bundle 'apk')

    Write-Header
    Write-Host "  Device : $serial   $($Row.Model)   $($Row.Abi)"
    Write-Host "  Service: $($Row.Service)"
    Write-Rule
    Write-Host '  Everything below acts on this device. It stays chosen, the next time'
    Write-Host '  this tool runs too, until you choose d.'
    Write-NextStep -Row $Row -HasApk $hasApk
    Write-Host ''
    if ($Row.State -eq 'device') {
      Write-Host '  Service (not needed on a rooted device -- the app starts it itself)'
      Write-Host '  1) Start service'
      Write-Host '  2) Restart service (force)'
      Write-Host '  3) Stop service'
      Write-Host '  4) Show service log'
      Write-Host '  5) Follow service log   (any key stops)'
      Write-Host ''
      Write-Host '  App and script files'
      if ($hasApk) { Write-Host '  6) Install APK' }
      # 8, not 7: 7 is Reconnect in the offline branch below, and the state
      # guard would then reject it here.
      if (Test-ChannelActive) { Write-Host '  8) Download and install the latest pre-release APK   (channel.txt)' }
      else { Write-Host '  8) Download and install the latest APK' }
      Write-Host '  9) Copy the script log  (script*.log)'
      Write-Host ' 10) Delete the script log from the device'
      Write-Host ' 11) Add the Tsum Tsum library to GAP   (tap Add on the device)'
    } else {
      Write-Host "  This device is '$($Row.State)' and cannot be used yet."
      if ($Row.State -eq 'offline') { Write-Host '  7) Reconnect' }
    }
    Write-Host ''
    Write-Host '  r) Refresh    d) Change device    q) Quit'
    Write-Host ''
    $pick = Read-Host '  choose'

    if ($pick -eq 'q') { return 'quit' }
    if ($pick -eq 'd' -or $pick -eq 'b') { return 'list' }
    if ($pick -ne 'r' -and $pick -ne '') {
      # Options not printed for this state can still be typed, so each is
      # guarded.
      if (-not $map.ContainsKey($pick)) { continue }
      if ($pick -eq '6' -and -not $hasApk) { continue }
      if ($pick -eq '7' -and $Row.State -ne 'offline') { continue }
      if ($map[$pick] -ne 'reconnect' -and $Row.State -ne 'device') { continue }

      $res = Invoke-Action -Serial $serial -Action $map[$pick] -Bundle $Bundle
      if ($res.Msg) {
        Write-Host ''
        $prefix = '  OK: '
        if (-not $res.Ok) { $prefix = '  PROBLEM: ' }
        Write-Host ($prefix + $res.Msg)
      }
      Wait-Enter
    }

    # The row again, after an action or an r. Gone from adb means back to the
    # list, which is the page that can say so.
    Write-Host "  checking $serial ..."
    $Row = Get-DeviceRow -Serial $serial -Bundle $Bundle
    if (-not $Row) {
      Write-Host ''
      Write-Host "  $serial is no longer listed by adb -- back to the device list."
      Wait-Enter
      return 'list'
    }
  }
}

# --- one action, no menu ----------------------------------------------------
# The same work the menu does, for scripts and for anyone who would rather type.
if ($Action) {
  $rows = @(Get-DeviceRows -Bundle $Bundle)
  if (-not $Serial) {
    if ($rows.Count -eq 0) { Write-Host (Get-NoDeviceHint); exit 1 }
    if ($rows.Count -gt 1) {
      # Several, and none named: the one chosen last in the menu, if it is
      # among them, is the only sensible default.
      $last = Get-RememberedDevice -Bundle $Bundle
      if ($last -and ($rows | Where-Object { $_.Serial -eq $last })) {
        $Serial = $last
        Write-Host "using $last, the device chosen last in the menu (-Serial picks another)"
      } else {
        Write-Host "error: $($rows.Count) devices connected, pass -Serial to choose one:"
        $rows | ForEach-Object { Write-Host "  $($_.Serial)" }
        exit 1
      }
    } else {
      $Serial = $rows[0].Serial
    }
  }
  $res = Invoke-Action -Serial $Serial -Action $Action -Bundle $Bundle
  if ($res.Msg) {
    Write-Host ''
    Write-Host $res.Msg
  }
  if ($res.Ok) { exit 0 } else { exit 1 }
}

# --- interactive menu -------------------------------------------------------
# Straight to the device chosen last time, when it is here and usable. One
# that is here but not usable is shown in the list instead, with the reason,
# since the list is the page that explains one.
$wanted = Get-RememberedDevice -Bundle $Bundle
while ($true) {
  Write-Header
  Write-Host '  scanning for devices ...'

  $rows = @(Get-DeviceRows -Bundle $Bundle)
  if ($rows.Count -eq 0) {
    Write-Host ''
    Write-Host (Get-NoDeviceHint)
    Write-Host ''
    Write-Host '  Once it is on and connected, choose r to look again.'
    Write-Host ''
    Write-Host '  r) Refresh    q) Quit'
    $pick = Read-Host '  choose'
    if ($pick -eq 'q') { exit 0 }
    continue
  }

  if ($wanted) {
    $hit = $rows | Where-Object { $_.Serial -eq $wanted } | Select-Object -First 1
    $wanted = ''
    if ($hit -and $hit.State -eq 'device') {
      Write-Host "  $($hit.Serial), chosen last time, is here -- opening it."
      if ((Show-DevicePage -Row $hit -Bundle $Bundle) -eq 'quit') { exit 0 }
      continue
    }
  }

  Write-Host ''
  Write-Host '  Every phone and emulator adb can see, and where the service stands on'
  Write-Host '  each. Type the number of the one to work on and press enter. It stays'
  Write-Host '  chosen -- across runs of this tool too -- until you change it here.'
  Write-Host ''
  Show-Table $rows
  Write-Host '  r) Refresh    q) Quit'
  $pick = Read-Host '  device'
  if ($pick -eq 'q') { exit 0 }
  if ($pick -eq 'r' -or $pick -eq '') { continue }
  if ($pick -notmatch '^\d+$') { continue }
  $idx = [int]$pick - 1
  if ($idx -lt 0 -or $idx -ge $rows.Count) { continue }

  Set-RememberedDevice -Bundle $Bundle -Serial $rows[$idx].Serial
  if ((Show-DevicePage -Row $rows[$idx] -Bundle $Bundle) -eq 'quit') { exit 0 }
}
