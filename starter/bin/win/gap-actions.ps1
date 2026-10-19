# What the menu options do, and what the user is told when they fail.
#
# The Windows twin of bin/posix/gap-actions.sh. The wording is deliberately the
# same in both: a user who is told something different on each OS has to be
# supported twice.

# One device's row, enriched by one batched probe. A device that is not in the
# `device` state gets the reason as its Service column rather than being
# hidden -- "no devices found" when the phone is sitting there unauthorized is
# the most confusing thing this tool could say.
function New-DeviceRow {
  param($Device, [string]$Bundle)

  $abi = '-'; $svc = $Device.State; $installed = '-'; $err = ''; $release = '-'
  if ($Device.State -eq 'device') {
    $probe = Invoke-Verb -Serial $Device.Serial -Verb 'probe' -Bundle $Bundle
    if ((Get-Kv $probe 'proto') -eq $global:ProtoWant) {
      $abi       = Get-Kv $probe 'device_abi'
      $installed = Get-Kv $probe 'installed'
      $err       = Get-Kv $probe 'err'
      $release   = Get-Kv $probe 'release'
      $svc = if ((Get-Kv $probe 'running') -eq '1') { 'running' } else { 'stopped' }
      if ($installed -eq '0') { $svc = 'not installed' }
      if ($err -eq 'no-libs') { $svc = 'wrong ABI' }
      # A push that failed still answers proto=1, and knows nothing else.
      if ($err -eq 'push-failed') { $svc = 'unreadable' }
    } else {
      $svc = 'unreadable'
    }
  }
  return [pscustomobject]@{
    Serial = $Device.Serial; State = $Device.State; Model = $Device.Model
    Release = $release; Abi = $abi; Service = $svc
    Installed = $installed; Err = $err
  }
}

# Every device adb lists, one probed row each.
function Get-DeviceRows {
  param([string]$Bundle, [switch]$NoProbe)

  if (-not $NoProbe) { Connect-Emulators }
  $out = @()
  foreach ($r in (Merge-Duplicates (Get-Devices))) {
    $out += New-DeviceRow -Device $r -Bundle $Bundle
  }
  return $out
}

# That one device's row, rebuilt: its adb state now, and what the probe says.
# $null when adb no longer lists it. What the device page reads after every
# action, so its Service line can change without rescanning every device.
function Get-DeviceRow {
  param([string]$Serial, [string]$Bundle)
  $d = @(Get-Devices) | Where-Object { $_.Serial -eq $Serial } | Select-Object -First 1
  if (-not $d) { return $null }
  return New-DeviceRow -Device $d -Bundle $Bundle
}

function Get-NoDeviceHint {
  $ports = ($global:EmuPorts -join ' ')
  $remote = @(Get-RemoteHosts)
  $tail = if ($remote.Count) {
    "  - Also probed the same ports on GAP_REMOTE_HOSTS: $($remote -join ' ')`n" +
    "    Is each emulator's port forwarded onto the LAN and open in the firewall?"
  } else {
    '    Emulators on another computer: set GAP_REMOTE_HOSTS="192.168.1.50".'
  }
  return @"
No device found.

  - Start your emulator, or plug the phone in with USB debugging enabled.
  - Probed for emulators on 127.0.0.1: $ports
    A different port can be added with GAP_EXTRA_PORTS="12345".
$tail
"@
}

# The one place a probe/start result is turned into English.
function Get-Explanation {
  param([string]$Text)
  $err = Get-Kv $Text 'err'
  switch ($err) {
    ''  { return '' }
    'not-installed' { return 'General Automation Platform is not installed on this device.' }
    'no-libs' {
      # An APK built for the wrong ABI installs cleanly and only fails here.
      $libs = (Get-Kv $Text 'libs_present').Trim()
      $dabi = Get-Kv $Text 'device_abi'
      if ($libs) {
        return "The installed APK carries $libs only, and this device runs $dabi.`nInstall a build for $dabi."
      }
      return "The installed APK has no extracted native libraries.`nIt must be built for $dabi with extractNativeLibs=true."
    }
    'push-failed' {
      return "Could not push the helper script to the device.`nIs /data/local/tmp writable? Try reconnecting."
    }
    default {
      $m = Get-Kv $Text 'msg'
      if ($m) { return $m }
      return "Failed: $err"
    }
  }
}

# The install picker. Detection reads ro.product.cpu.abi off the device and is
# right far more often than a person reading the row would be -- an emulator
# spoofs a Samsung model name but not its ABI -- so the detected build is
# choice 1 and enter takes it. The list is for what detection cannot cover: a
# probe that came back empty, or trying another build deliberately.
#
# Returns @{ Ok = $true; Apk = <path> }, or Ok = $false if the operator backed
# out. No console to ask through is not a refusal: the default stands.
function Select-Apk {
  param([string]$Abi, [string[]]$Choices, [string]$Default)

  Write-Log ''
  Write-Log '  Which APK to install. Press enter for the one built for this device;'
  Write-Log '  type a number only if you have a reason to install another build.'
  if ($Abi) {
    Write-Log "  this device reports $Abi"
  } else {
    Write-Log "  could not read this device's ABI, so nothing is preselected"
  }
  Write-Log ''
  for ($i = 0; $i -lt $Choices.Count; $i++) {
    $name = Split-Path -Leaf $Choices[$i]
    $tag = ''
    if ($name -like '*universal*') { $tag = 'every ABI; the device chooses' }
    if ($Choices[$i] -eq $Default) {
      if ($tag) { $tag = "$tag  [enter]" } else { $tag = '[enter]' }
    }
    if ($tag) {
      Write-Log ("    {0}) {1,-34} {2}" -f ($i + 1), $name, $tag)
    } else {
      Write-Log ("    {0}) {1}" -f ($i + 1), $name)
    }
  }
  Write-Log ''

  $prompt = if ($Default) { '  choose [enter = 1]' } else { '  choose (enter cancels)' }
  try {
    $pick = Read-Host $prompt
  } catch {
    if ($Default) { return @{ Ok = $true; Apk = $Default } }
    return @{ Ok = $false }
  }

  # Enter takes the default, and is a cancel only when there is none.
  if (-not $pick) {
    if ($Default) { return @{ Ok = $true; Apk = $Default } }
    return @{ Ok = $false }
  }
  if ($pick -notmatch '^\d+$') { return @{ Ok = $false } }
  $n = [int]$pick
  if ($n -lt 1 -or $n -gt $Choices.Count) { return @{ Ok = $false } }
  return @{ Ok = $true; Apk = $Choices[$n - 1] }
}

# Offers the Tsum Tsum library to GAP and says what happened. Ok is false only
# when the offer itself failed.
function Get-SourceOffer {
  param([string]$Serial)
  Write-Log "offering the Tsum Tsum library to GAP on $Serial ..."
  $r = Invoke-SourceOffer -Serial $Serial
  foreach ($l in ($r.Text -split "`n")) { if ($l.Trim()) { Write-Log "  $($l.Trim())" } }
  if ($r.Code -eq 0) { return @{ Ok = $true; Msg = "On the device, tap Add to put the Tsum Tsum library in GAP's Sources." } }
  if ($r.Code -eq 2) { return @{ Ok = $true; Msg = 'This GAP lists the Tsum Tsum library by itself. Nothing to add.' } }
  return @{ Ok = $false; Msg = 'Could not open GAP to add the Tsum Tsum library. See the log.' }
}

function Invoke-Action {
  param([string]$Serial, [string]$Action, [string]$Bundle)

  switch ($Action) {

    'reconnect' {
      Write-Log "reconnecting $Serial ..."
      [void](Invoke-Adb @('disconnect', $Serial) -TimeoutMs 15000)
      $r = Invoke-Adb @('connect', $Serial) -TimeoutMs 15000
      Write-Log ($r.Out + $r.Err).Trim()
      return @{ Ok = $true; Msg = 'Reconnect attempted. Refresh to see the result.' }
    }

    'install' {
      $probe = Invoke-Verb -Serial $Serial -Verb 'probe' -Bundle $Bundle
      $abi = Get-Kv $probe 'device_abi'
      # A failed probe has no device_abi, and matching '' takes whichever APK
      # sorts first in the folder. It leaves no default instead, and the picker
      # asks outright rather than guessing.
      $default = $null
      if ($abi) {
        $default = Find-ApkExact -Abi $abi -Bundle $Bundle
        if (-not $default) { $default = Find-ApkFor -Abi $abi -Bundle $Bundle }
      }

      $choices = @(Get-ApkChoices -First $default -Bundle $Bundle)
      if ($choices.Count -eq 0) {
        return @{ Ok = $false; Msg = "No APK in the bundle.`nPut one in the apk\ folder next to Start-Windows.cmd, then try again." }
      }

      # One APK and a device to match it against is not a choice worth asking
      # about; anything else is, because a wrong build installs cleanly and
      # only fails later, when the service will not start. With no console to
      # ask through -- or with -Yes -- the detected default stands.
      $ask = -not ($global:AssumeYes -or $env:GAP_ASSUME_YES -eq '1')
      $apk = $default
      if ($ask -and ($choices.Count -gt 1 -or -not $apk)) {
        $sel = Select-Apk -Abi $abi -Choices $choices -Default $default
        if (-not $sel.Ok) { return @{ Ok = $true; Msg = 'Nothing was installed.' } }
        $apk = $sel.Apk
      }
      if (-not $apk) {
        return @{ Ok = $false; Msg = "Could not read the device's ABI, so no APK was chosen.`nThe device may have gone offline -- Refresh and try again." }
      }
      Write-Log "installing $(Split-Path -Leaf $apk) on $Serial ..."
      $res = Install-Apk -Serial $Serial -Apk $apk
      foreach ($l in ($res.Text -split "`n")) { if ($l.Trim()) { Write-Log "  $($l.Trim())" } }
      if ($res.Ok) {
        $src = Get-SourceOffer -Serial $Serial
        return @{ Ok = $true; Msg = "Installed $(Split-Path -Leaf $apk).`n$($src.Msg)" }
      }
      return @{ Ok = $false; Msg = 'Install failed. See the log.' }
    }

    'update' {
      Write-Log 'checking for a newer APK ...'
      if (Test-ChannelActive) { Write-Log "  channel: $global:ReleaseBase" }
      $man = Get-ReleaseManifest
      if (-not $man) {
        $msg = "Could not reach the release page.`nCheck the internet connection. Install APK still works offline from the bundle."
        Write-Log $msg
        return @{ Ok = $false; Msg = $msg }
      }
      $ver = Get-Kv $man 'version'
      if (-not $ver) {
        return @{ Ok = $false; Msg = 'The release manifest is unreadable. Try again later.' }
      }

      # Same ABI matching the bundled path does, only against the manifest:
      # the exact ABI first, the universal build as the fallback.
      $probe = Invoke-Verb -Serial $Serial -Verb 'probe' -Bundle $Bundle
      $abi   = Get-Kv $probe 'device_abi'
      # Same guard as install: an empty ABI means the probe failed, and the
      # universal fallback below would download for a device that is not there.
      if (-not $abi) {
        return @{ Ok = $false; Msg = "Could not read the device's ABI, so no APK was chosen.`nThe device may have gone offline -- Refresh and try again." }
      }
      $name  = Get-Kv $man "apk_$abi"
      $want  = Get-Kv $man "sha256_$abi"
      if (-not $name) {
        $name = Get-Kv $man 'apk_universal'
        $want = Get-Kv $man 'sha256_universal'
      }
      if (-not $name) {
        return @{ Ok = $false; Msg = "The latest release publishes no APK for $abi." }
      }

      # A wrong-ABI install carries the same version as the APK that fixes it,
      # so "already on it" would leave the user stuck on a build that cannot
      # start, with no way out of this menu.
      $have = Get-InstalledVersion -Serial $Serial
      if ($have -and $have -eq $ver -and (Get-Kv $probe 'err') -ne 'no-libs') {
        $msg = "Already on $ver -- nothing to download."
        Write-Log $msg
        return @{ Ok = $true; Msg = $msg }
      }

      $dir = Join-Path $Bundle 'apk'
      if (-not (Test-Path -LiteralPath $dir)) {
        [void](New-Item -ItemType Directory -Path $dir -Force)
      }
      $dest = Join-Path $dir $name
      $chan = Get-Kv $man 'channel'
      $chanNote = if ($chan) { ", $chan" } else { '' }
      Write-Log "downloading $name ($ver$chanNote) ..."
      if (-not (Get-UrlToFile -Url "$global:ReleaseBase/$name" -Dest $dest)) {
        Remove-Item -LiteralPath $dest -ErrorAction SilentlyContinue
        $msg = "Could not download $name."
        Write-Log $msg
        return @{ Ok = $false; Msg = $msg }
      }

      if ($want) {
        $got = Get-Sha256 -Path $dest
        if (-not $got) {
          Write-Log '  warning: could not hash the download, so it is unverified'
        } elseif ($got -ne $want.ToLower()) {
          Remove-Item -LiteralPath $dest -ErrorAction SilentlyContinue
          $msg = "$name did not match its published checksum and was deleted.`nNothing was installed."
          Write-Log $msg
          return @{ Ok = $false; Msg = $msg }
        } else {
          Write-Log '  sha256 ok'
        }
      }

      # By path, not through Find-ApkFor: that takes the first match in the
      # folder, so a bundled gap-0.12-*-arm64-v8a.apk could beat the
      # gap-arm64-v8a.apk just downloaded. 'install' stays "the bundled APK",
      # this is "the published one".
      Write-Log "installing $name on $Serial ..."
      $res = Install-Apk -Serial $Serial -Apk $dest
      foreach ($l in ($res.Text -split "`n")) { if ($l.Trim()) { Write-Log "  $($l.Trim())" } }
      if ($res.Ok) {
        $was = if ($have) { " (was $have)" } else { '' }
        $chanTag = if ($chan) { " ($chan)" } else { '' }
        $src = Get-SourceOffer -Serial $Serial
        return @{ Ok = $true; Msg = "Updated to $ver$chanTag$was.`n$($src.Msg)" }
      }
      return @{ Ok = $false; Msg = 'Install failed. See the log.' }
    }

    'add-source' {
      if (-not (Get-InstalledVersion -Serial $Serial)) {
        return @{ Ok = $false; Msg = "GAP is not installed on $Serial. Install it first; that adds the library too." }
      }
      return Get-SourceOffer -Serial $Serial
    }

    'follow' {
      # The terminal is the log pane, so this streams instead of snapshotting.
      # adb runs as a child sharing this console: killing it on a keypress
      # stops the tail without taking the menu down, which Ctrl-C would.
      Write-Log ''
      Write-Log "following $global:StageDir/service.log on $Serial -- press any key to stop"
      Write-Log ''
      $tailArgs = Format-NativeArgs @('-s', $Serial, 'shell', "tail -n 200 -f $global:StageDir/service.log")
      $p = Start-Process -FilePath $global:Adb -ArgumentList $tailArgs -NoNewWindow -PassThru
      try {
        # KeyAvailable throws when stdin is redirected; there is no keypress to
        # wait for then, so just let the tail run until adb or the user ends it.
        $canPoll = $true
        try { [void]$Host.UI.RawUI.KeyAvailable } catch { $canPoll = $false }
        if ($canPoll) {
          while (-not $p.HasExited) {
            if ($Host.UI.RawUI.KeyAvailable) {
              [void]$Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
              break
            }
            Start-Sleep -Milliseconds 150
          }
        } else {
          $p.WaitForExit()
        }
      } finally {
        if (-not $p.HasExited) { try { $p.Kill() } catch { } }
      }
      return @{ Ok = $true; Msg = '' }
    }

    'log' {
      $out = Invoke-Verb -Serial $Serial -Verb 'log' -Bundle $Bundle
      foreach ($l in ((Get-LogBlock $out) -split "`n")) { Write-Log $l }
      return @{ Ok = $true; Msg = "Service log from $global:StageDir/service.log" }
    }

    'stop' {
      Write-Log "stopping the service on $Serial ..."
      $out = Invoke-Verb -Serial $Serial -Verb 'stop' -Bundle $Bundle
      if (-not (Test-Proto $out)) { return @{ Ok = $false; Msg = 'Protocol mismatch.' } }
      # A root-started service survives the kill; the device script says why.
      if ((Get-Kv $out 'running') -eq '1') {
        $msg = Get-Explanation $out
        if (-not $msg) { $msg = 'The service is still running.' }
        Write-Log $msg
        return @{ Ok = $false; Msg = $msg }
      }
      return @{ Ok = $true; Msg = 'Service stopped.' }
    }

    { $_ -eq 'start' -or $_ -eq 'restart' } {
      $flags = @()
      if ($Action -eq 'restart') { $flags = @('--force') }
      Write-Log "starting the service on $Serial ..."
      $out = Invoke-Verb -Serial $Serial -Verb 'start' -Flags $flags -Bundle $Bundle
      if (-not (Test-Proto $out)) { return @{ Ok = $false; Msg = 'Protocol mismatch.' } }

      $abi = Get-Kv $out 'abi'
      if ($abi) { Write-Log "  abi    : $abi ($(Get-Kv $out 'loader'))" }
      $libdir = Get-Kv $out 'libdir'
      if ($libdir) { Write-Log "  libs   : $libdir" }
      # @(): a lone step comes back unrolled to a string, whose [-1] is a char.
      $steps = @(Get-KvAll $out 'step')
      foreach ($s in $steps) { Write-Log "  step   : $s" }

      $body = Get-LogBlock $out
      if ($body.Trim()) {
        Write-Log '  --- service log ---'
        foreach ($l in ($body -split "`n")) { Write-Log "  $l" }
      }

      # rc too: `running=1` is also what a refused restart says of the
      # service it could not replace.
      if ((Get-Kv $out 'rc') -eq '0' -and (Get-Kv $out 'running') -eq '1') {
        if ($steps -and $steps[-1] -eq 'already-running') {
          return @{ Ok = $true; Msg = "Service was already running from this build - left alone.`nUse Restart to force it." }
        }
        return @{ Ok = $true; Msg = "Service is running.`nIt survives an app reinstall, and stays up until the device reboots." }
      }

      $msg = Get-Explanation $out
      # The one failure the bundle can fix by itself.
      $err = Get-Kv $out 'err'
      if ($err -eq 'not-installed' -or $err -eq 'no-libs') {
        $dabi = Get-Kv $out 'device_abi'
        if (Find-ApkExact -Abi $dabi -Bundle $Bundle) {
          $msg = "$msg`n`nAn APK for $dabi is in this bundle - use the Install APK option."
        } elseif ($err -eq 'no-libs') {
          # Only a fat APK here, and the device already resolved one to the
          # wrong ABI. Installing it again lands in exactly the same place.
          $msg = "$msg`n`nThis bundle carries no $dabi-only APK - use Download latest APK to fetch one."
        } elseif (Find-ApkFor -Abi $dabi -Bundle $Bundle) {
          $msg = "$msg`n`nAn APK is in this bundle - use the Install APK option."
        }
      }
      if (-not $msg) { $msg = 'The service failed to start. See the log.' }
      Write-Log $msg
      return @{ Ok = $false; Msg = $msg }
    }

    { $_ -eq 'copy-script' -or $_ -eq 'delete-script' } {

      # Two verbs, one job: they differ in whether the files survive it.
      $pat = 'script*.log'; $what = 'script log'   # script.1.log.. are rotations
      $root = $global:DeviceStorage

      Write-Log "looking for $pat under $root ..."
      $files = @(Get-DeviceFiles -Serial $Serial -Pattern $pat)
      # A copy also takes GAP's companion link log (companion-<id>.log).
      if ($Action -like 'copy-*') { $files += @(Get-DeviceFiles -Serial $Serial -Pattern 'companion*.log') }
      if ($files.Count -eq 0) {
        $msg = "No $what on this device.`nNothing matched $pat under $root.`n" +
               'A service started with --root= needs GAP_STORAGE_ROOT set to the same folder.'
        Write-Log $msg
        return @{ Ok = $false; Msg = $msg }
      }

      if ($Action -like 'copy-*') {
        $dest = Join-Path (Join-Path $Bundle 'collected') (Get-SafeName $Serial)
        $n = 0; $bad = 0
        foreach ($f in $files) {
          # The device layout is kept under the destination, so two scripts
          # with a log of the same name cannot overwrite each other.
          $rel = $f.Substring($root.Length + 1)
          if (Copy-DeviceFile -Serial $Serial -Remote $f -Local (Join-Path $dest $rel)) {
            $n++; Write-Log "  $rel"
          } else {
            $bad++; Write-Log "  FAILED $rel"
          }
        }
        if ($n -eq 0) {
          return @{ Ok = $false; Msg = "Found $($files.Count) file(s) but could not copy any. See the log." }
        }
        $msg = "Copied $n file(s) into`n$dest"
        if ($bad -gt 0) { $msg = "$msg`n$bad could not be copied -- see the log." }
        return @{ Ok = $true; Msg = $msg }
      }

      # Deleting: nothing keeps a second copy, so the list is shown and
      # confirmed first. -Yes skips the question; with no console to ask in,
      # refusing beats deleting on an assumption.
      foreach ($f in $files) { Write-Log ('  ' + $f.Substring($root.Length + 1)) }

      # The service opens script.log at startup and holds it for the life of the
      # process, and an emulator whose sdcard is a host folder cannot unlink a
      # file the host still has open, so the service is bounced around the delete.
      $bounce = $Action -eq 'delete-script'
      if ($bounce) {
        Write-Log 'The service holds script.log open, so it is stopped for the delete and started again afterwards.'
      }

      if (-not ($global:AssumeYes -or $env:GAP_ASSUME_YES -eq '1')) {
        try {
          $ans = Read-Host "`n  delete these $($files.Count) file(s) from $Serial? [y/N]"
        } catch {
          $msg = 'Refusing to delete without a confirmation -- add -Yes.'
          Write-Log $msg
          return @{ Ok = $false; Msg = $msg }
        }
        if ($ans -notmatch '^(y|yes)$') { return @{ Ok = $true; Msg = 'Nothing was deleted.' } }
      }
      # `step=kill` means the stop found something to kill, which is the only
      # thing that earns a restart afterwards -- `step=not-running` must not
      # start a service the user had deliberately left down.
      $wasRunning = $false
      if ($bounce) {
        Write-Log "stopping the service on $Serial ..."
        $out = Invoke-Verb -Serial $Serial -Verb 'stop' -Bundle $Bundle
        if (Test-Proto $out) {
          $wasRunning = (Get-Kv $out 'step') -eq 'kill'
          if ((Get-Kv $out 'running') -eq '1') {
            Write-Log 'the service did not stop; files it holds open may survive the delete'
          }
        }
      }

      Remove-DeviceFiles -Serial $Serial -Paths $files

      # What is still there is the verdict; `rm` on the far side of adb shell
      # cannot report its own. Counted before the restart, because the service
      # writes a fresh script.log the moment it comes back up.
      $left = @(Get-DeviceFiles -Serial $Serial -Pattern $pat).Count
      $gone = $files.Count - $left

      $note = ''
      if ($wasRunning) {
        Write-Log "starting the service on $Serial ..."
        $out = Invoke-Verb -Serial $Serial -Verb 'start' -Bundle $Bundle
        if ((Get-Kv $out 'running') -eq '1') {
          $note = "`nThe service was stopped for the delete and is running again," +
                  "`nso a new script.log is already on the device."
        } else {
          $note = "`nThe service was stopped for the delete and did not come back --" +
                  "`nuse Start service, then Show service log if it still will not."
        }
      }

      if ($left -eq 0) { return @{ Ok = $true; Msg = "Deleted $gone file(s) from $Serial.$note" } }
      if ($gone -gt 0) {
        return @{ Ok = $true; Msg = "Deleted $gone file(s); $left could not be removed.`n" +
                                    'A file the running script still holds open is the usual reason.' + $note }
      }
      return @{ Ok = $false; Msg = "Nothing could be deleted. Is the storage writable?$note" }
    }

    default { return @{ Ok = $false; Msg = "unknown action: $Action" } }
  }
}
